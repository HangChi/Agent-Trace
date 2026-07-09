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

const redactionLevel = "metadata";

export function normalizeUsageScan(payload: unknown): UsageScanTrace[] {
  const body = asRecord(payload);
  const source = getString(body, "source") ?? "tokscale";
  const scannedAt = getIsoString(body, "scannedAt") ?? new Date().toISOString();
  const rows = asArray(body.rows);

  if (source !== "tokscale" || rows === undefined) {
    throw new Error("Invalid usage scan payload.");
  }

  return rows
    .map((row) => normalizeUsageScanRow(row, scannedAt))
    .filter((trace): trace is UsageScanTrace => trace !== undefined);
}

function normalizeUsageScanRow(value: unknown, scannedAt: string): UsageScanTrace | undefined {
  const row = asRecord(value);
  const client = normalizeClient(getString(row, "client", "source", "agent", "tool"));

  if (!client) {
    return undefined;
  }

  const agent = clientToAgent(client);
  const sessionId = getString(row, "sessionId", "session_id", "session", "conversationId", "threadId");
  const sessionKey = sessionId ?? "usage";
  const model = getString(row, "model", "modelName", "model_name");
  const provider = normalizeProvider(getString(row, "provider"));
  const tokenUsage = getScanTokenUsage(row);

  if (tokenUsage.total === 0 && getNumber(row, "costUsd", "cost_usd", "cost") === undefined) {
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
    usageClient: client
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

function getScanTokenUsage(row: Record<string, unknown>): TokenUsage {
  const input = getInteger(row, "inputTokens", "input_tokens", "input") ?? 0;
  const output = getInteger(row, "outputTokens", "output_tokens", "output") ?? 0;
  const cacheReadInput =
    getInteger(row, "cacheReadTokens", "cache_read_tokens", "cacheReadInputTokens") ?? 0;
  const cacheCreationInput =
    getInteger(row, "cacheWriteTokens", "cache_write_tokens", "cacheCreationInputTokens") ?? 0;
  const reasoningOutput =
    getInteger(row, "reasoningTokens", "reasoning_tokens", "reasoningOutputTokens") ?? 0;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}
