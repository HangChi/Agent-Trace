import {
  createEvent,
  createRun,
  getRunById,
  replaceTranscriptSnapshot,
  updateRun
} from "./storage.js";
import { replaceUsageSnapshot } from "./usage-storage.js";
import {
  knownHookEvents,
  normalizeAgentHook,
  normalizeCodexOtelLogs,
  type AgentHookSource,
  type IngestHints,
  type NormalizedTrace
} from "./agent-hook-normalizer.js";
import { normalizeUsageScan } from "./usage-scan.js";
import { normalizeTranscriptScan } from "./transcript-scan.js";

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
  const transcripts = normalizeTranscriptScan(payload);
  await replaceUsageSnapshot(normalized);
  await replaceTranscriptSnapshot(transcripts.traces, transcripts.clients, transcripts.sessionKeys);

  return {
    stored: normalized.rows.length,
    transcripts: transcripts.traces.length,
    reconciledClients: normalized.reconciledClients
  };
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
