use std::{
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

use anyhow::{Context, bail};
use rusqlite::{Connection, OpenFlags};

pub const CURRENT_SCHEMA_VERSION: i64 = 7;

pub fn merge_compatible_database(
    destination: impl AsRef<Path>,
    source: impl AsRef<Path>,
) -> anyhow::Result<usize> {
    let destination = destination.as_ref();
    let source = source.as_ref();
    if !source.is_file() || destination == source {
        return Ok(0);
    }
    let source_connection =
        Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .with_context(|| format!("failed to inspect legacy database {}", source.display()))?;
    let source_version: i64 =
        source_connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if source_version != CURRENT_SCHEMA_VERSION {
        bail!(
            "Legacy database {} uses schema version {source_version}; expected {CURRENT_SCHEMA_VERSION}.",
            source.display()
        );
    }
    drop(source_connection);

    let database = Database::open(destination)?;
    let mut connection = database.connection()?;
    let before = database_record_count(&connection)?;
    connection.execute(
        "ATTACH DATABASE ?1 AS legacy",
        [source.to_string_lossy().as_ref()],
    )?;
    let result = (|| -> anyhow::Result<()> {
        let transaction = connection.transaction()?;
        for table in [
            "runs",
            "events",
            "usage_sessions",
            "usage_scan_state",
            "run_tombstones",
            "settings",
            "evaluation_datasets",
            "evaluation_cases",
            "evaluation_results",
            "analytics_budgets",
            "replay_tasks",
        ] {
            let exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM legacy.sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |row| row.get(0),
            )?;
            if exists {
                transaction.execute(
                    &format!("INSERT OR IGNORE INTO main.{table} SELECT * FROM legacy.{table}"),
                    [],
                )?;
            }
        }
        transaction.commit()?;
        Ok(())
    })();
    let _ = connection.execute_batch("DETACH DATABASE legacy");
    result?;
    let after = database_record_count(&connection)?;
    Ok(after.saturating_sub(before))
}

fn database_record_count(connection: &Connection) -> anyhow::Result<usize> {
    let mut count = 0_i64;
    for table in ["runs", "events", "usage_sessions"] {
        count += connection.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get::<_, i64>(0)
        })?;
    }
    Ok(count.max(0) as usize)
}

#[derive(Clone)]
pub struct Database {
    path: Arc<std::path::PathBuf>,
    connection: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!("failed to create database directory {}", parent.display())
            })?;
        }
        let mut connection = Connection::open(&path)
            .with_context(|| format!("failed to open SQLite database {}", path.display()))?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > CURRENT_SCHEMA_VERSION {
            bail!(
                "Database version {version} is newer than supported version {CURRENT_SCHEMA_VERSION}."
            );
        }
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&mut connection, version)?;

        Ok(Self {
            path: Arc::new(path),
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn path(&self) -> &Path {
        self.path.as_path()
    }

    pub(crate) fn connection(&self) -> anyhow::Result<MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))
    }
}

fn migrate(connection: &mut Connection, mut version: i64) -> anyhow::Result<()> {
    let migrations: &[fn(&rusqlite::Transaction<'_>) -> rusqlite::Result<()>] = &[
        migration_1,
        migration_2,
        migration_3,
        migration_4,
        migration_5,
        migration_6,
        migration_7,
    ];

    while version < CURRENT_SCHEMA_VERSION {
        let next = version + 1;
        let transaction = connection.transaction()?;
        migrations[version as usize](&transaction)?;
        transaction.pragma_update(None, "user_version", next)?;
        transaction.commit()?;
        version = next;
    }
    Ok(())
}

fn migration_1(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(include_str!("migrations/001_initial.sql"))
}

fn migration_2(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    if !has_column(tx, "runs", "metadata_json")? {
        tx.execute("ALTER TABLE runs ADD COLUMN metadata_json TEXT", [])?;
    }
    remove_legacy_usage_scan_records(tx)
}

fn migration_3(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(include_str!("migrations/003_tombstones.sql"))
}

fn migration_4(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(include_str!("migrations/004_settings.sql"))
}

fn migration_5(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(include_str!("migrations/005_evaluations.sql"))
}

fn migration_6(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(include_str!("migrations/006_budgets.sql"))
}

fn migration_7(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(include_str!("migrations/007_replays.sql"))
}

fn has_column(tx: &rusqlite::Transaction<'_>, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut statement = tx.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement.query_map([], |row| row.get::<_, String>(1))?;
    for name in names {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn remove_legacy_usage_scan_records(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM events WHERE json_extract(metadata_json, '$.source') = 'usage-scan'",
        [],
    )?;
    tx.execute(
        "DELETE FROM runs WHERE json_extract(input_json, '$.source') = 'usage-scan'",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_the_same_schema_version_as_node() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(directory.path().join("agent-trace.db")).unwrap();
        let connection = database.connection().unwrap();
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        let tables: Vec<String> = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(tables.contains(&"runs".to_owned()));
        assert!(tables.contains(&"events".to_owned()));
        assert!(tables.contains(&"evaluation_datasets".to_owned()));
        assert!(tables.contains(&"analytics_budgets".to_owned()));
        assert!(tables.contains(&"replay_tasks".to_owned()));
    }

    #[test]
    fn rejects_a_newer_node_database() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("future.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION + 1)
            .unwrap();
        drop(connection);
        assert!(Database::open(path).is_err());
    }

    #[test]
    fn merges_a_compatible_node_database_without_overwriting_desktop_rows() {
        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("node.db");
        let destination_path = directory.path().join("desktop.db");
        for (path, id) in [
            (&source_path, "node-run"),
            (&destination_path, "desktop-run"),
        ] {
            let database = Database::open(path).unwrap();
            database
                .connection()
                .unwrap()
                .execute(
                    "INSERT INTO runs (id,name,status,started_at) VALUES (?1,?1,'success','2026-01-01T00:00:00.000Z')",
                    [id],
                )
                .unwrap();
        }
        assert_eq!(
            merge_compatible_database(&destination_path, &source_path).unwrap(),
            1
        );
        let destination = Database::open(&destination_path).unwrap();
        let count: i64 = destination
            .connection()
            .unwrap()
            .query_row("SELECT count(*) FROM runs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
        assert_eq!(
            merge_compatible_database(&destination_path, &source_path).unwrap(),
            0
        );
    }
}
