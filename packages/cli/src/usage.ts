import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type UsageScanOptions = {
  collectorUrl?: string;
  clients?: string;
  commandTimeoutMs?: number;
  tokscaleCommand?: string;
  runTokscale?: (clients: string, commandTimeoutMs: number) => Promise<unknown>;
  postJson?: (path: string, body: unknown) => Promise<void>;
};

type UsageRow = {
  client: string;
  sessionId?: string;
  model?: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd?: number;
  messageCount?: number;
  startedAt?: string;
  lastUsedAt?: string;
};

const defaultCollectorUrl = "http://localhost:4319";
const defaultClients = "codex,claude,opencode,cursor,antigravity,kimi,qwen,copilot";
const defaultCommandTimeoutMs = 60_000;

const totalTokenKeys = [
  "totalTokens",
  "total_tokens",
  "totalTokenCount",
  "total_token_count",
  "tokens",
  "tokenCount",
  "token_count"
];
const inputTokenKeys = ["inputTokens", "input_tokens", "input", "promptTokens", "prompt_tokens"];
const outputTokenKeys = ["outputTokens", "output_tokens", "output", "completionTokens", "completion_tokens"];
const cacheReadTokenKeys = [
  "cacheReadTokens",
  "cache_read_tokens",
  "cacheReadInputTokens",
  "cache_read_input_tokens",
  "cachedTokens",
  "cached_tokens",
  "cacheRead"
];
const cacheWriteTokenKeys = [
  "cacheWriteTokens",
  "cache_write_tokens",
  "cacheCreationInputTokens",
  "cache_creation_input_tokens",
  "cacheWrite"
];
const reasoningTokenKeys = ["reasoningTokens", "reasoning_tokens", "reasoningOutputTokens", "reasoning"];
const costKeys = ["costUsd", "cost_usd", "costUSD", "cost", "totalCost", "total_cost"];
const messageCountKeys = ["messageCount", "message_count", "messages", "totalMessages", "total_messages"];
const sessionIdKeys = ["sessionId", "session_id", "session", "conversationId", "conversation_id", "threadId", "thread_id"];

export async function collectUsageOnce(options: UsageScanOptions = {}) {
  const collectorUrl = trimTrailingSlash(
    options.collectorUrl ??
      process.env.AGENT_TRACE_COLLECTOR_URL ??
      process.env.AGENT_TRACE_ENDPOINT ??
      process.env.TOOLTRACE_COLLECTOR_URL ??
      process.env.TOOLTRACE_ENDPOINT ??
      defaultCollectorUrl
  );
  const clients = normalizeClients(options.clients ?? process.env.AGENT_TRACE_USAGE_CLIENTS ?? defaultClients);
  const commandTimeoutMs = options.commandTimeoutMs ?? defaultCommandTimeoutMs;
  const runTokscale = options.runTokscale ?? ((clientCsv, timeoutMs) =>
    runTokscaleJson(clientCsv, timeoutMs, options.tokscaleCommand));
  const postJson = options.postJson ?? ((path, body) => postCollectorJson(collectorUrl, path, body));
  const raw = await runTokscale(clients, commandTimeoutMs);
  const rows = normalizeTokscaleUsage(raw);

  await postJson("/integrations/usage-scan", {
    source: "tokscale",
    scannedAt: new Date().toISOString(),
    rows
  });

  return {
    rows: rows.length
  };
}

export async function watchUsage(options: UsageScanOptions & { intervalMs?: number; signal?: AbortSignal } = {}) {
  const intervalMs = normalizeIntervalMs(options.intervalMs);

  while (!options.signal?.aborted) {
    try {
      await collectUsageOnce(options);
    } catch (error) {
      console.error(`Agent-Trace usage scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    await sleep(intervalMs, options.signal);
  }
}

export function normalizeTokscaleUsage(value: unknown): UsageRow[] {
  const rows: Record<string, unknown>[] = [];

  collectUsageRows(value, rows);

  return rows.map(normalizeUsageRow).filter((row): row is UsageRow => row !== undefined);
}

function runTokscaleJson(clients: string, commandTimeoutMs: number, command?: string) {
  const executable = command ?? process.env.AGENT_TRACE_TOKSCALE_BIN ?? resolveTokscaleCommand();

  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(
      executable,
      ["--json", "--client", clients, "--group-by", "client,session,model"],
      {
        windowsHide: true
      }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`tokscale timed out after ${commandTimeoutMs}ms`));
    }, commandTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(`tokscale exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }

      try {
        resolve(parseJsonOutput(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function resolveTokscaleCommand() {
  const binName = process.platform === "win32" ? "tokscale.CMD" : "tokscale";
  const localBin = resolve(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", ".bin", binName);

  return existsSync(localBin) ? localBin : "tokscale";
}

async function postCollectorJson(collectorUrl: string, path: string, body: unknown) {
  const response = await fetch(`${collectorUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`collector returned ${response.status}`);
  }
}

function parseJsonOutput(stdout: string) {
  const text = stdout.trim();

  if (!text) {
    throw new Error("tokscale produced empty stdout");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    const firstObject = text.indexOf("{");
    const firstArray = text.indexOf("[");
    const start = [firstObject, firstArray].filter((index) => index >= 0).sort((a, b) => a - b)[0];

    if (start !== undefined) {
      return JSON.parse(text.slice(start)) as unknown;
    }

    throw new Error(`Could not parse tokscale JSON output: ${text.slice(0, 300)}`);
  }
}

function collectUsageRows(value: unknown, rows: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUsageRows(item, rows);
    }
    return;
  }

  const record = asRecord(value);

  if (Object.keys(record).length === 0) {
    return;
  }

  if (looksLikeUsageRow(record)) {
    rows.push(record);
    return;
  }

  for (const item of Object.values(record)) {
    if (item !== null && typeof item === "object") {
      collectUsageRows(item, rows);
    }
  }
}

function looksLikeUsageRow(row: Record<string, unknown>) {
  return (
    tokenValue(row) > 0 &&
    Boolean(
      getString(row, "client", "source", "agent", "tool") ||
        getString(row, "model", "modelName", "model_name") ||
        getString(row, ...sessionIdKeys)
    )
  );
}

function normalizeUsageRow(row: Record<string, unknown>): UsageRow | undefined {
  const client = normalizeClient(getString(row, "client", "source", "agent", "tool"));

  if (!client) {
    return undefined;
  }

  const inputTokens = firstInteger(row, inputTokenKeys);
  const outputTokens = firstInteger(row, outputTokenKeys);
  const cacheReadTokens = firstInteger(row, cacheReadTokenKeys);
  const cacheWriteTokens = firstInteger(row, cacheWriteTokenKeys);
  const reasoningTokens = firstInteger(row, reasoningTokenKeys);
  const totalTokens = firstInteger(row, totalTokenKeys) || inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const costUsd = firstNumber(row, costKeys);
  const messageCount = firstInteger(row, messageCountKeys);

  return {
    client,
    sessionId: getString(row, ...sessionIdKeys),
    model: getString(row, "model", "modelName", "model_name", "deployment", "engine"),
    provider: normalizeProvider(getString(row, "provider")),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    costUsd: costUsd > 0 ? costUsd : undefined,
    messageCount: messageCount > 0 ? messageCount : undefined,
    startedAt: normalizeIso(getString(row, "startedAt", "started_at", "createdAt", "created_at")),
    lastUsedAt: normalizeIso(
      getString(row, "lastUsedAt", "last_used_at", "updatedAt", "updated_at", "lastActivityAt", "timestamp")
    )
  };
}

function tokenValue(row: Record<string, unknown>) {
  const direct = firstInteger(row, totalTokenKeys);

  if (direct > 0) {
    return direct;
  }

  return (
    firstInteger(row, inputTokenKeys) +
    firstInteger(row, outputTokenKeys) +
    firstInteger(row, cacheReadTokenKeys) +
    firstInteger(row, cacheWriteTokenKeys)
  );
}

function firstInteger(row: Record<string, unknown>, keys: string[]) {
  return Math.max(0, Math.round(firstNumber(row, keys)));
}

function firstNumber(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    const parsed = toNumber(value);

    if (parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function getString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[$,]/g, ""));

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  return 0;
}

function normalizeClient(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized === "claude-code") return "claude";
  if (normalized === "github-copilot") return "copilot";

  return normalized.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeProvider(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || undefined;
}

function normalizeClients(value: string) {
  return value
    .split(",")
    .map((client) => normalizeClient(client))
    .filter((client): client is string => Boolean(client))
    .join(",");
}

function normalizeIso(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const ms = new Date(value).getTime();

  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function normalizeIntervalMs(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? Math.max(1000, Math.floor(value))
    : 15_000;
}

function sleep(ms: number, signal: AbortSignal | undefined) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
