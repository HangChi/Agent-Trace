import type { CreateTraceEvent, TraceEventType, TraceMetadata } from "@agent-trace/schema";

import {
  createRun,
  getRunById,
  updateRun,
  updateRunMetadata,
  upsertEvent
} from "./storage.js";

type OtlpSpan = Record<string, unknown>;

export async function ingestOtlpTraces(payload: unknown) {
  const traces = collectTraces(payload);
  let eventCount = 0;

  for (const [traceId, trace] of traces) {
    const runId = `otlp:${traceId}`;
    let earliest: string | undefined;
    let latest: string | undefined;
    for (const span of trace.spans) {
      earliest = minTimestamp(earliest, nanoToIso(span.startTimeUnixNano));
      latest = maxTimestamp(latest, nanoToIso(span.endTimeUnixNano));
    }
    const startedAt = earliest ?? new Date().toISOString();
    const endedAt = latest ?? startedAt;
    const status = trace.spans.some((span) => isErrorStatus(span.status)) ? "error" : "success";
    const serviceName = text(trace.resourceAttributes["service.name"]) ?? rootSpanName(trace.spans) ?? "otlp-service";
    const metadata: TraceMetadata = {
      source: "otlp",
      project: serviceName,
      environment: text(trace.resourceAttributes["deployment.environment.name"]),
      ...trace.resourceAttributes
    };
    const existing = await getRunById(runId);

    if (!existing) {
      await createRun({
        id: runId,
        name: serviceName,
        status: "running",
        startedAt,
        metadata
      });
    } else {
      await updateRunMetadata(runId, { ...existing.metadata, ...metadata });
    }
    await updateRun(runId, { status, endedAt });

    for (const span of trace.spans) {
      await upsertEvent(toTraceEvent(runId, span));
      eventCount += 1;
    }
  }

  return { runs: traces.size, events: eventCount };
}

function collectTraces(payload: unknown) {
  const traces = new Map<string, { resourceAttributes: Record<string, unknown>; spans: OtlpSpan[] }>();
  const body = record(payload);

  for (const resourceSpan of array(body.resourceSpans)) {
    const resource = record(record(resourceSpan).resource);
    const resourceAttributes = attributes(resource.attributes);
    for (const scopeSpan of array(record(resourceSpan).scopeSpans)) {
      for (const rawSpan of array(record(scopeSpan).spans)) {
        const span = record(rawSpan);
        const traceId = text(span.traceId);
        if (!traceId) continue;
        const trace = traces.get(traceId) ?? { resourceAttributes, spans: [] };
        trace.spans.push(span);
        traces.set(traceId, trace);
      }
    }
  }

  return traces;
}

function toTraceEvent(runId: string, span: OtlpSpan): CreateTraceEvent {
  const spanId = text(span.spanId) ?? crypto.randomUUID();
  const spanAttributes = attributes(span.attributes);
  const inputTokens = number(spanAttributes["gen_ai.usage.input_tokens"]);
  const outputTokens = number(spanAttributes["gen_ai.usage.output_tokens"]);
  const totalTokens = inputTokens === undefined && outputTokens === undefined
    ? undefined
    : (inputTokens ?? 0) + (outputTokens ?? 0);
  const metadata: TraceMetadata = {
    source: "otlp",
    model: text(spanAttributes["gen_ai.request.model"]),
    provider: text(spanAttributes["gen_ai.system"]),
    ...(totalTokens === undefined ? {} : {
      tokenUsage: {
        input: inputTokens ?? 0,
        output: outputTokens ?? 0,
        total: totalTokens,
        source: "otlp",
        sourceKind: "official"
      }
    }),
    ...spanAttributes
  };
  const status = isErrorStatus(span.status) ? "error" : "success";
  const statusMessage = text(record(span.status).message);

  return {
    id: `otlp:${spanId}`,
    runId,
    parentId: text(span.parentSpanId) ? `otlp:${text(span.parentSpanId)}` : undefined,
    type: eventType(spanAttributes),
    name: text(span.name) ?? "span",
    status,
    timestamp: nanoToIso(span.startTimeUnixNano) ?? new Date().toISOString(),
    durationMs: durationMs(span.startTimeUnixNano, span.endTimeUnixNano),
    error: status === "error" ? { message: statusMessage ?? "OTLP span failed" } : undefined,
    metadata
  };
}

function eventType(spanAttributes: Record<string, unknown>): TraceEventType {
  const explicit = text(spanAttributes["agent.trace.event.type"]);
  const supported: TraceEventType[] = [
    "run_started", "run_ended", "step_started", "step_ended", "llm_call",
    "tool_call", "retrieval", "memory_update", "error"
  ];
  if (explicit && supported.includes(explicit as TraceEventType)) return explicit as TraceEventType;
  if (spanAttributes["gen_ai.operation.name"] !== undefined) return "llm_call";
  if (spanAttributes["tool.name"] !== undefined || spanAttributes["gen_ai.tool.name"] !== undefined) {
    return "tool_call";
  }
  return "step_ended";
}

function attributes(value: unknown) {
  return Object.fromEntries(array(value).flatMap((entry) => {
    const attribute = record(entry);
    const key = text(attribute.key);
    return key ? [[key, anyValue(attribute.value)]] : [];
  }));
}

function anyValue(value: unknown): unknown {
  const source = record(value);
  if ("stringValue" in source) return text(source.stringValue);
  if ("intValue" in source) return number(source.intValue);
  if ("doubleValue" in source) return number(source.doubleValue);
  if ("boolValue" in source) return Boolean(source.boolValue);
  if ("bytesValue" in source) return text(source.bytesValue);
  if ("arrayValue" in source) return array(record(source.arrayValue).values).map(anyValue);
  if ("kvlistValue" in source) return attributes(record(source.kvlistValue).values);
  return undefined;
}

function isErrorStatus(value: unknown) {
  const code = record(value).code;
  return code === 2 || code === "2" || code === "STATUS_CODE_ERROR";
}

function durationMs(start: unknown, end: unknown) {
  try {
    const difference = BigInt(String(end)) - BigInt(String(start));
    return Math.max(0, Number(difference / 1_000_000n));
  } catch {
    return undefined;
  }
}

function nanoToIso(value: unknown) {
  try {
    return new Date(Number(BigInt(String(value)) / 1_000_000n)).toISOString();
  } catch {
    return undefined;
  }
}

function rootSpanName(spans: OtlpSpan[]) {
  return text(spans.find((span) => !text(span.parentSpanId))?.name);
}

function minTimestamp(left: string | undefined, right: string | undefined) {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function maxTimestamp(left: string | undefined, right: string | undefined) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
