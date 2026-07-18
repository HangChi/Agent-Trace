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
CREATE INDEX IF NOT EXISTS evaluation_cases_dataset_id_idx ON evaluation_cases(dataset_id);
CREATE INDEX IF NOT EXISTS evaluation_results_case_id_idx ON evaluation_results(case_id);
CREATE INDEX IF NOT EXISTS evaluation_results_run_id_idx ON evaluation_results(run_id);
