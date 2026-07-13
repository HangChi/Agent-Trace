import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findUncoveredCodexHistories } from "./codex-history.js";
import { collectTranscriptDetails } from "./transcript-collector.js";
import type { HistoryContentMode } from "./transcript.js";

export type UsageScanOptions = {
  collectorUrl?: string;
  clients?: string;
  commandTimeoutMs?: number;
  home?: string;
  historyContent?: HistoryContentMode;
  sync?: boolean;
  tokscaleCommand?: string;
  runTokscale?: (clients: string | undefined, commandTimeoutMs: number, home: string | undefined) => Promise<unknown>;
  runTokscaleClients?: (home: string | undefined, commandTimeoutMs: number) => Promise<unknown>;
  runTokscaleCommand?: (args: string[], commandTimeoutMs: number) => Promise<TokscaleCommandResult>;
  postJson?: (path: string, body: unknown) => Promise<void>;
};

export type UsageDiagnosticStatus =
  | "available"
  | "waiting"
  | "missing"
  | "needs_sync"
  | "needs_login"
  | "synced"
  | "error";

export type UsageDiagnostic = {
  client: string;
  status: UsageDiagnosticStatus;
  messageCount?: number;
  path?: string;
  pathExists?: boolean;
  warning?: string;
  actionHint?: string;
};

type TokscaleCommandResult = {
  code: number;
  stdout?: string;
  stderr?: string;
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
const autoSyncClients = "cursor,antigravity,trae,warp";
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
  const configuredClients = options.clients ?? process.env.AGENT_TRACE_USAGE_CLIENTS;
  const commandTimeoutMs = options.commandTimeoutMs ?? defaultCommandTimeoutMs;
  const home = normalizeHome(options.home ?? process.env.AGENT_TRACE_USAGE_HOME ?? process.env.TOKSCALE_HOME ?? homedir());
  const runTokscale = options.runTokscale ?? ((clientCsv, timeoutMs, scanHome) =>
    runTokscaleJson(clientCsv, timeoutMs, scanHome, options.tokscaleCommand));
  const postJson = options.postJson ?? ((path, body) => postCollectorJson(collectorUrl, path, body));
  const historyContent = normalizeHistoryContent(
    options.historyContent ?? process.env.AGENT_TRACE_HISTORY_CONTENT
  );

  if (options.sync) {
    await syncUsageClients({
      clients: options.clients,
      commandTimeoutMs,
      home,
      tokscaleCommand: options.tokscaleCommand,
      runTokscaleCommand: options.runTokscaleCommand
    });
  }

  const clientDiagnostics = await collectDiagnosticsForScan({
    commandTimeoutMs,
    home,
    tokscaleCommand: options.tokscaleCommand,
    runTokscaleClients: options.runTokscaleClients,
    skipClientDiagnostics: configuredClients !== undefined &&
      options.runTokscale !== undefined &&
      options.runTokscaleClients === undefined
  });
  const diagnosticsHaveClientList = hasDiagnosticClientList(clientDiagnostics);
  const clients = configuredClients === undefined
    ? getDefaultScanClients(clientDiagnostics, diagnosticsHaveClientList)
    : normalizeClients(configuredClients);
  const shouldRunPrimaryScan = configuredClients !== undefined ||
    (diagnosticsHaveClientList && clients !== undefined);
  const raw = shouldRunPrimaryScan ? await runTokscale(clients, commandTimeoutMs, home) : { entries: [] };
  const primaryRows = normalizeTokscaleUsage(raw);
  const reconciliation = shouldRunPrimaryScan && shouldReconcileCodex(clients) && home
    ? await findUncoveredCodexHistories(
        home,
        primaryRows
          .filter((row) => row.client === "codex" && row.sessionId)
          .map((row) => row.sessionId!)
      )
    : { files: [], diagnostics: [] };
  const supplementalRows = reconciliation.files.length > 0
    ? await scanSupplementalCodexHistories(
        reconciliation.files,
        commandTimeoutMs,
        runTokscale
      )
    : [];
  const rows = mergeUsageRows(primaryRows, supplementalRows);
  const diagnostics = [
    ...clientDiagnostics,
    ...getUsageWarningDiagnostics(raw),
    ...reconciliation.diagnostics
  ];
  const reconciledClients = configuredClients === undefined && diagnosticsHaveClientList
    ? getDiagnosticClientIds(clientDiagnostics)
    : clients?.split(",").filter(Boolean);
  const transcriptSnapshot = home
    ? await collectTranscriptDetails(home, rows, historyContent)
    : { clients: [], sessionKeys: [], transcripts: [] };
  const transcriptClients = transcriptSnapshot.clients.filter((client) =>
    reconciledClients?.includes(client)
  );

  await postJson("/integrations/usage-scan", {
    source: "tokscale",
    complete: true,
    explicitClients: configuredClients === undefined ? undefined : clients?.split(",").filter(Boolean),
    reconciledClients:
      reconciledClients && reconciledClients.length > 0 ? reconciledClients : undefined,
    transcriptClients: transcriptClients.length > 0 ? transcriptClients : undefined,
    transcriptSessionIds: transcriptSnapshot.sessionKeys,
    transcripts: transcriptSnapshot.transcripts,
    scannedAt: new Date().toISOString(),
    rows,
    diagnostics: diagnostics.length > 0 ? mergeDiagnostics(diagnostics) : undefined
  });

  return {
    rows: rows.length,
    diagnostics: diagnostics.length,
    transcripts: transcriptSnapshot.transcripts.length
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

export async function collectUsageClientDiagnostics(
  options: Pick<
    UsageScanOptions,
    "commandTimeoutMs" | "home" | "tokscaleCommand" | "runTokscaleClients"
  > = {}
): Promise<UsageDiagnostic[]> {
  const commandTimeoutMs = options.commandTimeoutMs ?? defaultCommandTimeoutMs;
  const home = normalizeHome(options.home ?? process.env.AGENT_TRACE_USAGE_HOME ?? process.env.TOKSCALE_HOME ?? homedir());
  const runTokscaleClients =
    options.runTokscaleClients ?? ((clientHome, timeoutMs) =>
      runTokscaleClientsJson(clientHome, timeoutMs, options.tokscaleCommand));
  const raw = await runTokscaleClients(home, commandTimeoutMs);

  return applyLocalPathEvidence(normalizeTokscaleClientDiagnostics(raw), home);
}

export async function syncUsageClients(
  options: Pick<
    UsageScanOptions,
    "clients" | "commandTimeoutMs" | "home" | "tokscaleCommand" | "runTokscaleCommand"
  > = {}
): Promise<UsageDiagnostic[]> {
  const clients = (normalizeClients(options.clients ?? autoSyncClients) ?? "").split(",").filter(Boolean);
  const commandTimeoutMs = options.commandTimeoutMs ?? defaultCommandTimeoutMs;
  const home = normalizeHome(options.home ?? process.env.AGENT_TRACE_USAGE_HOME ?? process.env.TOKSCALE_HOME ?? homedir());
  const runCommand =
    options.runTokscaleCommand ?? ((args, timeoutMs) =>
      runTokscaleCommand(args, timeoutMs, options.tokscaleCommand));
  const diagnostics: UsageDiagnostic[] = [];

  for (const client of clients) {
    if (!isSyncBackedClient(client)) {
      diagnostics.push({
        client,
        status: "waiting",
        warning: "tokscale sync is not available for this client; it will be scanned from local files if supported."
      });
      continue;
    }

    const statusArgs = getStatusArgs(client, home);

    if (statusArgs !== undefined) {
      const status = await runCommand(statusArgs, commandTimeoutMs);

      if (status.code !== 0) {
        diagnostics.push({
          client,
          status: "needs_login",
          warning: (status.stderr || status.stdout || "tokscale status failed").trim(),
          actionHint: getSyncActionHint(client, home)
        });
        continue;
      }
    }

    const result = await runCommand(getSyncArgs(client, home), commandTimeoutMs);
    diagnostics.push({
      client,
      status: result.code === 0 ? "synced" : "error",
      warning: result.code === 0 ? undefined : (result.stderr || result.stdout || "tokscale sync failed").trim(),
      actionHint: result.code === 0 ? undefined : getSyncActionHint(client, home)
    });
  }

  return diagnostics;
}

export function normalizeTokscaleUsage(value: unknown): UsageRow[] {
  const rows: Record<string, unknown>[] = [];

  collectUsageRows(value, rows);

  return rows.map(normalizeUsageRow).filter((row): row is UsageRow => row !== undefined);
}

async function scanSupplementalCodexHistories(
  files: string[],
  commandTimeoutMs: number,
  runTokscale: NonNullable<UsageScanOptions["runTokscale"]>
) {
  const temporaryHome = await mkdtemp(join(tmpdir(), "agent-trace-codex-history-"));

  try {
    const sessionsRoot = join(temporaryHome, ".codex", "sessions");

    for (const [index, source] of files.entries()) {
      const targetDir = join(sessionsRoot, String(index));
      await mkdir(targetDir, { recursive: true });
      await copyFile(source, join(targetDir, basename(source)));
    }

    const raw = await runTokscale("codex", commandTimeoutMs, temporaryHome);

    return normalizeTokscaleUsage(raw);
  } finally {
    await rm(temporaryHome, { recursive: true, force: true });
  }
}

function mergeUsageRows(primary: UsageRow[], supplemental: UsageRow[]) {
  const rows = new Map<string, UsageRow>();

  for (const row of [...primary, ...supplemental]) {
    const key = [row.client, row.sessionId ?? "", row.model ?? "", row.provider ?? ""].join("\0");

    if (!rows.has(key)) {
      rows.set(key, row);
    }
  }

  return [...rows.values()];
}

function hasDiagnosticClientList(diagnostics: UsageDiagnostic[]) {
  return diagnostics.some((diagnostic) => diagnostic.client !== "tokscale");
}

function getDefaultScanClients(diagnostics: UsageDiagnostic[], hasClientList: boolean) {
  if (!hasClientList) {
    return undefined;
  }

  const clients = diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.client !== "micode" &&
        diagnostic.pathExists === true &&
        (diagnostic.status === "available" || diagnostic.status === "waiting")
    )
    .map((diagnostic) => diagnostic.client);

  return clients.length > 0 ? [...new Set(clients)].join(",") : undefined;
}

function getDiagnosticClientIds(diagnostics: UsageDiagnostic[]) {
  return [
    ...new Set(
      diagnostics
        .map((diagnostic) => diagnostic.client)
        .filter((client) => client && client !== "tokscale")
    )
  ];
}

function shouldReconcileCodex(clients: string | undefined) {
  return clients === undefined || clients.split(",").includes("codex");
}

function normalizeTokscaleClientDiagnostics(value: unknown): UsageDiagnostic[] {
  const body = asRecord(value);
  const clients = asArray(body.clients) ?? asArray(value) ?? [];

  return clients
    .map((item) => normalizeClientDiagnostic(asRecord(item)))
    .filter((diagnostic): diagnostic is UsageDiagnostic => diagnostic !== undefined);
}

async function collectDiagnosticsForScan(
  options: Pick<UsageScanOptions, "commandTimeoutMs" | "home" | "tokscaleCommand" | "runTokscaleClients"> & {
    skipClientDiagnostics?: boolean;
  }
) {
  if (options.skipClientDiagnostics) {
    return [];
  }

  try {
    return await collectUsageClientDiagnostics(options);
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);

    return [
      {
        client: "tokscale",
        status: "error",
        warning
      } satisfies UsageDiagnostic
    ];
  }
}

function normalizeClientDiagnostic(record: Record<string, unknown>): UsageDiagnostic | undefined {
  const client = normalizeClient(getString(record, "client", "name", "id"));

  if (!client) {
    return undefined;
  }

  const messageCount = firstInteger(record, [
    "messageCount",
    "message_count",
    "messages",
    "totalMessages",
    "total_messages",
    "headlessMessageCount",
    "headless_message_count"
  ]);
  const path = getString(record, "sessionsPath", "sessions_path", "path", "cachePath", "cache_path");
  const primaryPathExists = getBoolean(
    record,
    "sessionsPathExists",
    "sessions_path_exists",
    "pathExists",
    "path_exists"
  );
  const alternativePathExists = anyKnownPathExists(record);
  const pathExists = primaryPathExists === true || alternativePathExists === true
    ? true
    : primaryPathExists ?? alternativePathExists;
  const status = getDiagnosticStatus(client, messageCount, pathExists);

  return {
    client,
    status,
    messageCount: messageCount > 0 ? messageCount : undefined,
    path,
    pathExists,
    actionHint: status === "needs_sync" || status === "needs_login" ? getSyncActionHint(client) : undefined
  };
}

function getUsageWarningDiagnostics(value: unknown): UsageDiagnostic[] {
  const warnings = getWarnings(value);

  return warnings.map((warning) => {
    const client = getClientFromWarning(warning);
    const status: UsageDiagnosticStatus = client === "cursor" ||
      client === "antigravity" ||
      client === "trae" ||
      client === "warp"
      ? "needs_sync"
      : "error";

    return {
      client,
      status,
      warning,
      actionHint: status === "needs_sync" ? getSyncActionHint(client) : undefined
    };
  });
}

function mergeDiagnostics(diagnostics: UsageDiagnostic[]) {
  const merged = new Map<string, UsageDiagnostic>();

  for (const diagnostic of diagnostics) {
    const existing = merged.get(diagnostic.client);

    merged.set(diagnostic.client, {
      ...existing,
      ...diagnostic,
      warning: diagnostic.warning ?? existing?.warning,
      actionHint: diagnostic.actionHint ?? existing?.actionHint,
      messageCount: diagnostic.messageCount ?? existing?.messageCount,
      path: diagnostic.path ?? existing?.path,
      pathExists: diagnostic.pathExists ?? existing?.pathExists
    });
  }

  return [...merged.values()];
}

function runTokscaleJson(
  clients: string | undefined,
  commandTimeoutMs: number,
  home: string | undefined,
  command?: string
) {
  const args = ["--json", "--group-by", "client,session,model"];

  if (clients) {
    args.splice(1, 0, "--client", clients);
  }

  if (home) {
    args.push("--home", home);
  }

  return runTokscaleCommand(args, commandTimeoutMs, command).then((result) => {
    if (result.code !== 0) {
      throw new Error(`tokscale exited with code ${result.code}: ${(result.stderr || result.stdout || "").trim()}`);
    }

    return parseJsonOutput(result.stdout ?? "");
  });
}

function runTokscaleClientsJson(
  home: string | undefined,
  commandTimeoutMs: number,
  command?: string
) {
  const args = ["clients", "--json"];

  if (home) {
    args.push("--home", home);
  }

  return runTokscaleCommand(args, commandTimeoutMs, command).then((result) => {
    if (result.code !== 0) {
      throw new Error(`tokscale clients exited with code ${result.code}: ${(result.stderr || result.stdout || "").trim()}`);
    }

    return parseJsonOutput(result.stdout ?? "");
  });
}

function runTokscaleCommand(
  args: string[],
  commandTimeoutMs: number,
  command?: string
): Promise<TokscaleCommandResult> {
  const override = command ?? process.env.AGENT_TRACE_TOKSCALE_BIN;
  const invocation = override
    ? { executable: override, args: [] }
    : resolveTokscaleCommand();

  return new Promise<TokscaleCommandResult>((resolve, reject) => {
    const child = spawn(invocation.executable, [...invocation.args, ...args], { windowsHide: true });
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
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

export function resolveTokscaleCommand() {
  const localBin = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    "tokscale",
    "bin.js"
  );

  return existsSync(localBin)
    ? { executable: process.execPath, args: [localBin] }
    : { executable: "tokscale", args: [] };
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
  const totalTokens =
    firstInteger(row, totalTokenKeys) ||
    inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
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

function getDiagnosticStatus(
  client: string,
  messageCount: number,
  pathExists: boolean | undefined
): UsageDiagnosticStatus {
  if (pathExists === true && messageCount > 0) {
    return "available";
  }

  if (isSyncBackedClient(client)) {
    return "needs_sync";
  }

  return pathExists === true ? "waiting" : "missing";
}

function applyLocalPathEvidence(diagnostics: UsageDiagnostic[], home: string | undefined) {
  if (!home) return diagnostics;

  return diagnostics.map((diagnostic) => {
    if (diagnostic.client !== "opencode" || diagnostic.pathExists === true) return diagnostic;
    const directory = join(home, ".local", "share", "opencode");
    let databasePath: string | undefined;

    try {
      const database = readdirSync(directory)
        .filter((name) => /^opencode(?:-[A-Za-z0-9._-]+)?\.db$/.test(name))
        .sort()[0];
      databasePath = database ? join(directory, database) : undefined;
    } catch {
      databasePath = undefined;
    }

    if (!databasePath || !existsSync(databasePath)) return diagnostic;

    const status: UsageDiagnosticStatus = diagnostic.messageCount && diagnostic.messageCount > 0
      ? "available"
      : "waiting";

    return {
      ...diagnostic,
      status,
      path: databasePath,
      pathExists: true
    };
  });
}

function isSyncBackedClient(client: string) {
  return client === "cursor" || client === "antigravity" || client === "trae" || client === "warp";
}

function getStatusArgs(client: string, home: string | undefined) {
  if (client !== "cursor" && client !== "trae") {
    return undefined;
  }

  return withHome([client, "status"], home);
}

function getSyncArgs(client: string, home: string | undefined) {
  const args = client === "cursor" || client === "trae"
    ? [client, "sync", "--json"]
    : [client, "sync"];

  return withHome(args, home);
}

function withHome(args: string[], home: string | undefined) {
  return home ? [...args, "--home", home] : args;
}

function getSyncActionHint(client: string, home?: string) {
  const homeArg = home ? ` --home ${home}` : "";

  if (client === "cursor" || client === "trae") {
    return `Run tokscale ${client} login, then tokscale ${client} sync --json${homeArg}`;
  }

  if (client === "antigravity" || client === "warp") {
    return `Run tokscale ${client} sync${homeArg}`;
  }

  return `Run tokscale ${client} status${homeArg}`;
}

function getWarnings(value: unknown): string[] {
  const body = asRecord(value);
  const warnings = asArray(body.warnings) ?? asArray(body.warning) ?? [];

  return warnings
    .map((warning) => (typeof warning === "string" ? warning.trim() : undefined))
    .filter((warning): warning is string => Boolean(warning));
}

function getClientFromWarning(warning: string) {
  const lower = warning.toLowerCase();

  for (const client of ["cursor", "antigravity", "trae", "warp"]) {
    if (lower.includes(client)) {
      return client;
    }
  }

  return "tokscale";
}

function anyKnownPathExists(record: Record<string, unknown>) {
  for (const key of ["additionalPaths", "additional_paths", "headlessPaths", "headless_paths", "legacyPaths", "legacy_paths"]) {
    const paths = asArray(record[key]);

    if (paths?.some((item) => getBoolean(asRecord(item), "exists") === true)) {
      return true;
    }
  }

  return undefined;
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
  const clients = value
    .split(",")
    .map((client) => normalizeClient(client))
    .filter((client): client is string => Boolean(client))
    .join(",");

  return clients || undefined;
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

export function normalizeHistoryContent(value: string | undefined): HistoryContentMode {
  return value?.trim().toLowerCase() === "metadata" ? "metadata" : "preview";
}

function getBoolean(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

function normalizeHome(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

export function isUsageScannerEnabled(value: string | undefined) {
  const configured = String(value ?? "").trim().toLowerCase();

  return configured !== "0" && configured !== "false" && configured !== "off";
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

function asArray(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}
