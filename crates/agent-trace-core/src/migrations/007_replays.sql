CREATE TABLE IF NOT EXISTS replay_tasks (
  id TEXT PRIMARY KEY,
  source_run_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  replay_run_id TEXT,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  workspace_cleaned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS replay_tasks_source_run_created_at_idx ON replay_tasks(source_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS replay_tasks_status_created_at_idx ON replay_tasks(status, created_at DESC);
