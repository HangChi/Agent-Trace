import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type {
  DashboardScannerStatus,
  DashboardUsageSummary,
  ScannerDiagnostic,
  UsageSnapshotRow
} from "@agent-trace/schema";

import { db as defaultDb } from "./db.js";
import { usageScanState, usageSessions } from "./schema.js";

type Database = BetterSQLite3Database;

export type { ScannerDiagnostic, UsageSnapshotRow } from "@agent-trace/schema";

export type UsageSnapshot = {
  scannedAt: string;
  reconciledClients: string[];
  rows: UsageSnapshotRow[];
  diagnostics?: ScannerDiagnostic[];
  error?: string;
};

export async function replaceUsageSnapshot(
  snapshot: UsageSnapshot,
  database: Database = defaultDb
) {
  return database.transaction((transaction) => {
    const priorState = transaction
      .select()
      .from(usageScanState)
      .where(eq(usageScanState.id, "current"))
      .limit(1)
      .get();
    const diagnosticsJson = snapshot.diagnostics === undefined
      ? priorState?.diagnosticsJson ?? "[]"
      : JSON.stringify(snapshot.diagnostics);
    for (const client of new Set(snapshot.reconciledClients)) {
      transaction.delete(usageSessions).where(eq(usageSessions.client, client)).run();
    }

    for (const row of snapshot.rows) {
      if (row.totalTokens <= 0 && (row.costUsd ?? 0) <= 0) continue;

      transaction
        .insert(usageSessions)
        .values({
          client: row.client,
          sessionId: row.sessionId ?? "usage",
          model: row.model ?? "",
          provider: row.provider ?? "",
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cacheReadTokens: row.cacheReadTokens,
          cacheWriteTokens: row.cacheWriteTokens,
          reasoningTokens: row.reasoningTokens,
          totalTokens: row.totalTokens,
          costUsd: row.costUsd,
          messageCount: row.messageCount,
          startedAt: row.startedAt,
          lastUsedAt: row.lastUsedAt,
          scannedAt: snapshot.scannedAt
        })
        .onConflictDoUpdate({
          target: [
            usageSessions.client,
            usageSessions.sessionId,
            usageSessions.model,
            usageSessions.provider
          ],
          set: {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cacheReadTokens: row.cacheReadTokens,
            cacheWriteTokens: row.cacheWriteTokens,
            reasoningTokens: row.reasoningTokens,
            totalTokens: row.totalTokens,
            costUsd: row.costUsd,
            messageCount: row.messageCount,
            startedAt: row.startedAt,
            lastUsedAt: row.lastUsedAt,
            scannedAt: snapshot.scannedAt
          }
        })
        .run();
    }

    transaction
      .insert(usageScanState)
      .values({
        id: "current",
        scannedAt: snapshot.scannedAt,
        diagnosticsJson,
        error: snapshot.error
      })
      .onConflictDoUpdate({
        target: usageScanState.id,
        set: {
          scannedAt: snapshot.scannedAt,
          diagnosticsJson,
          error: snapshot.error
        }
      })
      .run();
  });
}

export async function getUsageSummary(database: Database = defaultDb): Promise<DashboardUsageSummary> {
  const rows = await database.select().from(usageSessions);
  const clients = new Map<string, { totalTokens: number; costUsd: number }>();
  const models = new Map<string, { provider?: string; totalTokens: number; costUsd: number }>();
  let totalTokens = 0;
  let costUsd = 0;

  for (const row of rows) {
    totalTokens += row.totalTokens;
    costUsd += row.costUsd ?? 0;
    const client = clients.get(row.client) ?? { totalTokens: 0, costUsd: 0 };
    client.totalTokens += row.totalTokens;
    client.costUsd += row.costUsd ?? 0;
    clients.set(row.client, client);

    if (row.model) {
      const model = models.get(row.model) ?? {
        provider: row.provider || undefined,
        totalTokens: 0,
        costUsd: 0
      };
      model.totalTokens += row.totalTokens;
      model.costUsd += row.costUsd ?? 0;
      models.set(row.model, model);
    }
  }

  return {
    totalTokens,
    costUsd,
    clients: [...clients.entries()].map(([client, value]) => ({ client, ...value })),
    models: [...models.entries()].map(([model, value]) => ({ model, ...value }))
  };
}

export async function getScannerStatus(database: Database = defaultDb): Promise<DashboardScannerStatus> {
  const state = await database
    .select()
    .from(usageScanState)
    .where(eq(usageScanState.id, "current"))
    .limit(1)
    .get();

  return {
    scannedAt: state?.scannedAt,
    diagnostics: parseDiagnostics(state?.diagnosticsJson),
    error: state?.error ?? undefined
  };
}

function parseDiagnostics(value: string | undefined): ScannerDiagnostic[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ScannerDiagnostic[]) : [];
  } catch {
    return [];
  }
}
