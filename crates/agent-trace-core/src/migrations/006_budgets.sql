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
CREATE INDEX IF NOT EXISTS analytics_budgets_scope_idx ON analytics_budgets(dimension, dimension_value, enabled);
