import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), `agent-trace-evaluations-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = databasePath;

const storage = await import("./storage.js");
const { createApp } = await import("./app.js");
const { db } = await import("./db.js");
storage.initializeDatabase(databasePath);
const app = createApp();

try {
  await storage.createRun({
    id: "evaluated-run",
    name: "candidate agent",
    status: "success",
    startedAt: "2026-07-15T10:00:00.000Z"
  });

  const datasetResponse = await app.request("/evaluations/datasets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Support quality",
      description: "Regression set",
      scoreWeights: { correctness: 0.7, efficiency: 0.3 }
    })
  });
  assert.equal(datasetResponse.status, 201);
  const dataset = await datasetResponse.json() as { id: string };

  const caseResponse = await app.request(`/evaluations/datasets/${dataset.id}/cases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "refund request",
      input: { prompt: "I need a refund" },
      expectedOutput: { intent: "refund" }
    })
  });
  assert.equal(caseResponse.status, 201);
  const evaluationCase = await caseResponse.json() as { id: string };

  const resultResponse = await app.request("/evaluations/results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      caseId: evaluationCase.id,
      runId: "evaluated-run",
      scores: { correctness: 0.8, efficiency: 0.5 },
      notes: "Human review"
    })
  });
  assert.equal(resultResponse.status, 201);
  const result = await resultResponse.json() as { qualityScore: number };
  assert.equal(result.qualityScore, 0.71);

  const reportResponse = await app.request(`/evaluations/datasets/${dataset.id}`);
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.json() as {
    dataset: {
      id: string;
      name: string;
      description?: string;
      scoreWeights: Record<string, number>;
      createdAt: string;
      caseCount: number;
      resultCount: number;
      averageQualityScore: number;
    };
    cases: Array<{ id: string; results: Array<{ runId: string; qualityScore: number }> }>;
  };
  assert.deepEqual(report.dataset, {
    id: dataset.id,
    name: "Support quality",
    description: "Regression set",
    scoreWeights: { correctness: 0.7, efficiency: 0.3 },
    createdAt: report.dataset.createdAt,
    caseCount: 1,
    resultCount: 1,
    averageQualityScore: 0.71
  });
  assert.equal(report.cases.length, 1);
  assert.equal(report.cases[0]?.results[0]?.runId, "evaluated-run");
  assert.equal(report.cases[0]?.results[0]?.qualityScore, 0.71);
} finally {
  db.$client.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
}

console.log("evaluations smoke passed");
