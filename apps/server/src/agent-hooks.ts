import {
  createEvent,
  createRun,
  getRunById,
  replaceUsageScanSnapshot,
  updateRun
} from "./storage.js";
import {
  knownHookEvents,
  normalizeAgentHook,
  normalizeCodexOtelLogs,
  type AgentHookSource,
  type IngestHints,
  type NormalizedTrace
} from "./agent-hook-normalizer.js";
import { normalizeUsageScan } from "./usage-scan.js";

export type { AgentHookSource } from "./agent-hook-normalizer.js";
export { knownHookEvents, normalizeAgentHook, normalizeCodexOtelLogs };

export async function ingestAgentHook(
  source: AgentHookSource,
  payload: unknown,
  hints: IngestHints = {}
) {
  const normalized = normalizeAgentHook(source, payload, hints);
  await persistTrace(normalized);

  return {
    eventId: normalized.event.id,
    runId: normalized.run.id
  };
}

export async function ingestCodexOtelLogs(payload: unknown, hints: IngestHints = {}) {
  const normalized = normalizeCodexOtelLogs(payload, hints);

  for (const trace of normalized) {
    await persistTrace(trace);
  }

  return {
    stored: normalized.length,
    eventIds: normalized.map((trace) => trace.event.id),
    runIds: [...new Set(normalized.map((trace) => trace.run.id))]
  };
}

export async function ingestUsageScan(payload: unknown) {
  const normalized = normalizeUsageScan(payload);
  const complete = asRecord(payload).complete === true;
  const scanClients = getScanClients(asRecord(payload).scanClients);
  replaceUsageScanSnapshot(normalized, complete, scanClients);

  return {
    stored: normalized.length,
    eventIds: normalized.map((trace) => trace.event.id),
    runIds: [...new Set(normalized.map((trace) => trace.run.id))]
  };
}

function getScanClients(value: unknown) {
  const clients = Array.isArray(value)
    ? value.filter((client): client is string => typeof client === "string" && client.length > 0)
    : [];

  return clients.length > 0 ? new Set(clients) : undefined;
}

async function persistTrace(normalized: NormalizedTrace) {
  const existingRun = await getRunById(normalized.run.id);

  if (!existingRun) {
    await createRun(normalized.run);
  }

  await createEvent(normalized.event);

  if (normalized.runUpdate) {
    await updateRun(normalized.run.id, normalized.runUpdate);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
