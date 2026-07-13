import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  inputJson: text("input_json"),
  outputJson: text("output_json"),
  error: text("error"),
  metadataJson: text("metadata_json")
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  type: text("type").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  timestamp: text("timestamp").notNull(),
  durationMs: integer("duration_ms"),
  inputJson: text("input_json"),
  outputJson: text("output_json"),
  errorJson: text("error_json"),
  metadataJson: text("metadata_json")
});

export const usageSessions = sqliteTable(
  "usage_sessions",
  {
    client: text("client").notNull(),
    sessionId: text("session_id").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    reasoningTokens: integer("reasoning_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    costUsd: real("cost_usd"),
    messageCount: integer("message_count"),
    startedAt: text("started_at"),
    lastUsedAt: text("last_used_at"),
    scannedAt: text("scanned_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.client, table.sessionId, table.model, table.provider] })]
);

export const usageScanState = sqliteTable("usage_scan_state", {
  id: text("id").primaryKey(),
  scannedAt: text("scanned_at").notNull(),
  diagnosticsJson: text("diagnostics_json").notNull(),
  error: text("error")
});
