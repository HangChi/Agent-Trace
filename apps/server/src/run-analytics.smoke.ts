import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), `agent-trace-run-analytics-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = databasePath;

const storage = await import("./storage.js");
const { createApp } = await import("./app.js");
const { db } = await import("./db.js");
storage.initializeDatabase(databasePath);

try {
  await storage.createRun({
    id: "compare-a",
    name: "baseline",
    status: "running",
    startedAt: "2026-07-14T10:00:00.000Z",
    metadata: { agent: "codex" }
  });
  await storage.updateRun("compare-a", {
    status: "success",
    endedAt: "2026-07-14T10:00:02.000Z"
  });
  await storage.createRun({
    id: "compare-b",
    name: "candidate",
    status: "running",
    startedAt: "2026-07-15T10:00:00.000Z",
    metadata: { agent: "claude-code" }
  });
  await storage.updateRun("compare-b", {
    status: "error",
    endedAt: "2026-07-15T10:00:05.000Z"
  });

  await storage.createEvent({
    id: "compare-a-event",
    runId: "compare-a",
    type: "llm_call",
    name: "model",
    status: "success",
    timestamp: "2026-07-14T10:00:01.000Z",
    durationMs: 1000,
    metadata: {
      tokenUsage: { input: 60, output: 40, total: 100 },
      costUsd: 0.1
    }
  });
  await storage.createEvent({
    id: "compare-b-event-1",
    runId: "compare-b",
    type: "llm_call",
    name: "model",
    status: "success",
    timestamp: "2026-07-15T10:00:01.000Z",
    durationMs: 2000,
    metadata: {
      tokenUsage: { input: 120, output: 80, total: 200 },
      costUsd: 0.2
    }
  });
  await storage.createEvent({
    id: "compare-b-event-2",
    runId: "compare-b",
    type: "tool_call",
    name: "failed tool",
    status: "error",
    timestamp: "2026-07-15T10:00:04.000Z",
    durationMs: 1000,
    metadata: { category: "tool" }
  });

  const response = await createApp().request(
    "/analytics/runs/compare?ids=compare-a,compare-b"
  );
  assert.equal(response.status, 200);
  const body = await response.json() as {
    runs?: Array<{
      id: string;
      durationMs: number;
      eventCount: number;
      failedEventCount: number;
      totalTokens: number;
      costUsd: number;
    }>;
    eventDiffs?: Array<{
      runId: string;
      eventKey: string;
      type: string;
      name: string;
      occurrence: number;
      baseline?: { id: string; status: string; durationMs: number; totalTokens: number };
      candidate?: { id: string; status: string; durationMs: number; totalTokens: number };
      changes: string[];
      regressions: string[];
    }>;
    regressionCount?: number;
  };

  assert.deepEqual(body.runs, [
    {
      id: "compare-a",
      name: "baseline",
      status: "success",
      startedAt: "2026-07-14T10:00:00.000Z",
      durationMs: 2000,
      eventCount: 1,
      failedEventCount: 0,
      totalTokens: 100,
      costUsd: 0.1
    },
    {
      id: "compare-b",
      name: "candidate",
      status: "error",
      startedAt: "2026-07-15T10:00:00.000Z",
      durationMs: 5000,
      eventCount: 2,
      failedEventCount: 1,
      totalTokens: 200,
      costUsd: 0.2
    }
  ]);
  assert.deepEqual(body.eventDiffs, [
    {
      runId: "compare-b",
      eventKey: "llm_call:model:1",
      type: "llm_call",
      name: "model",
      occurrence: 1,
      baseline: {
        id: "compare-a-event",
        status: "success",
        durationMs: 1000,
        totalTokens: 100
      },
      candidate: {
        id: "compare-b-event-1",
        status: "success",
        durationMs: 2000,
        totalTokens: 200
      },
      changes: ["duration", "tokens"],
      regressions: ["duration", "tokens"]
    },
    {
      runId: "compare-b",
      eventKey: "tool_call:failed tool:1",
      type: "tool_call",
      name: "failed tool",
      occurrence: 1,
      candidate: {
        id: "compare-b-event-2",
        status: "error",
        durationMs: 1000,
        totalTokens: 0
      },
      changes: ["added"],
      regressions: ["status"]
    }
  ]);
  assert.equal(body.regressionCount, 3);

  const trendResponse = await createApp().request("/analytics/runs/trends?days=2");
  assert.equal(trendResponse.status, 200);
  const trends = await trendResponse.json() as {
    days?: number;
    points?: Array<{
      date: string;
      runCount: number;
      successfulRunCount: number;
      failedRunCount: number;
      averageDurationMs: number;
      totalTokens: number;
      costUsd: number;
    }>;
  };

  assert.equal(trends.days, 2);
  assert.deepEqual(trends.points, [
    {
      date: "2026-07-14",
      runCount: 1,
      successfulRunCount: 1,
      failedRunCount: 0,
      averageDurationMs: 2000,
      totalTokens: 100,
      costUsd: 0.1
    },
    {
      date: "2026-07-15",
      runCount: 1,
      successfulRunCount: 0,
      failedRunCount: 1,
      averageDurationMs: 5000,
      totalTokens: 200,
      costUsd: 0.2
    }
  ]);
} finally {
  db.$client.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
}

console.log("run analytics smoke passed");
