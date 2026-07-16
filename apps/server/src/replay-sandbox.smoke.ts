import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), `agent-trace-replay-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = databasePath;

const storage = await import("./storage.js");
const { createApp } = await import("./app.js");
const { db } = await import("./db.js");
storage.initializeDatabase(databasePath);
const app = createApp();

try {
  await storage.createRun({
    id: "source-run",
    name: "source agent",
    status: "success",
    startedAt: "2026-07-16T08:00:00.000Z",
    metadata: { project: "sandbox-demo" }
  });
  await storage.createEvent({
    id: "source-event",
    runId: "source-run",
    type: "tool_call",
    name: "lookup-order",
    status: "success",
    timestamp: "2026-07-16T08:00:01.000Z",
    durationMs: 120,
    input: { orderId: "A-100" },
    output: { state: "pending" },
    metadata: { category: "tool", toolName: "lookup-order" }
  });

  const createResponse = await app.request("/sandbox/replays", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceRunId: "source-run",
      sourceEventId: "source-event",
      input: { orderId: "A-200" },
      mockOutput: { state: "refunded" },
      timeoutMs: 2000
    })
  });
  assert.equal(createResponse.status, 202);
  const created = await createResponse.json() as { task: { id: string; status: string } };
  assert.equal(created.task.status, "queued");

  const task = await waitForTask(created.task.id, "completed");
  assert.equal(task.replayRunId, `replay:${created.task.id}`);
  assert.equal(task.workspaceCleaned, true);
  assert.deepEqual(task.policy, {
    network: "disabled",
    toolExecution: "mock-only",
    filesystem: "temporary",
    environment: "sanitized"
  });

  const runResponse = await app.request(`/runs/${encodeURIComponent(task.replayRunId!)}`);
  assert.equal(runResponse.status, 200);
  const replayRun = await runResponse.json() as {
    metadata: { replay?: { sourceRunId: string; sourceEventId: string; taskId: string } };
  };
  assert.deepEqual(replayRun.metadata.replay, {
    sourceRunId: "source-run",
    sourceEventId: "source-event",
    taskId: created.task.id
  });

  const eventsResponse = await app.request(
    `/runs/${encodeURIComponent(task.replayRunId!)}/events?legacy=1`
  );
  assert.equal(eventsResponse.status, 200);
  const events = await eventsResponse.json() as Array<{
    type: string;
    name: string;
    input: unknown;
    output: unknown;
    metadata?: { replayMode?: string; realSideEffects?: boolean };
  }>;
  assert.deepEqual(events.map((event) => ({
    type: event.type,
    name: event.name,
    input: event.input,
    output: event.output,
    replayMode: event.metadata?.replayMode,
    realSideEffects: event.metadata?.realSideEffects
  })), [{
    type: "tool_call",
    name: "lookup-order",
    input: { orderId: "A-200" },
    output: { state: "refunded" },
    replayMode: "mock",
    realSideEffects: false
  }]);

  const lateCancelResponse = await app.request(`/sandbox/replays/${created.task.id}`, {
    method: "DELETE"
  });
  assert.equal(lateCancelResponse.status, 200);
  const lateCancelBody = await lateCancelResponse.json() as { task: { status: string } };
  assert.equal(lateCancelBody.task.status, "completed");

  const timeoutResponse = await app.request("/sandbox/replays", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceRunId: "source-run",
      sourceEventId: "source-event",
      delayMs: 300,
      timeoutMs: 100
    })
  });
  assert.equal(timeoutResponse.status, 202);
  const timeoutCreated = await timeoutResponse.json() as { task: { id: string } };
  const timedOut = await waitForTask(timeoutCreated.task.id, "timeout", true);
  assert.equal(timedOut.workspaceCleaned, true);
  assert.equal(timedOut.replayRunId, undefined);

  const cancellableResponse = await app.request("/sandbox/replays", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceRunId: "source-run",
      sourceEventId: "source-event",
      delayMs: 1000,
      timeoutMs: 2000
    })
  });
  assert.equal(cancellableResponse.status, 202);
  const cancellableCreated = await cancellableResponse.json() as { task: { id: string } };
  await waitForTask(cancellableCreated.task.id, "running");
  const cancelResponse = await app.request(`/sandbox/replays/${cancellableCreated.task.id}`, {
    method: "DELETE"
  });
  assert.equal(cancelResponse.status, 200);
  const cancelled = await waitForTask(cancellableCreated.task.id, "cancelled", true);
  assert.equal(cancelled.workspaceCleaned, true);
  assert.equal(cancelled.replayRunId, undefined);
  const repeatedCancelResponse = await app.request(`/sandbox/replays/${cancellableCreated.task.id}`, {
    method: "DELETE"
  });
  assert.equal(repeatedCancelResponse.status, 200);
  const repeatedCancelBody = await repeatedCancelResponse.json() as { task: { status: string } };
  assert.equal(repeatedCancelBody.task.status, "cancelled");
} finally {
  db.$client.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
}

async function waitForTask(id: string, expectedStatus: string, requireClean = false) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const response = await app.request(`/sandbox/replays/${id}`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      task: {
        id: string;
        status: string;
        replayRunId?: string;
        workspaceCleaned: boolean;
        policy: Record<string, string>;
      };
    };
    if (body.task.status === expectedStatus && (!requireClean || body.task.workspaceCleaned)) {
      return body.task;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Replay task ${id} did not reach ${expectedStatus}.`);
}

console.log("replay sandbox smoke passed");
