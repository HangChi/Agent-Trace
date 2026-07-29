import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, gte, lt } from "drizzle-orm";
import type {
  DashboardScannerStatus,
  DashboardUsageSummary,
  ScannerDiagnostic,
  UsageSnapshotRow
} from "@agent-trace/schema";

import { db as defaultDb } from "./db.js";
import { runs, usageDaily, usageScanState, usageSessions } from "./schema.js";
import { publishChange } from "./change-feed.js";

type Database = BetterSQLite3Database;
type DashboardMonthlyUsageSummary = DashboardUsageSummary & {
  month: string;
  activeDays: number;
  sessionCount: number;
  callCount: number;
};

export type { ScannerDiagnostic, UsageSnapshotRow } from "@agent-trace/schema";

export type UsageSnapshot = {
  scannedAt: string;
  reconciledClients: string[];
  rows: UsageSnapshotRow[];
  diagnostics?: ScannerDiagnostic[];
  dailyRows?: UsageDailyRow[];
  error?: string;
};

export type UsageDailyRow = {
  date: string;
  client: string;
  model: string;
  provider: string;
  totalTokens: number;
  costUsd?: number;
  messageCount: number;
};

export async function replaceUsageSnapshot(
  snapshot: UsageSnapshot,
  database: Database = defaultDb
) {
  const result = database.transaction((transaction) => {
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

    if (snapshot.dailyRows) {
      transaction.delete(usageDaily).run();
      for (const row of snapshot.dailyRows) {
        transaction.insert(usageDaily).values(row).run();
      }
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

  publishChange("usage");
  return result;
}

export async function getUsageSummary(database: Database = defaultDb): Promise<DashboardUsageSummary> {
  const rows = await database.select().from(usageSessions);
  return summarizeUsageRows(rows);
}

export async function getMonthlyUsageSummary(
  month: string,
  database: Database = defaultDb
): Promise<DashboardMonthlyUsageSummary> {
  const { start, end } = getMonthBounds(month);
  const runRows = await database
    .select({ startedAt: runs.startedAt, metadataJson: runs.metadataJson })
    .from(runs)
    .where(and(gte(runs.startedAt, start), lt(runs.startedAt, end)));
  const dailyRows = await database
    .select()
    .from(usageDaily)
    .where(and(gte(usageDaily.date, month), lt(usageDaily.date, end.slice(0, 7))));
  if (dailyRows.length > 0) {
    const models = new Map<string, { provider?: string; totalTokens: number; costUsd: number }>();
    for (const row of dailyRows) {
      const current = models.get(row.model) ?? {
        provider: row.provider || undefined,
        totalTokens: 0,
        costUsd: 0
      };
      current.totalTokens += row.totalTokens;
      current.costUsd += row.costUsd ?? 0;
      models.set(row.model, current);
    }
    return {
      month,
      totalTokens: dailyRows.reduce((total, row) => total + row.totalTokens, 0),
      costUsd: dailyRows.reduce((total, row) => total + (row.costUsd ?? 0), 0),
      activeDays: new Set(dailyRows.map((row) => row.date)).size,
      sessionCount: runRows.length,
      callCount: dailyRows.reduce((total, row) => total + row.messageCount, 0),
      clients: [],
      models: [...models.entries()].map(([model, value]) => ({ model, ...value }))
    };
  }
  const sessionKeys = new Set(
    runRows
      .map((run) => getUsageSessionKey(run.metadataJson))
      .filter((key): key is string => Boolean(key))
  );
  const rows = (await database.select().from(usageSessions)).filter((row) => {
    const usageDate = row.lastUsedAt ?? row.startedAt;
    return usageDate?.startsWith(`${month}-`)
      || sessionKeys.has(`${row.client}\0${row.sessionId}`);
  });
  const summary = summarizeUsageRows(rows);
  const activeDates = new Set(
    [
      ...runRows.map((run) => run.startedAt.slice(0, 10)),
      ...rows.map((row) => (row.lastUsedAt ?? row.startedAt)?.slice(0, 10))
    ]
      .filter((date): date is string => Boolean(date))
  );
  const sessions = new Set(rows.map((row) => `${row.client}\0${row.sessionId}`));

  return {
    ...summary,
    month,
    activeDays: activeDates.size,
    sessionCount: runRows.length || sessions.size,
    callCount: rows.reduce((total, row) => total + (row.messageCount ?? 0), 0)
  };
}

export async function getDailyUsage(year: string, database: Database = defaultDb) {
  const rows = await database
    .select()
    .from(usageDaily)
    .where(and(gte(usageDaily.date, `${year}-01-01`), lt(usageDaily.date, `${Number(year) + 1}-01-01`)));
  const totals = new Map<string, { totalTokens: number; messageCount: number }>();
  for (const row of rows) {
    const current = totals.get(row.date) ?? { totalTokens: 0, messageCount: 0 };
    current.totalTokens += row.totalTokens;
    current.messageCount += row.messageCount;
    totals.set(row.date, current);
  }
  return [...totals.entries()].map(([date, value]) => ({ date, ...value }));
}

function getMonthBounds(month: string) {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;

  return {
    start: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString()
  };
}

function getUsageSessionKey(metadataJson: string | null) {
  if (!metadataJson) return undefined;

  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    const sessionId = typeof metadata.sessionId === "string" ? metadata.sessionId : undefined;
    const agent = typeof metadata.agent === "string" ? metadata.agent : undefined;
    if (!sessionId || !agent) return undefined;

    const client = agent === "claude-code"
      ? "claude"
      : agent === "github-copilot"
        ? "copilot"
        : agent;
    return `${client}\0${sessionId}`;
  } catch {
    return undefined;
  }
}

function summarizeUsageRows(
  rows: Array<typeof usageSessions.$inferSelect>
): DashboardUsageSummary {
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
