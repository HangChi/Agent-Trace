import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { desc, eq } from "drizzle-orm";

import type { CreateRun, CreateTraceEvent, Run, UpdateRun } from "@tooltrace/schema";

import { createSqliteDatabase, db as defaultDb } from "./db.js";
import { events, runs } from "./schema.js";

type Database = BetterSQLite3Database;

function stringifyJson(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson(value: string | null) {
  return value === null ? undefined : JSON.parse(value);
}

export function initializeDatabase(path?: string) {
  const sqlite = createSqliteDatabase(path);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
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

    CREATE INDEX IF NOT EXISTS events_run_id_idx ON events(run_id);
    CREATE INDEX IF NOT EXISTS runs_started_at_idx ON runs(started_at);
  `);

  ensureColumn(sqlite, "runs", "metadata_json", "TEXT");

  sqlite.close();
}

export async function createRun(run: CreateRun, database: Database = defaultDb) {
  await database.insert(runs).values({
    id: run.id,
    name: run.name,
    status: run.status,
    startedAt: run.startedAt ?? new Date().toISOString(),
    inputJson: stringifyJson(run.input),
    outputJson: stringifyJson(run.output),
    error: run.error,
    metadataJson: stringifyJson(run.metadata)
  });
}

export async function getRunById(
  id: string,
  database: Database = defaultDb
): Promise<Run | undefined> {
  const row = await database.select().from(runs).where(eq(runs.id, id)).limit(1).get();

  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    name: row.name,
    status: row.status as Run["status"],
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    input: parseJson(row.inputJson),
    output: parseJson(row.outputJson),
    error: row.error ?? undefined,
    metadata: parseJson(row.metadataJson)
  };
}

export async function updateRun(
  id: string,
  run: UpdateRun,
  database: Database = defaultDb
) {
  await database
    .update(runs)
    .set({
      status: run.status,
      endedAt: run.endedAt ?? new Date().toISOString(),
      outputJson: stringifyJson(run.output),
      error: run.error
    })
    .where(eq(runs.id, id));
}

export async function createEvent(
  event: CreateTraceEvent,
  database: Database = defaultDb
) {
  await database.insert(events).values({
    id: event.id,
    runId: event.runId,
    parentId: event.parentId,
    type: event.type,
    name: event.name,
    status: event.status,
    timestamp: event.timestamp ?? new Date().toISOString(),
    durationMs: event.durationMs,
    inputJson: stringifyJson(event.input),
    outputJson: stringifyJson(event.output),
    errorJson: stringifyJson(event.error),
    metadataJson: stringifyJson(event.metadata)
  });
}

export async function listRuns(database: Database = defaultDb) {
  const rows = await database.select().from(runs).orderBy(desc(runs.startedAt));

  return rows.map((run) => ({
    id: run.id,
    name: run.name,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? undefined,
    input: parseJson(run.inputJson),
    output: parseJson(run.outputJson),
    error: run.error ?? undefined,
    metadata: parseJson(run.metadataJson)
  }));
}

export async function listEventsByRunId(
  runId: string,
  database: Database = defaultDb
) {
  const rows = await database.select().from(events).where(eq(events.runId, runId));

  return rows.map((event) => ({
    id: event.id,
    runId: event.runId,
    parentId: event.parentId ?? undefined,
    type: event.type,
    name: event.name,
    status: event.status,
    timestamp: event.timestamp,
    durationMs: event.durationMs ?? undefined,
    input: parseJson(event.inputJson),
    output: parseJson(event.outputJson),
    error: parseJson(event.errorJson),
    metadata: parseJson(event.metadataJson)
  }));
}

export async function deleteRun(id: string, database: Database = defaultDb): Promise<boolean> {
  // Foreign keys cascade events, but delete them explicitly so the result is
  // correct even if the connection has foreign_keys disabled.
  await database.delete(events).where(eq(events.runId, id));
  const result = await database.delete(runs).where(eq(runs.id, id));

  return result.changes > 0;
}

function ensureColumn(
  sqlite: ReturnType<typeof createSqliteDatabase>,
  tableName: string,
  columnName: string,
  definition: string
) {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;

  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
