import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const path = join(tmpdir(), `agent-trace-governance-${process.pid}-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = path;

const storage = await import("./storage.js");
const { db: defaultDatabase } = await import("./db.js");
const { createApp } = await import("./app.js");
storage.initializeDatabase(path);
const sqlite = new Database(path);
sqlite.pragma("foreign_keys = ON");
const database = drizzle(sqlite);

try {
  assert.equal(await storage.createRun(run("deleted-run"), database), true);
  await storage.createEvent(event("deleted-run", "deleted-event"), database);
  assert.equal(await storage.deleteRun("deleted-run", database), true);
  assert.equal(await storage.createRun(run("deleted-run"), database), false);
  assert.equal(await storage.getRunById("deleted-run", database), undefined);
  const recreateResponse = await createApp().request("/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(run("deleted-run"))
  });
  assert.equal(recreateResponse.status, 409);
  assert.deepEqual(await recreateResponse.json(), { error: "run_tombstoned" });

  storage.replaceTranscriptSnapshot(
    [{ run: run("deleted-run"), events: [event("deleted-run", "scanner-event")], client: "codex" }],
    ["codex"],
    ["codex:deleted-run"],
    database
  );
  assert.equal(await storage.getRunById("deleted-run", database), undefined);

  assert.equal(await storage.restoreDeletedRun("deleted-run", database), true);
  assert.equal(await storage.createRun(run("deleted-run"), database), true);

  await storage.createRun(run("old-success", "2020-01-01T00:00:00.000Z"), database);
  await storage.createRun({ ...run("old-running", "2020-01-01T00:00:00.000Z"), status: "running" }, database);
  assert.equal(
    await storage.pruneRuns(
      { before: "2021-01-01T00:00:00.000Z", statuses: ["success"], keepTombstones: true },
      database
    ),
    1
  );
  assert.ok(await storage.getRunById("old-running", database));
  assert.equal(await storage.createRun(run("old-success"), database), false);

  const stats = await storage.getStorageStats(database);
  assert.equal(stats.runs, 2);
  assert.equal(stats.events, 0);
  assert.equal(stats.tombstones, 1);
} finally {
  sqlite.close();
  defaultDatabase.$client.close();
  rmSync(path, { force: true });
  rmSync(`${path}-shm`, { force: true });
  rmSync(`${path}-wal`, { force: true });
}

console.log("Agent-Trace data governance smoke test passed.");

function run(id: string, startedAt = "2026-07-15T00:00:00.000Z") {
  return {
    id,
    name: id,
    status: "success" as const,
    startedAt,
    input: { source: "transcript-scan" },
    metadata: { agent: "codex", sessionId: id }
  };
}

function event(runId: string, id: string) {
  return {
    id,
    runId,
    type: "tool_call" as const,
    name: id,
    status: "success" as const,
    timestamp: "2026-07-15T00:00:01.000Z",
    metadata: { category: "tool", source: "transcript", transcriptClient: "codex", sessionId: runId }
  };
}
