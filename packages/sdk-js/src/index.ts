import { AsyncLocalStorage } from "node:async_hooks";

import type { TraceEventType, TraceMetadata } from "@agent-trace/schema";

export type StartRunOptions = {
  name: string;
  input?: unknown;
  metadata?: TraceMetadata;
  endpoint?: string;
  deliveryTimeoutMs?: number;
};

export type TraceStepOptions = {
  parentId?: string;
  metadata?: TraceMetadata;
};

export type TraceRun = {
  id: string;
  traceStep<T>(
    type: TraceEventType,
    name: string,
    input: unknown,
    fn: () => Promise<T>,
    options?: TraceStepOptions
  ): Promise<T>;
  traceLLM<T>(
    name: string,
    input: unknown,
    fn: () => Promise<T>,
    metadata?: TraceMetadata
  ): Promise<T>;
  traceTool<T>(
    name: string,
    input: unknown,
    fn: () => Promise<T>,
    options?: TraceStepOptions
  ): Promise<T>;
  end(output?: unknown): Promise<void>;
  fail(error: unknown): Promise<void>;
};

const defaultEndpoint = "http://localhost:4319";
const defaultDeliveryTimeoutMs = 1000;

export function startRun(options: StartRunOptions): TraceRun {
  const endpoint = trimTrailingSlash(options.endpoint ?? defaultEndpoint);
  const deliveryTimeoutMs = normalizeDeliveryTimeout(options.deliveryTimeoutMs);
  const runId = createId("run");
  const activeEvent = new AsyncLocalStorage<string>();
  const startPromise = post(endpoint, "/runs", {
    id: runId,
    name: options.name,
    status: "running",
    startedAt: new Date().toISOString(),
    input: options.input,
    metadata: options.metadata
  }, deliveryTimeoutMs);

  async function traceStep<T>(
    type: TraceEventType,
    name: string,
    input: unknown,
    fn: () => Promise<T>,
    options?: TraceStepOptions
  ): Promise<T> {
    const eventId = createId("evt");
    const parentId = options?.parentId ?? activeEvent.getStore();
    const started = Date.now();

    await startPromise;

    try {
      const output = await activeEvent.run(eventId, fn);

      await post(endpoint, "/events", {
        id: eventId,
        runId,
        parentId,
        type,
        name,
        status: "success",
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        input,
        output,
        metadata: options?.metadata
      }, deliveryTimeoutMs);

      return output;
    } catch (err) {
      await post(endpoint, "/events", {
        id: eventId,
        runId,
        parentId,
        type,
        name,
        status: "error",
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        input,
        error: serializeError(err),
        metadata: options?.metadata
      }, deliveryTimeoutMs);

      throw err;
    }
  }

  return {
    id: runId,
    traceStep,
    traceLLM<T>(
      name: string,
      input: unknown,
      fn: () => Promise<T>,
      metadata?: TraceMetadata
    ) {
      return traceStep("llm_call", name, input, fn, { metadata });
    },
    traceTool<T>(
      name: string,
      input: unknown,
      fn: () => Promise<T>,
      options?: TraceStepOptions
    ) {
      return traceStep("tool_call", name, input, fn, options);
    },
    async end(output?: unknown) {
      await startPromise;
      await patch(endpoint, `/runs/${runId}`, {
        status: "success",
        endedAt: new Date().toISOString(),
        output
      }, deliveryTimeoutMs);
    },
    async fail(error: unknown) {
      await startPromise;
      await patch(endpoint, `/runs/${runId}`, {
        status: "error",
        endedAt: new Date().toISOString(),
        error: serializeError(error).message
      }, deliveryTimeoutMs);
    }
  };
}

export const tracer = {
  startRun
};

async function post(endpoint: string, path: string, body: unknown, deliveryTimeoutMs: number) {
  await send(endpoint, path, "POST", body, deliveryTimeoutMs);
}

async function patch(endpoint: string, path: string, body: unknown, deliveryTimeoutMs: number) {
  await send(endpoint, path, "PATCH", body, deliveryTimeoutMs);
}

async function send(
  endpoint: string,
  path: string,
  method: "PATCH" | "POST",
  body: unknown,
  deliveryTimeoutMs: number
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Trace delivery timed out."));
    }, deliveryTimeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(`${endpoint}${path}`, {
        method,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }),
      timeout
    ]);

    if (!response.ok) {
      throw new Error(`Trace delivery failed with status ${response.status}.`);
    }
  } catch {
    // Tracing must not change the behavior of the user's agent.
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDeliveryTimeout(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : defaultDeliveryTimeoutMs;
}

function createId(prefix: string) {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

  return `${prefix}_${randomId}`;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
