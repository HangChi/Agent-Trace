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
  const privacyResponse = await createApp().request("/maintenance/privacy", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sensitiveKeys: ["apiKey"], replacement: "[HIDDEN]" })
  });
  assert.equal(privacyResponse.status, 200);
  assert.deepEqual(await privacyResponse.json(), {
    sensitiveKeys: ["apiKey"],
    replacement: "[HIDDEN]"
  });
  assert.equal(
    await storage.createRun(
      { ...run("private-run"), input: { apiKey: "secret", nested: { safe: "value" } } },
      database
    ),
    true
  );
  const privateRun = await storage.getRunById("private-run", database);
  assert.deepEqual(privateRun?.input, { apiKey: "[HIDDEN]", nested: { safe: "value" } });
  await storage.createEvent(
    {
      ...event("private-run", "private-event"),
      input: { apiKey: "event-secret" },
      metadata: { category: "tool", source: "sdk" }
    },
    database
  );
  const [privateEvent] = await storage.listEventsByRunId("private-run", database);
  assert.deepEqual(privateEvent?.input, { apiKey: "[HIDDEN]" });

  assert.equal(await storage.createRun(run("deleted-run"), database), true);
  await storage.createEvent(event("deleted-run", "deleted-event"), database);
  assert.equal(await storage.deleteRun("deleted-run", database), true);
  assert.equal(await storage.createRun(run("deleted-run"), database), false);
  assert.equal(await storage.getRunById("deleted-run", database), undefined);
  const tombstonesResponse = await createApp().request("/maintenance/tombstones");
  assert.equal(tombstonesResponse.status, 200);
  assert.ok(
    (await tombstonesResponse.json()).tombstones.some(
      (entry: { runId?: string }) => entry.runId === "deleted-run"
    )
  );
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
  assert.equal(stats.runs, 3);
  assert.equal(stats.events, 1);
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
