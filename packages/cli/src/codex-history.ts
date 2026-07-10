import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, join } from "node:path";

export type CodexHistoryDiagnostic = {
  client: "codex";
  status: "error";
  path: string;
  warning: string;
};

export type CodexHistoryReconciliation = {
  files: string[];
  diagnostics: CodexHistoryDiagnostic[];
};

type HistorySource = "active" | "archived";

type IndexedHistory = {
  path: string;
  source: HistorySource;
  sessionId?: string;
  fileSessionId: string;
  fingerprint?: string;
  parseWarnings: number;
};

type CachedIndex = {
  size: number;
  mtimeMs: number;
  value: IndexedHistory;
};

const indexCache = new Map<string, CachedIndex>();

export async function findUncoveredCodexHistories(
  home: string,
  coveredSessionIds: Iterable<string>
): Promise<CodexHistoryReconciliation> {
  const roots: Array<{ path: string; source: HistorySource }> = [
    { path: join(home, ".codex", "sessions"), source: "active" },
    { path: join(home, ".codex", "archived_sessions"), source: "archived" }
  ];
  const indexed: IndexedHistory[] = [];
  const diagnostics: CodexHistoryDiagnostic[] = [];

  for (const root of roots) {
    for (const path of await listJsonlFiles(root.path)) {
      try {
        const history = await indexCodexHistory(path, root.source);

        if (history.parseWarnings > 0) {
          diagnostics.push({
            client: "codex",
            status: "error",
            path,
            warning: `Ignored ${history.parseWarnings} malformed Codex usage metadata line(s).`
          });
        }

        if (history.fingerprint) {
          indexed.push(history);
        }
      } catch (error) {
        diagnostics.push({
          client: "codex",
          status: "error",
          path,
          warning: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  const covered = new Set([...coveredSessionIds].map(normalizeSessionId));
  const groups = new Map<string, IndexedHistory[]>();

  for (const history of indexed) {
    const group = groups.get(history.fingerprint!) ?? [];
    group.push(history);
    groups.set(history.fingerprint!, group);
  }

  const files: string[] = [];

  for (const group of groups.values()) {
    const alreadyCovered = group.some(
      (history) =>
        covered.has(normalizeSessionId(history.fileSessionId)) ||
        (history.sessionId !== undefined && covered.has(normalizeSessionId(history.sessionId)))
    );

    if (alreadyCovered) {
      continue;
    }

    const canonical = [...group].sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === "active" ? -1 : 1;
      }

      return left.path.localeCompare(right.path);
    })[0];

    if (canonical) {
      files.push(canonical.path);
    }
  }

  return { files: files.sort(), diagnostics };
}

async function listJsonlFiles(root: string): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw error;
  }

  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listJsonlFiles(path)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
      files.push(path);
    }
  }

  return files;
}

async function indexCodexHistory(path: string, source: HistorySource): Promise<IndexedHistory> {
  const fileStat = await stat(path);
  const cached = indexCache.get(path);

  if (cached?.size === fileStat.size && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.value;
  }

  const fileSessionId = basename(path, ".jsonl");
  const hash = createHash("sha256");
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let sessionId: string | undefined;
  let currentModel: string | undefined;
  let tokenEvents = 0;
  let parseWarnings = 0;

  for await (const line of lines) {
    if (!isRelevantLine(line)) {
      continue;
    }

    let event: Record<string, unknown>;

    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      parseWarnings += 1;
      continue;
    }

    const type = getString(event.type);
    const payload = asRecord(event.payload);

    if (type === "session_meta") {
      sessionId = getString(payload.id) ?? sessionId;
      continue;
    }

    if (type === "turn_context") {
      currentModel = getString(payload.model) ?? currentModel;
      continue;
    }

    if (type !== "event_msg" || getString(payload.type) !== "token_count") {
      continue;
    }

    const info = asRecord(payload.info);
    const totalTokenUsage = normalizeTokenUsage(asRecord(info.total_token_usage));
    const lastTokenUsage = normalizeTokenUsage(asRecord(info.last_token_usage));

    if (!totalTokenUsage && !lastTokenUsage) {
      continue;
    }

    hash.update(
      JSON.stringify({
        timestamp: getString(event.timestamp),
        model: currentModel,
        totalTokenUsage,
        lastTokenUsage
      })
    );
    hash.update("\n");
    tokenEvents += 1;
  }

  const value: IndexedHistory = {
    path,
    source,
    sessionId,
    fileSessionId,
    fingerprint: tokenEvents > 0 ? hash.digest("hex") : undefined,
    parseWarnings
  };

  indexCache.set(path, {
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    value
  });

  return value;
}

function isRelevantLine(line: string) {
  return line.includes('"session_meta"') || line.includes('"turn_context"') || line.includes('"token_count"');
}

function normalizeTokenUsage(value: Record<string, unknown>) {
  const usage = {
    inputTokens: getNumber(value.input_tokens),
    cachedInputTokens: getNumber(value.cached_input_tokens),
    outputTokens: getNumber(value.output_tokens),
    reasoningOutputTokens: getNumber(value.reasoning_output_tokens),
    totalTokens: getNumber(value.total_tokens)
  };

  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

function normalizeSessionId(value: string) {
  return value.trim().toLowerCase();
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isMissingPathError(error: unknown) {
  return asRecord(error).code === "ENOENT";
}
