import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), `agent-trace-budget-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = databasePath;

const storage = await import("./storage.js");
const { createApp } = await import("./app.js");
const { db } = await import("./db.js");
storage.initializeDatabase(databasePath);
const app = createApp();
const startedAt = new Date().toISOString();

try {
  await storage.createRun({
    id: "budget-run",
    name: "production agent",
    status: "success",
    startedAt,
    metadata: { project: "alpha", environment: "production", model: "gpt-5" }
  });
  await storage.updateRun("budget-run", {
    status: "success",
    endedAt: new Date(new Date(startedAt).getTime() + 1000).toISOString()
  });
  await storage.createEvent({
    id: "budget-event",
    runId: "budget-run",
    type: "llm_call",
    name: "model",
    status: "success",
    timestamp: startedAt,
    durationMs: 800,
    metadata: {
      model: "gpt-5",
      tokenUsage: { input: 60, output: 40, total: 100 },
      costUsd: 0.1
    }
  });

  const breakdownResponse = await app.request("/analytics/breakdown?dimension=project&days=30");
  assert.equal(breakdownResponse.status, 200);
  const breakdown = await breakdownResponse.json() as {
    dimension: string;
    groups: Array<{ key: string; runCount: number; totalTokens: number; costUsd: number }>;
  };
  assert.equal(breakdown.dimension, "project");
  assert.deepEqual(breakdown.groups, [{
    key: "alpha",
    runCount: 1,
    successfulRunCount: 1,
    failedRunCount: 0,
    failureRate: 0,
    averageDurationMs: 1000,
    totalTokens: 100,
    costUsd: 0.1
  }]);

  const budgetResponse = await app.request("/analytics/budgets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Alpha daily guardrail",
      dimension: "project",
      value: "alpha",
      period: "daily",
      maxCostUsd: 0.05,
      maxTokens: 50,
      enabled: true
    })
  });
  assert.equal(budgetResponse.status, 201);
  const budget = await budgetResponse.json() as { id: string };

  const alertsResponse = await app.request("/analytics/alerts");
  assert.equal(alertsResponse.status, 200);
  const alerts = await alertsResponse.json() as {
    alerts: Array<{ budgetId: string; metric: string; limit: number; actual: number }>;
  };
  assert.deepEqual(alerts.alerts.map(({ budgetId, metric, limit, actual }) => ({
    budgetId,
    metric,
    limit,
    actual
  })), [
    { budgetId: budget.id, metric: "costUsd", limit: 0.05, actual: 0.1 },
    { budgetId: budget.id, metric: "tokens", limit: 50, actual: 100 }
  ]);
} finally {
  db.$client.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
}

console.log("analytics budget smoke passed");
