import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { initializeDatabase } from "./storage.js";
import {
  getScannerStatus,
  getUsageSummary,
  replaceUsageSnapshot
} from "./usage-storage.js";

const databasePath = join(tmpdir(), `agent-trace-usage-storage-${Date.now()}.db`);
let rawDatabase: Database.Database | undefined;

try {
  seedLegacyUsageRun(databasePath);
  initializeDatabase(databasePath);

  rawDatabase = new Database(databasePath);
  const database = drizzle(rawDatabase);
  const legacy = new Database(databasePath, { readonly: true });

  const legacyUsageCount = legacy
    .prepare("SELECT COUNT(*) AS count FROM runs WHERE id = 'run_usage_scan_legacy'")
    .get() as { count: number };
  if (legacyUsageCount.count !== 0) {
    throw new Error("Expected initialization to remove legacy scanner-only runs.");
  }

  const hookRunCount = legacy
    .prepare("SELECT COUNT(*) AS count FROM runs WHERE id = 'run_hook_keep'")
    .get() as { count: number };
  if (hookRunCount.count !== 1) {
    throw new Error("Expected initialization to preserve real hook runs.");
  }

  legacy.close();

  await replaceUsageSnapshot(
    {
      scannedAt: "2026-07-12T10:00:00.000Z",
      reconciledClients: ["codex", "kiro", "claude"],
      rows: [
        usageRow("codex", "session-a", 120, 0.12),
        usageRow("kiro", "stale-kiro", 80, 0.08),
        usageRow("claude", "session-c", 50, 0.05)
      ],
      diagnostics: [
        { client: "codex", status: "available", pathExists: true },
        { client: "kiro", status: "available", pathExists: false }
      ]
    },
    database
  );

  await replaceUsageSnapshot(
    {
      scannedAt: "2026-07-12T10:01:00.000Z",
      reconciledClients: ["codex", "kiro"],
      rows: [usageRow("codex", "session-a", 150, 0.15)],
      diagnostics: [
        { client: "codex", status: "available", pathExists: true },
        { client: "kiro", status: "missing", pathExists: false }
      ]
    },
    database
  );

  const summary = await getUsageSummary(database);

  if (summary.totalTokens !== 200 || summary.costUsd !== 0.2) {
    throw new Error("Expected snapshots to replace reconciled clients and preserve failed clients.");
  }

  if (summary.clients.some((client) => client.client === "kiro")) {
    throw new Error("Expected a definitively missing client to be removed from the snapshot.");
  }

  if (!summary.clients.some((client) => client.client === "claude" && client.totalTokens === 50)) {
    throw new Error("Expected an unreconciled client to preserve its previous snapshot.");
  }

  const scanner = await getScannerStatus(database);

  if (
    scanner.scannedAt !== "2026-07-12T10:01:00.000Z" ||
    scanner.diagnostics.find((item) => item.client === "kiro")?.status !== "missing"
  ) {
    throw new Error("Expected scanner diagnostics to live outside the runs table.");
  }

  const runCount = databasePathCount(databasePath, "SELECT COUNT(*) AS count FROM runs");
  const eventCount = databasePathCount(databasePath, "SELECT COUNT(*) AS count FROM events");

  if (runCount !== 1 || eventCount !== 1) {
    throw new Error("Expected usage snapshots to avoid creating runs or trace events.");
  }

  console.log("Agent-Trace usage storage smoke test passed.");
} finally {
  rawDatabase?.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
}

function usageRow(client: string, sessionId: string, totalTokens: number, costUsd: number) {
  return {
    client,
    sessionId,
    model: "test-model",
    provider: "test-provider",
    inputTokens: totalTokens - 20,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 5,
    totalTokens,
    costUsd,
    messageCount: 1,
    startedAt: "2026-07-12T09:00:00.000Z",
    lastUsedAt: "2026-07-12T09:01:00.000Z"
  };
}

function seedLegacyUsageRun(path: string) {
  const sqlite = new Database(path);
  sqlite.exec(`
    CREATE TABLE runs (
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
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
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
  const insertRun = sqlite.prepare(
    "INSERT INTO runs (id,name,status,started_at,input_json) VALUES (?,?,?,?,?)"
  );
  insertRun.run(
    "run_usage_scan_legacy",
    "usage-scan:legacy",
    "success",
    "2026-07-12T09:00:00.000Z",
    JSON.stringify({ source: "usage-scan" })
  );
  insertRun.run(
    "run_hook_keep",
    "codex:keep",
    "success",
    "2026-07-12T09:00:00.000Z",
    JSON.stringify({ source: "codex-otel" })
  );
  const insertEvent = sqlite.prepare(
    "INSERT INTO events (id,run_id,type,name,status,timestamp,metadata_json) VALUES (?,?,?,?,?,?,?)"
  );
  insertEvent.run(
    "evt_usage_scan_legacy",
    "run_usage_scan_legacy",
    "llm_call",
    "token_usage",
    "success",
    "2026-07-12T09:00:00.000Z",
    JSON.stringify({ source: "usage-scan" })
  );
  insertEvent.run(
    "evt_hook_keep",
    "run_hook_keep",
    "tool_call",
    "exec_command",
    "success",
    "2026-07-12T09:00:00.000Z",
    JSON.stringify({ source: "otel" })
  );
  sqlite.close();
}

function databasePathCount(path: string, sql: string) {
  const sqlite = new Database(path, { readonly: true });
  const result = sqlite.prepare(sql).get() as { count: number };
  sqlite.close();
  return result.count;
}
