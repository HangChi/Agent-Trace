import assert from "node:assert/strict";
import { rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const runCount = readPositiveInteger("AGENT_TRACE_BENCHMARK_RUNS", 100_000);
const eventCount = readPositiveInteger("AGENT_TRACE_BENCHMARK_EVENTS", 1_000_000);
const runBudgetMs = readPositiveInteger("AGENT_TRACE_BENCHMARK_RUN_MS", 1_500);
const eventBudgetMs = readPositiveInteger("AGENT_TRACE_BENCHMARK_EVENT_MS", 500);
const heapBudgetBytes = readPositiveInteger("AGENT_TRACE_BENCHMARK_HEAP_MB", 512) * 1024 * 1024;
const databaseBudgetBytes = readPositiveInteger("AGENT_TRACE_BENCHMARK_DB_MB", 2_048) * 1024 * 1024;
const path = join(tmpdir(), `agent-trace-capacity-${process.pid}-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = path;

const storage = await import("./storage.js");
const { db: defaultDatabase } = await import("./db.js");
storage.initializeDatabase(path);
const sqlite = new Database(path);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = OFF");

try {
  seed(sqlite, runCount, eventCount);
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  const database = drizzle(sqlite);
  const heapBefore = process.memoryUsage().heapUsed;
  const runStarted = performance.now();
  const runPage = await storage.listRunsPage(
    { page: Math.ceil(runCount / 100), pageSize: 100, status: "success", sort: "startedAt" },
    database
  );
  const runElapsedMs = performance.now() - runStarted;
  const targetRunId = runPage.runs[0]?.id ?? "run-0";
  const eventStarted = performance.now();
  const eventPage = await storage.listEventsPageByRunId(
    targetRunId,
    { visibility: "all", page: 1, pageSize: 100, status: "success" },
    database
  );
  const eventElapsedMs = performance.now() - eventStarted;
  const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  const databaseBytes = statSync(path).size;

  assert.equal(runPage.runs.length > 0, true);
  assert.equal(eventPage.events.length > 0, true);
  assert.ok(runElapsedMs <= runBudgetMs, `run page ${runElapsedMs.toFixed(1)} ms > ${runBudgetMs} ms`);
  assert.ok(eventElapsedMs <= eventBudgetMs, `event page ${eventElapsedMs.toFixed(1)} ms > ${eventBudgetMs} ms`);
  assert.ok(heapDeltaBytes <= heapBudgetBytes, `heap delta ${heapDeltaBytes} > ${heapBudgetBytes}`);
  assert.ok(databaseBytes <= databaseBudgetBytes, `database ${databaseBytes} > ${databaseBudgetBytes}`);

  console.log(JSON.stringify({
    runs: runCount,
    events: eventCount,
    runElapsedMs: Number(runElapsedMs.toFixed(1)),
    eventElapsedMs: Number(eventElapsedMs.toFixed(1)),
    heapDeltaBytes,
    databaseBytes
  }, null, 2));
} finally {
  sqlite.close();
  defaultDatabase.$client.close();
  rmSync(path, { force: true });
  rmSync(`${path}-shm`, { force: true });
  rmSync(`${path}-wal`, { force: true });
}

function seed(sqlite: Database.Database, runs: number, eventTotal: number) {
  const insertRun = sqlite.prepare(`
    INSERT INTO runs (id, name, status, started_at, metadata_json)
    VALUES (?, ?, 'success', ?, ?)
  `);
  const insertEvent = sqlite.prepare(`
    INSERT INTO events (id, run_id, type, name, status, timestamp, duration_ms, metadata_json)
    VALUES (?, ?, 'tool_call', 'benchmark tool', 'success', ?, 5, ?)
  `);
  const insertRuns = sqlite.transaction(() => {
    for (let index = 0; index < runs; index += 1) {
      const id = `run-${index}`;
      insertRun.run(
        id,
        `benchmark ${index}`,
        new Date(1_700_000_000_000 + index * 1000).toISOString(),
        JSON.stringify({ agent: index % 2 === 0 ? "codex" : "claude-code", sessionId: `session-${index}`, model: "benchmark-model" })
      );
    }
  });
  const insertEvents = sqlite.transaction(() => {
    for (let index = 0; index < eventTotal; index += 1) {
      const runIndex = index % runs;
      insertEvent.run(
        `event-${index}`,
        `run-${runIndex}`,
        new Date(1_700_000_000_000 + index).toISOString(),
        JSON.stringify({ category: "tool", toolName: "benchmark", tokenUsage: { input: 1, output: 1, total: 2 } })
      );
    }
  });

  insertRuns();
  insertEvents();
}

function readPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
