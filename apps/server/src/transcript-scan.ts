import { createHash } from "node:crypto";

import type { CreateRun, CreateTraceEvent, TokenUsage } from "@agent-trace/schema";

export type TranscriptTrace = { run: CreateRun; events: CreateTraceEvent[]; client: string };

export function normalizeTranscriptScan(payload: unknown): {
  traces: TranscriptTrace[];
  clients: string[];
  sessionKeys: string[];
} {
  const body = asRecord(payload);
  const clients = getStringArray(body.transcriptClients);
  const sessionKeys = getStringArray(body.transcriptSessionIds);
  const traces = (Array.isArray(body.transcripts) ? body.transcripts : [])
    .map((value) => normalizeSession(asRecord(value)))
    .filter((trace): trace is TranscriptTrace => trace !== undefined);

  return { traces, clients, sessionKeys };
}

function normalizeSession(session: Record<string, unknown>): TranscriptTrace | undefined {
  const client = normalizeClient(getString(session.client));
  const sessionId = getString(session.sessionId);
  const startedAt = getIso(session.startedAt);
  const lastUsedAt = getIso(session.lastUsedAt);
  const values = Array.isArray(session.events) ? session.events : [];

  if (!client || !sessionId || !startedAt || !lastUsedAt || values.length === 0) return undefined;

  const agent = client === "claude" ? "claude-code" : client;
  const runId = `run_${toIdPart(agent)}_${toIdPart(sessionId)}`;
  const baseMetadata = {
    agent,
    surface: "local",
    sessionId,
    redactionLevel: getString(session.contentMode) === "metadata" ? "metadata" : "preview",
    provider: getString(session.provider),
    model: getString(session.model),
    source: "transcript",
    transcriptClient: client
  };
  const events: CreateTraceEvent[] = [];

  values.forEach((value, index) => {
    const event = asRecord(value);
    const kind = getString(event.kind);
    const timestamp = getIso(event.timestamp);
    if (!timestamp || (kind !== "prompt" && kind !== "turn")) return;

    if (kind === "prompt") {
      events.push({
        id: createEventId(client, sessionId, index, "prompt"),
        runId,
        type: "step_started",
        name: "user_prompt",
        status: "success",
        timestamp,
        input: getString(event.text) ? { promptPreview: getString(event.text) } : undefined,
        metadata: { ...baseMetadata, category: "lifecycle", hookEvent: "UserPromptSubmit" }
      });
      return;
    }

    const tokenUsage = normalizeTokens(asRecord(event.tokens));
    const turnId = createEventId(client, sessionId, index, "turn");
    events.push({
      id: turnId,
      runId,
      type: "llm_call",
      name: "assistant_turn",
      status: "success",
      timestamp,
      output: { tokenUsage },
      metadata: {
        ...baseMetadata,
        category: "tokens",
        tokenUsage,
        costUsd: getNumber(event.costUsd),
        costEstimated: event.costEstimated === true
      }
    });

    getStringArray(event.tools).forEach((tool, toolIndex) => {
      events.push({
        id: createEventId(client, sessionId, index, `tool-${toolIndex}-${tool}`),
        runId,
        parentId: turnId,
        type: "tool_call",
        name: tool,
        status: "success",
        timestamp,
        metadata: {
          ...baseMetadata,
          category: "tool",
          toolName: tool,
          toolKind: "tool"
        }
      });
    });
  });

  if (events.length === 0) return undefined;

  return {
    client,
    run: {
      id: runId,
      name: getString(session.title) || `${agent}:${sessionId}`,
      status: "success",
      startedAt,
      endedAt: lastUsedAt,
      input: { source: "transcript-scan", redactionLevel: baseMetadata.redactionLevel },
      metadata: baseMetadata
    },
    events
  };
}

function normalizeTokens(value: Record<string, unknown>): TokenUsage {
  return {
    input: getInteger(value.input),
    output: getInteger(value.output),
    total: getInteger(value.total),
    cachedInput: getInteger(value.cacheRead),
    cacheReadInput: getInteger(value.cacheRead),
    cacheCreationInput: getInteger(value.cacheWrite),
    reasoningOutput: getInteger(value.reasoning),
    source: "local-transcript",
    sourceKind: "official",
    scope: "event",
    method: "transcript"
  };
}

function createEventId(client: string, sessionId: string, index: number, kind: string) {
  const hash = createHash("sha256")
    .update([client, sessionId, String(index), kind].join("\0"))
    .digest("hex")
    .slice(0, 16);
  return `evt_transcript_${hash}`;
}

function normalizeClient(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || undefined;
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function getIso(value: unknown) {
  if (typeof value !== "string") return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function getInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function getNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
