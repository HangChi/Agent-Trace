import { createHash } from "node:crypto";

import type { CreateRun, CreateTraceEvent, TokenUsage, TraceMetadata } from "@agent-trace/schema";

export type UsageScanTrace = {
  run: CreateRun;
  event: CreateTraceEvent;
};

type UsageScanRow = {
  client: string;
  agent: string;
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

type UsageScanDiagnostic = {
  client: string;
  status: string;
  messageCount?: number;
  path?: string;
  pathExists?: boolean;
  warning?: string;
  actionHint?: string;
};

const redactionLevel = "metadata";

export function normalizeUsageScan(payload: unknown): UsageScanTrace[] {
  const body = asRecord(payload);
  const source = getString(body, "source") ?? "tokscale";
  const scannedAt = getIsoString(body, "scannedAt") ?? new Date().toISOString();
  const rows = asArray(body.rows);

  if (source !== "tokscale" || rows === undefined) {
    throw new Error("Invalid usage scan payload.");
  }

  const usageTraces = rows
    .map((row) => normalizeUsageScanRow(row, scannedAt))
    .filter((trace): trace is UsageScanTrace => trace !== undefined);
  const diagnosticsTrace = normalizeUsageDiagnostics(asArray(body.diagnostics), scannedAt);

  return diagnosticsTrace ? [...usageTraces, diagnosticsTrace] : usageTraces;
}

function normalizeUsageScanRow(value: unknown, scannedAt: string): UsageScanTrace | undefined {
  const row = asRecord(value);
  const client = normalizeClient(getString(row, "client", "source", "agent", "tool"));

  if (!client) {
    return undefined;
  }

  const agent = clientToAgent(client);
  const rawSessionId = getString(row, "sessionId", "session_id", "session", "conversationId", "threadId");
  const sessionId = normalizeSessionId(agent, rawSessionId);
  const sessionKey = sessionId ?? "usage";
  const model = getString(row, "model", "modelName", "model_name");
  const provider = normalizeProvider(getString(row, "provider"));
  const tokenUsage = getScanTokenUsage(row);

  if (tokenUsage.total === 0 && !hasPositiveCost(row)) {
    return undefined;
  }

  const startedAt = getIsoString(row, "startedAt", "started_at", "createdAt", "created_at") ?? scannedAt;
  const lastUsedAt =
    getIsoString(row, "lastUsedAt", "last_used_at", "updatedAt", "updated_at", "timestamp") ??
    scannedAt;
  const costUsd = getNumber(row, "costUsd", "cost_usd", "cost");
  const messageCount = getInteger(row, "messageCount", "message_count", "messages");
  const runId = createRunId(agent, sessionKey);
  const metadata = compactMetadata({
    agent,
    surface: "local",
    sessionId: sessionKey,
    redactionLevel,
    provider,
    model,
    category: "tokens",
    tokenUsage,
    costUsd,
    messageCount,
    source: "usage-scan",
    usageSource: "tokscale",
    usageClient: client,
    usageSessionId: rawSessionId && rawSessionId !== sessionKey ? rawSessionId : undefined
  });

  return {
    run: {
      id: runId,
      name: `${agent}:${sessionKey}`,
      status: "running",
      startedAt,
      input: {
        source: "usage-scan",
        usageSource: "tokscale",
        redactionLevel
      },
      metadata
    },
    event: {
      id: createUsageEventId(agent, sessionKey, model, provider),
      runId,
      type: "llm_call",
      name: "token_usage",
      status: "success",
      timestamp: lastUsedAt,
      output: {
        tokenUsage,
        costUsd
      },
      metadata
    }
  };
}

function normalizeUsageDiagnostics(
  value: unknown[] | undefined,
  scannedAt: string
): UsageScanTrace | undefined {
  const diagnostics = (value ?? [])
    .map((item) => normalizeUsageDiagnostic(asRecord(item)))
    .filter((diagnostic): diagnostic is UsageScanDiagnostic => diagnostic !== undefined);

  if (diagnostics.length === 0) {
    return undefined;
  }

  const metadata = compactMetadata({
    agent: "usage-scan",
    surface: "local",
    redactionLevel,
    category: "scanner",
    source: "usage-scan",
    usageSource: "tokscale",
    diagnostics
  });

  return {
    run: {
      id: "run_usage_scan_status",
      name: "usage-scan:status",
      status: "success",
      startedAt: scannedAt,
      input: {
        source: "usage-scan",
        usageSource: "tokscale",
        redactionLevel
      },
      metadata
    },
    event: {
      id: "evt_usage_scan_status",
      runId: "run_usage_scan_status",
      type: "step_ended",
      name: "usage_scan_status",
      status: "success",
      timestamp: scannedAt,
      output: {
        diagnostics
      },
      metadata
    }
  };
}

function normalizeUsageDiagnostic(record: Record<string, unknown>): UsageScanDiagnostic | undefined {
  const client = normalizeClient(getString(record, "client", "source", "agent", "tool"));
  const status = getString(record, "status");

  if (!client || !status) {
    return undefined;
  }

  return compactObject({
    client,
    status,
    messageCount: getInteger(record, "messageCount", "message_count", "messages"),
    path: getString(record, "path"),
    pathExists: getBoolean(record, "pathExists", "path_exists"),
    warning: getString(record, "warning"),
    actionHint: getString(record, "actionHint", "action_hint")
  }) as UsageScanDiagnostic;
}

function getScanTokenUsage(row: Record<string, unknown>): TokenUsage {
  const input = getInteger(row, "inputTokens", "input_tokens", "input") ?? 0;
  const output = getInteger(row, "outputTokens", "output_tokens", "output") ?? 0;
  const cacheReadInput =
    getInteger(row, "cacheReadTokens", "cache_read_tokens", "cacheReadInputTokens", "cacheRead") ??
    0;
  const cacheCreationInput =
    getInteger(row, "cacheWriteTokens", "cache_write_tokens", "cacheCreationInputTokens", "cacheWrite") ??
    0;
  const reasoningOutput =
    getInteger(row, "reasoningTokens", "reasoning_tokens", "reasoningOutputTokens", "reasoning") ?? 0;
  const total =
    getInteger(row, "totalTokens", "total_tokens", "total") ??
    input + output + cacheReadInput + cacheCreationInput;

  return compactTokenUsage({
    input,
    output,
    total,
    cachedInput: cacheReadInput,
    cacheCreationInput,
    cacheReadInput,
    reasoningOutput,
    source: "tokscale",
    sourceKind: "scan",
    scope: "session",
    method: "tokscale"
  });
}

function hasPositiveCost(row: Record<string, unknown>) {
  return (getNumber(row, "costUsd", "cost_usd", "cost") ?? 0) > 0;
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

function clientToAgent(client: string) {
  if (client === "claude") return "claude-code";
  if (client === "copilot") return "github-copilot";

  return client;
}

function normalizeSessionId(agent: string, sessionId: string | undefined) {
  if (agent !== "codex" || !sessionId?.startsWith("rollout-")) {
    return sessionId;
  }

  const match = sessionId.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
  );

  return match?.[1]?.toLowerCase() ?? sessionId;
}

function normalizeProvider(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || undefined;
}

function createRunId(agent: string, sessionId: string) {
  return `run_${toIdPart(agent)}_${toIdPart(sessionId)}`;
}

function createUsageEventId(
  agent: string,
  sessionId: string,
  model: string | undefined,
  provider: string | undefined
) {
  const hash = createHash("sha256")
    .update([agent, sessionId, model ?? "unknown", provider ?? "unknown"].join("\0"))
    .digest("hex")
    .slice(0, 12);

  return `evt_usage_${toIdPart(agent)}_${toIdPart(sessionId)}_${hash}`;
}

function toIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

function getString(record: Record<string, unknown>, ...keys: string[]) {
  const value = getValue(record, ...keys);

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getIsoString(record: Record<string, unknown>, ...keys: string[]) {
  const value = getString(record, ...keys);

  if (!value) {
    return undefined;
  }

  const ms = new Date(value).getTime();

  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function getInteger(record: Record<string, unknown>, ...keys: string[]) {
  const number = getNumber(record, ...keys);

  return number === undefined ? undefined : Math.floor(number);
}

function getNumber(record: Record<string, unknown>, ...keys: string[]) {
  const value = getValue(record, ...keys);

  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[$,]/g, ""));

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  return undefined;
}

function getBoolean(record: Record<string, unknown>, ...keys: string[]) {
  const value = getValue(record, ...keys);

  return typeof value === "boolean" ? value : undefined;
}

function getValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function compactTokenUsage(usage: TokenUsage): TokenUsage {
  return Object.fromEntries(
    Object.entries(usage).filter(([, entry]) => entry !== undefined)
  ) as TokenUsage;
}

function compactMetadata(value: TraceMetadata) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as TraceMetadata;
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}
