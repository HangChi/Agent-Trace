import { createEvent, createRun, getRunById, updateRun, updateRunMetadata, upsertEvent } from "./storage.js";
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

  for (const trace of normalized) {
    const existingRun = await getRunById(trace.run.id);

    if (!existingRun) {
      await createRun(trace.run);
    } else if (isUsageScanRun(existingRun.input)) {
      await updateRunMetadata(trace.run.id, trace.run.metadata);
    }

    await updateRun(trace.run.id, {
      status: "success",
      endedAt: trace.event.timestamp
    });
    await upsertEvent(trace.event);
  }

  return {
    stored: normalized.length,
    eventIds: normalized.map((trace) => trace.event.id),
    runIds: [...new Set(normalized.map((trace) => trace.run.id))]
  };
}

function isUsageScanRun(input: unknown) {
  return asRecord(input).source === "usage-scan";
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
