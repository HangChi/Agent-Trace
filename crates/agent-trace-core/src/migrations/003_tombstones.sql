CREATE TABLE IF NOT EXISTS run_tombstones (
  run_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS runs_status_started_at_idx ON runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS events_run_id_status_timestamp_idx ON events(run_id, status, timestamp DESC);
CREATE INDEX IF NOT EXISTS events_run_id_type_timestamp_idx ON events(run_id, type, timestamp DESC);
CREATE INDEX IF NOT EXISTS usage_sessions_session_id_idx ON usage_sessions(session_id);
