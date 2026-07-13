import type { ScannerDiagnostic, UsageSnapshot, UsageSnapshotRow } from "./usage-storage.js";

export function normalizeUsageScan(payload: unknown): UsageSnapshot {
  const body = asRecord(payload);
  const source = getString(body, "source") ?? "tokscale";
  const scannedAt = getIsoString(body, "scannedAt") ?? new Date().toISOString();
  const values = asArray(body.rows);

  if (source !== "tokscale" || values === undefined) {
    throw new Error("Invalid usage scan payload.");
  }

  const diagnosticValues = asArray(body.diagnostics);
  const diagnostics = diagnosticValues
    ?.map((value) => normalizeDiagnostic(asRecord(value)))
    .filter((item): item is ScannerDiagnostic => item !== undefined);
  const explicitClients = getStringArray(body.explicitClients) ?? [];
  const diagnosticByClient = new Map(diagnostics?.map((item) => [item.client, item]));
  const rows = values
    .map((value) => normalizeUsageRow(asRecord(value)))
    .filter((row): row is UsageSnapshotRow => row !== undefined)
    .filter((row) => isEligibleRow(row.client, explicitClients, diagnosticByClient));
  const requestedReconciledClients =
    getStringArray(body.reconciledClients) ?? getStringArray(body.scanClients);
  const complete = body.complete !== false;
  const reconciledClients = complete
    ? requestedReconciledClients ?? [...new Set(rows.map((row) => row.client))]
    : [];

  return {
    scannedAt,
    reconciledClients,
    rows,
    diagnostics,
    error: getString(body, "error")
  };
}

function normalizeUsageRow(row: Record<string, unknown>): UsageSnapshotRow | undefined {
  const client = normalizeClient(getString(row, "client", "source", "agent", "tool"));

  if (!client) return undefined;

  const inputTokens = getInteger(row, "inputTokens", "input_tokens", "input") ?? 0;
  const outputTokens = getInteger(row, "outputTokens", "output_tokens", "output") ?? 0;
  const cacheReadTokens =
    getInteger(row, "cacheReadTokens", "cache_read_tokens", "cacheReadInputTokens", "cacheRead") ?? 0;
  const cacheWriteTokens =
    getInteger(row, "cacheWriteTokens", "cache_write_tokens", "cacheCreationInputTokens", "cacheWrite") ?? 0;
  const reasoningTokens =
    getInteger(row, "reasoningTokens", "reasoning_tokens", "reasoningOutputTokens", "reasoning") ?? 0;
  const totalTokens =
    getInteger(row, "totalTokens", "total_tokens", "total") ??
    inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const costUsd = getNumber(row, "costUsd", "cost_usd", "cost");

  if (totalTokens === 0 && (costUsd ?? 0) === 0) return undefined;

  return {
    client,
    sessionId: normalizeSessionId(client, getString(
      row,
      "sessionId",
      "session_id",
      "session",
      "conversationId",
      "threadId"
    )),
    model: getString(row, "model", "modelName", "model_name"),
    provider: normalizeProvider(getString(row, "provider")),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    costUsd,
    messageCount: getInteger(row, "messageCount", "message_count", "messages"),
    startedAt: getIsoString(row, "startedAt", "started_at", "createdAt", "created_at"),
    lastUsedAt: getIsoString(
      row,
      "lastUsedAt",
      "last_used_at",
      "updatedAt",
      "updated_at",
      "timestamp"
    )
  };
}

function normalizeDiagnostic(record: Record<string, unknown>): ScannerDiagnostic | undefined {
  const client = normalizeClient(getString(record, "client", "source", "agent", "tool"));
  const rawStatus = getString(record, "status");
  const pathExists = getBoolean(record, "pathExists", "path_exists");

  if (!client || !rawStatus) return undefined;
  const status = pathExists === false && ["available", "waiting"].includes(rawStatus)
    ? "missing"
    : rawStatus;

  return compact({
    client,
    status,
    messageCount: getInteger(record, "messageCount", "message_count", "messages"),
    path: getString(record, "path"),
    pathExists,
    warning: getString(record, "warning"),
    actionHint: getString(record, "actionHint", "action_hint")
  }) as ScannerDiagnostic;
}

function isEligibleRow(
  client: string,
  explicitClients: string[],
  diagnostics: Map<string, ScannerDiagnostic>
) {
  if (explicitClients.includes(client)) return true;
  if (client === "micode") return false;
  const diagnostic = diagnostics.get(client);
  return diagnostic === undefined || diagnostic.pathExists === true;
}

function normalizeSessionId(client: string, sessionId: string | undefined) {
  if (client !== "codex" || !sessionId?.startsWith("rollout-")) return sessionId;

  return sessionId.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
  )?.[1]?.toLowerCase() ?? sessionId;
}

function normalizeClient(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "claude-code") return "claude";
  if (normalized === "github-copilot") return "copilot";
  return normalized.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeProvider(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || undefined;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => normalizeClient(typeof item === "string" ? item : undefined))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? [...new Set(items)] : undefined;
}

function getIsoString(record: Record<string, unknown>, ...keys: string[]) {
  const value = getString(record, ...keys);
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function getInteger(record: Record<string, unknown>, ...keys: string[]) {
  const value = getNumber(record, ...keys);
  return value === undefined ? undefined : Math.max(0, Math.floor(value));
}

function getNumber(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[$,]/g, ""));
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }
  return undefined;
}

function getString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function getBoolean(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
  }
  return undefined;
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}
