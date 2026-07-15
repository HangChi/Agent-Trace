import { createHash } from "node:crypto";

import type {
  DashboardTraceEvent,
  RedactedRunExport,
  Run
} from "@agent-trace/schema";

const safeMetadataKeys = [
  "agent",
  "surface",
  "redactionLevel",
  "provider",
  "model",
  "tokenUsage",
  "costUsd",
  "messageCount",
  "category",
  "toolName",
  "toolKind",
  "mcpServer",
  "mcpTool",
  "skillName",
  "source",
  "surfaceSource"
] as const;

export function createRedactedRunExport(
  run: Run,
  events: DashboardTraceEvent[],
  exportedAt = new Date().toISOString()
): RedactedRunExport {
  const runId = pseudonym("run", run.id);

  return {
    schemaVersion: 1,
    exportedAt,
    redaction: "metadata",
    run: {
      id: runId,
      name: "redacted-run",
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      metadata: pickSafeMetadata(run.metadata)
    },
    events: events.map((event) => ({
      id: pseudonym("event", event.id),
      runId,
      parentId: event.parentId ? pseudonym("event", event.parentId) : undefined,
      type: event.type,
      name: event.type,
      status: event.status,
      timestamp: event.timestamp,
      durationMs: event.durationMs,
      metadata: pickSafeMetadata(event.metadata)
    }))
  };
}

function pseudonym(prefix: "run" | "event", value: string) {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);

  return `${prefix}-${digest}`;
}

function pickSafeMetadata(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key of safeMetadataKeys) {
    const item = source[key];
    if (key === "tokenUsage") {
      const tokenUsage = pickSafeTokenUsage(item);
      if (tokenUsage) result[key] = tokenUsage;
    } else if (
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      result[key] = item;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function pickSafeTokenUsage(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, string | number | boolean> = {};
  const keys = [
    "input",
    "output",
    "total",
    "cachedInput",
    "cacheCreationInput",
    "cacheReadInput",
    "reasoningOutput",
    "estimated",
    "method",
    "source",
    "sourceKind",
    "scope"
  ];

  for (const key of keys) {
    const item = source[key];
    if (
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      result[key] = item;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
