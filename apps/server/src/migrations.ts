import type Database from "better-sqlite3";

type Migration = (sqlite: Database.Database) => void;

const migrations: Migration[] = [
  (sqlite) => {
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
      CREATE INDEX IF NOT EXISTS events_run_id_timestamp_idx ON events(run_id, timestamp);
      CREATE INDEX IF NOT EXISTS runs_started_at_idx ON runs(started_at);

      CREATE TABLE IF NOT EXISTS usage_sessions (
        client TEXT NOT NULL,
        session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        cost_usd REAL,
        message_count INTEGER,
        started_at TEXT,
        last_used_at TEXT,
        scanned_at TEXT NOT NULL,
        PRIMARY KEY (client, session_id, model, provider)
      );

      CREATE TABLE IF NOT EXISTS usage_scan_state (
        id TEXT PRIMARY KEY,
        scanned_at TEXT NOT NULL,
        diagnostics_json TEXT NOT NULL,
        error TEXT
      );
    `);
  },
  (sqlite) => {
    ensureColumn(sqlite, "runs", "metadata_json", "TEXT");
    removeLegacyUsageScanRecords(sqlite);
  },
  (sqlite) => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS run_tombstones (
        run_id TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL,
        reason TEXT
      );

      CREATE INDEX IF NOT EXISTS runs_status_started_at_idx
        ON runs(status, started_at DESC);
      CREATE INDEX IF NOT EXISTS events_run_id_status_timestamp_idx
        ON events(run_id, status, timestamp DESC);
      CREATE INDEX IF NOT EXISTS events_run_id_type_timestamp_idx
        ON events(run_id, type, timestamp DESC);
      CREATE INDEX IF NOT EXISTS usage_sessions_session_id_idx
        ON usage_sessions(session_id);
    `);
  },
  (sqlite) => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
  (sqlite) => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS evaluation_datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        score_weights_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evaluation_cases (
        id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL REFERENCES evaluation_datasets(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        expected_output_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evaluation_results (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES evaluation_cases(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        scores_json TEXT NOT NULL,
        quality_score REAL NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(case_id, run_id)
      );

      CREATE INDEX IF NOT EXISTS evaluation_cases_dataset_id_idx
        ON evaluation_cases(dataset_id);
      CREATE INDEX IF NOT EXISTS evaluation_results_case_id_idx
        ON evaluation_results(case_id);
      CREATE INDEX IF NOT EXISTS evaluation_results_run_id_idx
        ON evaluation_results(run_id);
    `);
  },
  (sqlite) => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS analytics_budgets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dimension TEXT NOT NULL,
        dimension_value TEXT NOT NULL,
        period TEXT NOT NULL,
        max_cost_usd REAL,
        max_tokens INTEGER,
        max_runs INTEGER,
        enabled INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS analytics_budgets_scope_idx
        ON analytics_budgets(dimension, dimension_value, enabled);
    `);
  }
];

export const currentSchemaVersion = migrations.length;

export function migrateDatabase(sqlite: Database.Database): void {
  const databaseVersion = assertSupportedDatabaseVersion(sqlite);

  for (let index = databaseVersion; index < migrations.length; index += 1) {
    const migration = migrations[index];
    const nextVersion = index + 1;

    sqlite.transaction(() => {
      migration!(sqlite);
      sqlite.pragma(`user_version = ${nextVersion}`);
    })();
  }
}

export function assertSupportedDatabaseVersion(sqlite: Database.Database): number {
  const databaseVersion = sqlite.pragma("user_version", { simple: true }) as number;

  if (databaseVersion > currentSchemaVersion) {
    throw new Error(
      `Database version ${databaseVersion} is newer than supported version ${currentSchemaVersion}.`
    );
  }

  return databaseVersion;
}

function removeLegacyUsageScanRecords(sqlite: Database.Database) {
  const usageEventIds = (sqlite
    .prepare("SELECT id, metadata_json AS metadataJson FROM events")
    .all() as Array<{ id: string; metadataJson: string | null }>)
    .filter((row) => getJsonSource(row.metadataJson) === "usage-scan")
    .map((row) => row.id);
  const usageRunIds = (sqlite
    .prepare("SELECT id, input_json AS inputJson FROM runs")
    .all() as Array<{ id: string; inputJson: string | null }>)
    .filter((row) => getJsonSource(row.inputJson) === "usage-scan")
    .map((row) => row.id);
  const deleteEvent = sqlite.prepare("DELETE FROM events WHERE id = ?");
  const deleteRunEvents = sqlite.prepare("DELETE FROM events WHERE run_id = ?");
  const deleteRun = sqlite.prepare("DELETE FROM runs WHERE id = ?");

  for (const id of usageEventIds) deleteEvent.run(id);
  for (const id of usageRunIds) {
    deleteRunEvents.run(id);
    deleteRun.run(id);
  }
}

function getJsonSource(value: string | null) {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).source
      : undefined;
  } catch {
    return undefined;
  }
}

function ensureColumn(
  sqlite: Database.Database,
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
