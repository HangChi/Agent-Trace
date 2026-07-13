import { startRun } from "./index.js";

type FetchCall = {
  url: string;
  method: string;
  body: unknown;
  signal: AbortSignal | null;
};

const calls: FetchCall[] = [];

globalThis.fetch = async (input, init) => {
  calls.push({
    url: String(input),
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    signal: init?.signal ?? null
  });

  if (String(input).startsWith("http://abort-wait.test")) {
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;

      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }

      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }

  if (String(input).startsWith("http://never-settles.test")) {
    return await new Promise<Response>(() => {});
  }

  if (String(input).startsWith("http://server-error.test")) {
    return new Response(JSON.stringify({ error: "unavailable" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

const boundedResults = await Promise.allSettled([
  traceBoundedDelivery("http://abort-wait.test"),
  traceBoundedDelivery("http://never-settles.test")
]);
const boundedFailures = boundedResults.filter(
  (result): result is PromiseRejectedResult => result.status === "rejected"
);

if (boundedFailures.length > 0) {
  throw new Error(
    `Expected wrapped execution to start after bounded delivery: ${boundedFailures
      .map((result) => String(result.reason))
      .join("; ")}`
  );
}

const serverErrorResult = { result: "server-error-swallowed" };
const serverErrorRun = startRun({
  name: "server-error",
  endpoint: "http://server-error.test",
  deliveryTimeoutMs: 20
});
const returnedServerErrorResult = await serverErrorRun.traceTool(
  "server-error-tool",
  {},
  async () => serverErrorResult
);

if (returnedServerErrorResult !== serverErrorResult) {
  throw new Error("Expected a 500 delivery response not to change the wrapped result.");
}

await serverErrorRun.end(serverErrorResult);

const run = startRun({
  name: "sdk-smoke",
  input: { task: "exercise sdk" },
  endpoint: "http://collector.test/"
});

const wrappedResult = { result: "ok" };
const result = await run.traceTool(
  "web_search",
  { query: "MCP ecosystem" },
  async () => wrappedResult
);

if (result !== wrappedResult) {
  throw new Error("Expected traceTool to return the wrapped result.");
}

const wrappedError = new Error("timeout");
let returnedError: unknown;

try {
  await run.traceLLM(
    "planner",
    { prompt: "Plan" },
    async () => {
      throw wrappedError;
    },
    {
      provider: "fake",
      model: "fake-model",
      tokenUsage: { input: 10, output: 2, total: 12 }
    }
  );
} catch (error) {
  returnedError = error;
}

if (returnedError !== wrappedError) {
  throw new Error("Expected traceLLM to rethrow the wrapped failure unchanged.");
}

await run.fail(new Error("agent failed"));

assertCall("POST", "http://collector.test/runs");
assertCall("POST", "http://collector.test/events");
assertCall("PATCH", `http://collector.test/runs/${run.id}`);

const failedEvent = calls.find(
  (call) =>
    call.method === "POST" &&
    call.url.endsWith("/events") &&
    typeof call.body === "object" &&
    call.body !== null &&
    "status" in call.body &&
    call.body.status === "error"
);

if (!failedEvent) {
  throw new Error("Expected SDK to emit an error event for failed traceLLM.");
}

if (calls.some((call) => call.signal === null)) {
  throw new Error("Expected every POST and PATCH delivery to include an AbortSignal.");
}

console.log("Agent-Trace SDK smoke test passed.");

async function traceBoundedDelivery(endpoint: string) {
  const run = startRun({
    name: "bounded-delivery",
    endpoint,
    deliveryTimeoutMs: 20
  });
  const wrappedResult = { result: endpoint };

  const result = await within(
    run.traceTool("bounded-tool", {}, async () => wrappedResult),
    500
  );

  if (result !== wrappedResult) {
    throw new Error(`Expected ${endpoint} to preserve the wrapped result.`);
  }
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`wrapped function did not finish within ${timeoutMs} ms`)),
          timeoutMs
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function assertCall(method: string, url: string) {
  const matched = calls.some((call) => call.method === method && call.url === url);

  if (!matched) {
    throw new Error(`Expected ${method} ${url} to be called.`);
  }
}
