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
