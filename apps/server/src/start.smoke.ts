import assert from "node:assert/strict";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), `agent-trace-start-smoke-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = databasePath;

const { createApp } = await import("./app.js");
const { db } = await import("./db.js");
const { getCollectorHostname, startCollector } = await import("./start.js");
const { createRun, initializeDatabase, reconcileStaleRuns } = await import("./storage.js");

const originalAgentTraceHost = process.env.AGENT_TRACE_SERVER_HOST;
const originalTooltraceHost = process.env.TOOLTRACE_SERVER_HOST;
let reconciliationCallback: (() => void) | undefined;
const reconciliationTimer = { unref() {} } as NodeJS.Timeout;
let reconciliationTimerCleared = false;

try {
  delete process.env.AGENT_TRACE_SERVER_HOST;
  delete process.env.TOOLTRACE_SERVER_HOST;
  assert.equal(getCollectorHostname(), "127.0.0.1");

  process.env.TOOLTRACE_SERVER_HOST = "localhost";
  assert.equal(getCollectorHostname(), "localhost");

  process.env.AGENT_TRACE_SERVER_HOST = "127.0.0.1";
  assert.equal(getCollectorHostname(), "127.0.0.1");

  const app = createApp();

  for (const origin of ["http://127.0.0.1:5173", "http://localhost:4173"]) {
    const response = await app.request("/health", { headers: { Origin: origin } });
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }

  const originlessResponse = await app.request("/health");
  assert.equal(originlessResponse.status, 200);

  const externalResponse = await app.request("/health", {
    headers: { Origin: "https://dashboard.example.com" }
  });
  assert.equal(externalResponse.headers.get("access-control-allow-origin"), null);

  const logMessages: string[] = [];
  const errorMessages: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values: unknown[]) => logMessages.push(values.map(String).join(" "));
  console.error = (...values: unknown[]) => errorMessages.push(values.map(String).join(" "));

  initializeDatabase(databasePath);
  await createRun({
    id: "startup-stale-run",
    name: "startup stale run",
    status: "running",
    startedAt: new Date(Date.now() - 31 * 60_000).toISOString()
  });
  let reconciliationCalls = 0;
  const server = await (startCollector as unknown as (
    port: number,
    dependencies: {
      reconcileStaleRuns: () => Promise<number>;
      setInterval: (callback: () => void, timeout: number) => NodeJS.Timeout;
      clearInterval: (timer: NodeJS.Timeout) => void;
    }
  ) => ReturnType<typeof startCollector>)(0, {
    reconcileStaleRuns: async () => {
      reconciliationCalls += 1;
      if (reconciliationCalls === 1) return reconcileStaleRuns();
      throw new Error("scheduled reconciliation failure");
    },
    setInterval: (callback, timeout) => {
      assert.equal(timeout, 60_000);
      reconciliationCallback = callback;
      return reconciliationTimer;
    },
    clearInterval: (timer) => {
      assert.equal(timer, reconciliationTimer);
      reconciliationTimerCleared = true;
    }
  });
  if (server === null) throw new Error("Expected a newly started Collector.");

  try {
    const address = server.address();

    assert.notEqual(address, null);
    assert.equal(typeof address === "string" ? address : address?.address, "127.0.0.1");
    assert.ok(
      logMessages.some((message) =>
        message.includes(
          `http://127.0.0.1:${typeof address === "string" ? 0 : address?.port}`
        )
      )
    );
    assert.ok(reconciliationCallback, "expected a 60-second stale-run reconciliation callback");
    await waitFor(() => {
      const row = db.$client
        .prepare("SELECT status FROM runs WHERE id = ?")
        .get("startup-stale-run") as { status: string } | undefined;
      return row?.status === "error";
    });
    reconciliationCallback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      errorMessages.some((message) => message.includes("scheduled reconciliation failure")),
      `expected reconciliation rejection to be logged: ${errorMessages.join(" | ")}`
    );
    assert.equal(server.listening, true);
    const healthResponse = await fetch(
      `http://127.0.0.1:${typeof address === "string" ? 0 : address?.port}/health`
    );
    assert.equal(healthResponse.status, 200);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  assert.equal(reconciliationTimerCleared, true);

  let existingService = "agent-trace";
  const existingCollector = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: existingService }));
      return;
    }

    response.writeHead(404);
    response.end();
  });
  existingCollector.listen(0, "127.0.0.1");
  await once(existingCollector, "listening");

  try {
    const address = existingCollector.address();
    assert.notEqual(address, null);
    assert.notEqual(typeof address, "string");
    const reusedCollector = await startCollector(
      typeof address === "string" ? 0 : address?.port
    );
    assert.equal(reusedCollector, null);

    existingService = "another-service";
    await assert.rejects(
      () => startCollector(typeof address === "string" ? 0 : address?.port),
      /is already used by another application/
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      existingCollector.close((error) => (error ? reject(error) : resolve()));
    });
  }
} finally {
  db.$client.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  if (originalAgentTraceHost === undefined) {
    delete process.env.AGENT_TRACE_SERVER_HOST;
  } else {
    process.env.AGENT_TRACE_SERVER_HOST = originalAgentTraceHost;
  }

  if (originalTooltraceHost === undefined) {
    delete process.env.TOOLTRACE_SERVER_HOST;
  } else {
    process.env.TOOLTRACE_SERVER_HOST = originalTooltraceHost;
  }
}

console.log("Agent-Trace collector startup smoke test passed.");

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 1_000;

  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for startup stale-run reconciliation.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
