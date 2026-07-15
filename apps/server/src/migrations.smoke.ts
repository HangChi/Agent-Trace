import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import { currentSchemaVersion, migrateDatabase } from "./migrations.js";
import { initializeDatabase } from "./storage.js";

testFreshDatabase();
testOldUnversionedDatabase();
testCurrentDatabaseIsANoOp();
testFailedMigrationRollsBack();
testFailedSecondMigrationRollsBack();
testFutureDatabaseIsRejectedWithoutChanges();

console.log("Agent-Trace database migrations smoke test passed.");

function testFreshDatabase() {
  const sqlite = new Database(":memory:");

  try {
    migrateDatabase(sqlite);

    assert.equal(getUserVersion(sqlite), currentSchemaVersion);
    assert.deepEqual(
      getNames(sqlite, "table"),
      ["analytics_budgets", "evaluation_cases", "evaluation_datasets", "evaluation_results", "events", "run_tombstones", "runs", "settings", "usage_scan_state", "usage_sessions"]
    );
    assert.deepEqual(getColumnNames(sqlite, "runs"), [
      "id",
      "name",
      "status",
      "started_at",
      "ended_at",
      "input_json",
      "output_json",
      "error",
      "metadata_json"
    ]);
    assert.deepEqual(getNames(sqlite, "index"), [
      "analytics_budgets_scope_idx",
      "evaluation_cases_dataset_id_idx",
      "evaluation_results_case_id_idx",
      "evaluation_results_run_id_idx",
      "events_run_id_idx",
      "events_run_id_status_timestamp_idx",
      "events_run_id_timestamp_idx",
      "events_run_id_type_timestamp_idx",
      "runs_started_at_idx",
      "runs_status_started_at_idx",
      "usage_sessions_session_id_idx"
    ]);
  } finally {
    sqlite.close();
  }
}

function testOldUnversionedDatabase() {
  const sqlite = new Database(":memory:");

  try {
    createOldSchema(sqlite);
    seedOldDatabase(sqlite);

    migrateDatabase(sqlite);

    assert.equal(getUserVersion(sqlite), currentSchemaVersion);
    assert.ok(getColumnNames(sqlite, "runs").includes("metadata_json"));
    assert.deepEqual(getIds(sqlite, "runs"), ["run_keep"]);
    assert.deepEqual(getIds(sqlite, "events"), ["event_keep"]);

    migrateDatabase(sqlite);
    assert.equal(getUserVersion(sqlite), currentSchemaVersion);
    assert.deepEqual(getIds(sqlite, "runs"), ["run_keep"]);
    assert.deepEqual(getIds(sqlite, "events"), ["event_keep"]);
  } finally {
    sqlite.close();
  }
}

function testCurrentDatabaseIsANoOp() {
  const databasePath = join(
    tmpdir(),
    `agent-trace-current-migration-${process.pid}-${Date.now()}.db`
  );
  let sqlite: Database.Database | undefined;

  try {
    sqlite = new Database(databasePath);
    migrateDatabase(sqlite);
    insertRun(sqlite, "run_sentinel", JSON.stringify({ source: "usage-scan" }));
    insertEvent(
      sqlite,
      "event_sentinel",
      "run_sentinel",
      JSON.stringify({ source: "usage-scan" })
    );
    sqlite.exec(`
      CREATE TRIGGER reject_current_run_delete
      BEFORE DELETE ON runs
      BEGIN
        SELECT RAISE(ABORT, 'current database was rewritten');
      END;
      CREATE TRIGGER reject_current_event_delete
      BEFORE DELETE ON events
      BEGIN
        SELECT RAISE(ABORT, 'current database was rewritten');
      END;
    `);
    sqlite.close();
    sqlite = undefined;

    initializeDatabase(databasePath);
    sqlite = new Database(databasePath, { readonly: true });

    assert.equal(getUserVersion(sqlite), currentSchemaVersion);
    assert.deepEqual(getIds(sqlite, "runs"), ["run_sentinel"]);
    assert.deepEqual(getIds(sqlite, "events"), ["event_sentinel"]);
  } finally {
    sqlite?.close();
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
  }
}

function testFailedMigrationRollsBack() {
  const sqlite = new Database(":memory:");

  try {
    sqlite.exec("CREATE TABLE events (id TEXT PRIMARY KEY)");

    assert.throws(() => migrateDatabase(sqlite), /run_id|column/i);
    assert.equal(getUserVersion(sqlite), 0);
    assert.deepEqual(getNames(sqlite, "table"), ["events"]);
  } finally {
    sqlite.close();
  }
}

function testFailedSecondMigrationRollsBack() {
  const sqlite = new Database(":memory:");

  try {
    sqlite.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        input_json TEXT
      );
      CREATE TABLE events (id TEXT PRIMARY KEY);
      PRAGMA user_version = 1;
    `);

    assert.throws(() => migrateDatabase(sqlite), /metadata_json|column/i);
    assert.equal(getUserVersion(sqlite), 1);
    assert.ok(!getColumnNames(sqlite, "runs").includes("metadata_json"));
  } finally {
    sqlite.close();
  }
}

function testFutureDatabaseIsRejectedWithoutChanges() {
  const databasePath = join(
    tmpdir(),
    `agent-trace-future-migration-${process.pid}-${Date.now()}.db`
  );
  let sqlite: Database.Database | undefined;

  try {
    sqlite = new Database(databasePath);
    sqlite.exec(`
      CREATE TABLE sentinel (value TEXT NOT NULL);
      INSERT INTO sentinel (value) VALUES ('keep');
      PRAGMA user_version = ${currentSchemaVersion + 1};
    `);
    const schemaBefore = getSchema(sqlite);
    assert.equal(getJournalMode(sqlite), "delete");

    assert.throws(
      () => migrateDatabase(sqlite!),
      new RegExp(`version ${currentSchemaVersion + 1}.*newer.*${currentSchemaVersion}`, "i")
    );
    assert.equal(getUserVersion(sqlite), currentSchemaVersion + 1);
    assert.deepEqual(getSchema(sqlite), schemaBefore);
    assert.equal(
      (sqlite.prepare("SELECT value FROM sentinel").get() as { value: string }).value,
      "keep"
    );
    assert.equal(getJournalMode(sqlite), "delete");
    sqlite.close();
    sqlite = undefined;

    assert.throws(
      () => initializeDatabase(databasePath),
      new RegExp(`version ${currentSchemaVersion + 1}.*newer.*${currentSchemaVersion}`, "i")
    );

    sqlite = new Database(databasePath);
    assert.equal(getJournalMode(sqlite), "delete");
    assert.equal(getUserVersion(sqlite), currentSchemaVersion + 1);
    assert.deepEqual(getSchema(sqlite), schemaBefore);
    assert.equal(
      (sqlite.prepare("SELECT value FROM sentinel").get() as { value: string }).value,
      "keep"
    );
    sqlite.close();
    sqlite = undefined;

    assert.doesNotThrow(() => rmSync(databasePath));
    assert.equal(existsSync(databasePath), false);
  } finally {
    sqlite?.close();
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
  }
}

function createOldSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      input_json TEXT,
      output_json TEXT,
      error TEXT
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      parent_id TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration_ms INTEGER,
      input_json TEXT,
      output_json TEXT,
      error_json TEXT,
      metadata_json TEXT
    );
  `);
}

function seedOldDatabase(sqlite: Database.Database) {
  insertRun(sqlite, "run_keep", "{not-json");
  insertRun(sqlite, "run_usage", JSON.stringify({ source: "usage-scan" }));
  insertEvent(sqlite, "event_keep", "run_keep", JSON.stringify({ source: "otel" }));
  insertEvent(
    sqlite,
    "event_usage_on_keep",
    "run_keep",
    JSON.stringify({ source: "usage-scan" })
  );
  insertEvent(
    sqlite,
    "event_usage_run",
    "run_usage",
    JSON.stringify({ source: "usage-scan" })
  );
}

function insertRun(sqlite: Database.Database, id: string, inputJson: string) {
  sqlite
    .prepare(
      "INSERT INTO runs (id, name, status, started_at, input_json) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, id, "success", "2026-07-13T00:00:00.000Z", inputJson);
}

function insertEvent(
  sqlite: Database.Database,
  id: string,
  runId: string,
  metadataJson: string
) {
  sqlite
    .prepare(
      "INSERT INTO events (id, run_id, type, name, status, timestamp, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      id,
      runId,
      "tool_call",
      id,
      "success",
      "2026-07-13T00:00:00.000Z",
      metadataJson
    );
}

function getUserVersion(sqlite: Database.Database) {
  return sqlite.pragma("user_version", { simple: true }) as number;
}

function getJournalMode(sqlite: Database.Database) {
  return sqlite.pragma("journal_mode", { simple: true }) as string;
}

function getColumnNames(sqlite: Database.Database, table: string) {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name
  );
}

function getIds(sqlite: Database.Database, table: "runs" | "events") {
  return (sqlite.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>).map(
    (row) => row.id
  );
}

function getNames(sqlite: Database.Database, type: "table" | "index") {
  return (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all(type) as Array<{ name: string }>
  ).map((row) => row.name);
}

function getSchema(sqlite: Database.Database) {
  return sqlite
    .prepare(
      "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master ORDER BY type, name"
    )
    .all();
}
