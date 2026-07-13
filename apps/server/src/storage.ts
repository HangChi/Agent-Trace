import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type {
  CreateRun,
  CreateTraceEvent,
  DashboardEventFilters,
  DashboardEventPage,
  DashboardEventVisibility,
  DashboardModelUsage,
  DashboardRun,
  DashboardRunMetadata,
  DashboardRunPage,
  DashboardRunSummary,
  DashboardTraceEvent,
  DashboardTraceMetadata,
  Run,
  TokenUsage,
  UpdateRun
} from "@agent-trace/schema";

import { createSqliteDatabase, db as defaultDb } from "./db.js";
import { migrateDatabase } from "./migrations.js";
import { events, runs, usageSessions } from "./schema.js";
import { analyzeTraceInsights } from "./trace-insights.js";
import type { TranscriptTrace } from "./transcript-scan.js";

type Database = BetterSQLite3Database;

type ListRunsOptions = {
  includeUntracked?: boolean;
};

type ListRunsPageOptions = ListRunsOptions & {
  page?: number;
  pageSize?: number;
};

type EventSummary = DashboardRunSummary & {
  unmodeledTokenUsage: TokenUsage;
  hasErrorEvent: boolean;
  lastEventAt?: string;
};

type ListEventsOptions = DashboardEventFilters & {
  visibility?: DashboardEventVisibility;
  page?: number;
  pageSize?: number;
};

type EventSummaryRow = Pick<
  typeof events.$inferSelect,
  "runId" | "status" | "timestamp" | "name" | "metadataJson"
>;

type EventScanRow = Pick<
  typeof events.$inferSelect,
  | "id"
  | "runId"
  | "parentId"
  | "type"
  | "name"
  | "status"
  | "timestamp"
  | "durationMs"
  | "metadataJson"
> & { inputCommand: string | null; errorMessage: string | null };

const defaultStaleRunMinutes = 30;
const defaultEventPageSize = 100;
const maxEventPageSize = 500;
const defaultRunPageSize = 50;
const maxRunPageSize = 200;
const runScanChunkSize = 200;
const noEventTimestampSentinel = "<no-events>";

function stringifyJson(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson(value: string | null) {
  return value === null ? undefined : JSON.parse(value);
}

export function initializeDatabase(path?: string) {
  const sqlite = createSqliteDatabase(path);

  try {
    migrateDatabase(sqlite);
  } finally {
    sqlite.close();
  }
}

function getJsonSource(value: string | null) {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).source
      : undefined;
  } catch {
    return undefined;
  }
}

export async function createRun(run: CreateRun, database: Database = defaultDb) {
  await database.insert(runs).values({
    id: run.id,
    name: run.name,
    status: run.status,
    startedAt: run.startedAt ?? new Date().toISOString(),
    inputJson: stringifyJson(run.input),
    outputJson: stringifyJson(run.output),
    error: run.error,
    metadataJson: stringifyJson(run.metadata)
  });
}

export async function getRunById(
  id: string,
  database: Database = defaultDb
): Promise<Run | undefined> {
  const row = await database.select().from(runs).where(eq(runs.id, id)).limit(1).get();

  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    name: row.name,
    status: row.status as Run["status"],
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    input: parseJson(row.inputJson),
    output: parseJson(row.outputJson),
    error: row.error ?? undefined,
    metadata: parseJson(row.metadataJson)
  };
}

export async function updateRun(
  id: string,
  run: UpdateRun,
  database: Database = defaultDb
) {
  const values: {
    status: UpdateRun["status"];
    endedAt?: string | null;
    outputJson?: string | null;
    error?: string | null;
  } = {
    status: run.status
  };

  if (run.endedAt !== undefined) {
    values.endedAt = run.endedAt;
  } else if (run.status === "running") {
    values.endedAt = null;
  } else {
    values.endedAt = new Date().toISOString();
  }

  if (run.output !== undefined) {
    values.outputJson = stringifyJson(run.output);
  }

  if (run.error !== undefined) {
    values.error = run.error;
  } else if (run.status !== "error") {
    values.error = null;
  }

  await database
    .update(runs)
    .set(values)
    .where(eq(runs.id, id));
}

export async function updateRunMetadata(
  id: string,
  metadata: unknown,
  database: Database = defaultDb
) {
  await database
    .update(runs)
    .set({ metadataJson: stringifyJson(metadata) })
    .where(eq(runs.id, id));
}

export async function createEvent(
  event: CreateTraceEvent,
  database: Database = defaultDb
) {
  await database.insert(events).values({
    id: event.id,
    runId: event.runId,
    parentId: event.parentId,
    type: event.type,
    name: event.name,
    status: event.status,
    timestamp: event.timestamp ?? new Date().toISOString(),
    durationMs: event.durationMs,
    inputJson: stringifyJson(event.input),
    outputJson: stringifyJson(event.output),
    errorJson: stringifyJson(event.error),
    metadataJson: stringifyJson(event.metadata)
  });
}

export async function upsertEvent(
  event: CreateTraceEvent,
  database: Database = defaultDb
) {
  const existing = await database.select().from(events).where(eq(events.id, event.id)).limit(1).get();
  const values = {
    runId: event.runId,
    parentId: event.parentId,
    type: event.type,
    name: event.name,
    status: event.status,
    timestamp: event.timestamp ?? new Date().toISOString(),
    durationMs: event.durationMs,
    inputJson: stringifyJson(event.input),
    outputJson: stringifyJson(event.output),
    errorJson: stringifyJson(event.error),
    metadataJson: stringifyJson(event.metadata)
  };

  if (!existing) {
    await database.insert(events).values({
      id: event.id,
      ...values
    });
    return;
  }

  await database.update(events).set(values).where(eq(events.id, event.id));
}

export async function listRuns(
  options: ListRunsOptions = {},
  database: Database = defaultDb
): Promise<DashboardRun[]> {
  const rows = await database.select().from(runs).orderBy(desc(runs.startedAt));
  const eventRows = await selectEventSummaryRows(database);
  const usageRows = await database.select().from(usageSessions);
  const summaries = summarizeEventsByRun(eventRows);
  const usageBySession = groupUsageBySession(usageRows);

  return rows
    .map((run) => {
      const input = parseJson(run.inputJson);
      const summary = summaries.get(run.id);
      const status = run.status;

      return {
        ...toDashboardRun(run, summary, usageBySession),
        _include:
          options.includeUntracked ||
          shouldIncludeRunInList({
            input,
            summary,
            isStale: isStaleClosedRun(run),
            status
          })
      };
    })
    .filter((run) => run._include)
    .map(({ _include, ...run }) => run);
}

export async function listRunsPage(
  options: ListRunsPageOptions = {},
  database: Database = defaultDb
): Promise<DashboardRunPage> {
  const eventRows = await selectEventSummaryRows(database);
  const usageRows = await database.select().from(usageSessions);
  const summaries = summarizeEventsByRun(eventRows);
  const usageBySession = groupUsageBySession(usageRows);
  const runRows = options.includeUntracked
    ? await selectRunSummaryRows(database)
    : await scanRunSummaryRows(database);
  const visibleRows = runRows.filter((run) => {
    if (options.includeUntracked) return true;

    return shouldIncludeRunInList({
      input: parseJson(run.inputJson),
      summary: summaries.get(run.id),
      isStale: isStaleClosedRun(run),
      status: run.status
    });
  });
  const pageSize = normalizeRunPageSize(options.pageSize);
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const page = Math.min(normalizePage(options.page), totalPages);
  const start = (page - 1) * pageSize;
  const pageIds = visibleRows.slice(start, start + pageSize).map((run) => run.id);
  const pageRows = visibleRows.length === 0
    ? []
    : options.includeUntracked
      ? await database
          .select()
          .from(runs)
          .orderBy(desc(runs.startedAt))
          .limit(pageSize)
          .offset(start)
      : await database
          .select()
          .from(runs)
          .where(inArray(runs.id, pageIds))
          .orderBy(desc(runs.startedAt))
          .limit(pageSize)
          .offset(0);

  return {
    runs: pageRows.map((run) =>
      toDashboardRun(run, summaries.get(run.id), usageBySession)
    ),
    pagination: {
      page,
      pageSize,
      total: visibleRows.length,
      totalPages
    },
    summary: getRunPageSummary(visibleRows)
  };
}

const runSummarySelection = {
  id: runs.id,
  status: runs.status,
  startedAt: runs.startedAt,
  inputJson: runs.inputJson,
  error: runs.error,
  metadataJson: runs.metadataJson
};

function selectRunSummaryRows(database: Database) {
  return database
    .select(runSummarySelection)
    .from(runs)
    .orderBy(desc(runs.startedAt));
}

async function scanRunSummaryRows(database: Database) {
  const rows: Awaited<ReturnType<typeof selectRunSummaryRows>> = [];

  for (let offset = 0; ; offset += runScanChunkSize) {
    const chunk = await database
      .select(runSummarySelection)
      .from(runs)
      .orderBy(desc(runs.startedAt))
      .limit(runScanChunkSize)
      .offset(offset);
    rows.push(...chunk);

    if (chunk.length < runScanChunkSize) return rows;
  }
}

export async function reconcileStaleRuns(database: Database = defaultDb): Promise<number> {
  const runRows = await database
    .select({ id: runs.id, status: runs.status, startedAt: runs.startedAt })
    .from(runs);
  const eventRows = await selectEventSummaryRows(database);
  const summaries = summarizeEventsByRun(eventRows);

  return closeStaleRunningRuns(
    runRows,
    summaries,
    getEventActivitySnapshots(eventRows),
    database
  );
}

type EventActivitySnapshot = { count: number; maxTimestamp: string | null };

function getEventActivitySnapshots(eventRows: EventSummaryRow[]) {
  const snapshots = new Map<string, EventActivitySnapshot>();

  for (const event of eventRows) {
    const snapshot = snapshots.get(event.runId) ?? { count: 0, maxTimestamp: null };
    snapshot.count += 1;
    if (snapshot.maxTimestamp === null || event.timestamp > snapshot.maxTimestamp) {
      snapshot.maxTimestamp = event.timestamp;
    }
    snapshots.set(event.runId, snapshot);
  }

  return snapshots;
}

function selectEventSummaryRows(database: Database) {
  return database
    .select({
      runId: events.runId,
      status: events.status,
      timestamp: events.timestamp,
      name: events.name,
      metadataJson: events.metadataJson
    })
    .from(events);
}

function toDashboardRun(
  run: typeof runs.$inferSelect,
  summary: EventSummary | undefined,
  usageBySession: Map<string, Array<typeof usageSessions.$inferSelect>>
): DashboardRun {
  const input = parseJson(run.inputJson);
  const metadata = parseJson(run.metadataJson);

  return {
    id: run.id,
    name: run.name,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: getRunEndedAt(
      input,
      run.status,
      run.endedAt ?? undefined,
      summary?.lastEventAt
    ),
    input,
    output: parseJson(run.outputJson),
    error: run.status === "error" ? (run.error ?? undefined) : undefined,
    metadata: mergeRunMetadata(metadata, summary, getUsageForRun(metadata, usageBySession))
  };
}

function getRunPageSummary(
  runRows: Array<{ status: string; metadataJson: string | null }>
): DashboardRunPage["summary"] {
  const agents = new Map<string, number>();

  for (const run of runRows) {
    const agent = getString(asRecord(parseJson(run.metadataJson)).agent) ?? "manual";
    agents.set(agent, (agents.get(agent) ?? 0) + 1);
  }

  return {
    totalRuns: runRows.length,
    runningRuns: runRows.filter((run) => run.status === "running").length,
    failedRuns: runRows.filter((run) => run.status === "error").length,
    agents: [...agents.entries()]
      .map(([agent, count]) => ({ agent, count }))
      .sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent))
  };
}

export async function listEventsByRunId(
  runId: string,
  database: Database = defaultDb
): Promise<DashboardTraceEvent[]> {
  const rows = await database
    .select()
    .from(events)
    .where(eq(events.runId, runId))
    .orderBy(asc(events.timestamp));

  return rows.map((event) => ({
    id: event.id,
    runId: event.runId,
    parentId: event.parentId ?? undefined,
    type: event.type,
    name: event.name,
    status: event.status,
    timestamp: normalizeStoredTimestamp(event.timestamp),
    durationMs: event.durationMs ?? undefined,
    input: parseJson(event.inputJson),
    output: parseJson(event.outputJson),
    error: parseJson(event.errorJson),
    metadata: normalizeMetadataForDisplay(parseJson(event.metadataJson))
  }));
}

export async function listEventsPageByRunId(
  runId: string,
  options: ListEventsOptions = {},
  database: Database = defaultDb
): Promise<DashboardEventPage> {
  const scanSelection = {
    id: events.id,
    runId: events.runId,
    parentId: events.parentId,
    type: events.type,
    name: events.name,
    status: events.status,
    timestamp: events.timestamp,
    durationMs: events.durationMs,
    metadataJson: events.metadataJson
  };
  const scanRows: EventScanRow[] = await database
    .select({
      ...scanSelection,
      inputCommand: sql<string | null>`json_extract(${events.inputJson}, '$.command')`,
      errorMessage: sql<string | null>`json_extract(${events.errorJson}, '$.message')`
    })
    .from(events)
    .where(eq(events.runId, runId))
    .orderBy(asc(events.timestamp));
  const allEvents = scanRows.map(toScannedDashboardEvent);
  const visibility = normalizeVisibility(options.visibility);
  const pageSize = normalizePageSize(options.pageSize);
  const page = normalizePage(options.page);
  const hasLiveActions = allEvents.some((event) => {
    const metadata = asRecord(event.metadata);
    return (
      metadata.source !== "transcript" &&
      ["command", "tool", "mcp", "skill"].includes(getString(metadata.category) ?? "")
    );
  });
  const displayEvents = allEvents.filter(
    (event) => isDisplayEvent(event) && (!hasLiveActions || event.metadata?.source !== "transcript")
  );
  const hiddenEvents = allEvents.filter((event) => !displayEvents.includes(event));
  const visibleEvents =
    visibility === "display" ? displayEvents : visibility === "hidden" ? hiddenEvents : allEvents;
  const filteredEvents = applyEventFilters(visibleEvents, options);
  const sortedEvents = sortEventsDesc(filteredEvents);
  const totalPages = Math.max(1, Math.ceil(sortedEvents.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageIds = sortedEvents.slice(start, start + pageSize).map((event) => event.id);
  const matchingIds = new Set(sortedEvents.map((event) => event.id));
  const canUseDirectOffset = canUseDirectEventOffset(
    options,
    visibility,
    scanRows.filter((event) => matchingIds.has(event.id))
  );
  const statusFilter = normalizeFilter(options.status);
  const typeFilter = normalizeFilter(options.type);
  const pageRows = pageIds.length === 0
    ? []
    : canUseDirectOffset
      ? await database
          .select()
          .from(events)
          .where(
            and(
              eq(events.runId, runId),
              statusFilter === "all" ? undefined : eq(events.status, statusFilter),
              typeFilter === "all" ? undefined : eq(events.type, typeFilter)
            )
          )
          .orderBy(desc(events.timestamp))
          .limit(pageSize)
          .offset(start)
      : await database
          .select()
          .from(events)
          .where(and(eq(events.runId, runId), inArray(events.id, pageIds)))
          .orderBy(desc(events.timestamp))
          .limit(pageSize)
          .offset(0);
  const pageEvents = pageRows.map(toDashboardEvent);
  const pageEventById = new Map(pageEvents.map((event) => [event.id, event]));
  const errorEvents = (
    await database
      .select()
      .from(events)
      .where(and(eq(events.runId, runId), eq(events.status, "error")))
      .orderBy(asc(events.timestamp))
  ).map(toDashboardEvent);

  return {
    events: pageIds
      .map((id) => pageEventById.get(id))
      .filter((event): event is DashboardTraceEvent => event !== undefined),
    counts: {
      total: allEvents.length,
      display: displayEvents.length,
      hidden: hiddenEvents.length,
      matching: sortedEvents.length
    },
    facets: {
      types: getUniqueValues(visibleEvents.map((event) => event.type)),
      categories: getUniqueValues(visibleEvents.map(getEventCategory).filter(Boolean))
    },
    pagination: {
      page: safePage,
      pageSize,
      total: sortedEvents.length,
      totalPages
    },
    summary: {
      totalTokens: allEvents.reduce(
        (sum, event) => sum + getNumber(asRecord(asRecord(event.metadata).tokenUsage).total),
        0
      ),
      totalDurationMs: allEvents.reduce((sum, event) => sum + (event.durationMs ?? 0), 0),
      failedEvents: allEvents.filter((event) => event.status === "error").length,
      sourceMetadata: getSourceMetadata(allEvents),
      errorEvents,
      insights: analyzeTraceInsights(allEvents)
    },
    visibility
  };
}

function toDashboardEvent(event: typeof events.$inferSelect): DashboardTraceEvent {
  return {
    id: event.id,
    runId: event.runId,
    parentId: event.parentId ?? undefined,
    type: event.type,
    name: event.name,
    status: event.status,
    timestamp: normalizeStoredTimestamp(event.timestamp),
    durationMs: event.durationMs ?? undefined,
    input: parseJson(event.inputJson),
    output: parseJson(event.outputJson),
    error: parseJson(event.errorJson),
    metadata: normalizeMetadataForDisplay(parseJson(event.metadataJson))
  };
}

function toScannedDashboardEvent(event: EventScanRow): DashboardTraceEvent {
  return {
    id: event.id,
    runId: event.runId,
    parentId: event.parentId ?? undefined,
    type: event.type,
    name: event.name,
    status: event.status,
    timestamp: normalizeStoredTimestamp(event.timestamp),
    durationMs: event.durationMs ?? undefined,
    input: event.inputCommand ? { command: event.inputCommand } : undefined,
    error: event.errorMessage ? { message: event.errorMessage } : undefined,
    metadata: normalizeMetadataForDisplay(parseJson(event.metadataJson))
  };
}

function canUseDirectEventOffset(
  options: ListEventsOptions,
  visibility: DashboardEventVisibility,
  eventRows: EventScanRow[]
) {
  if (
    visibility !== "all" ||
    options.q?.trim() ||
    normalizeFilter(options.category) !== "all"
  ) {
    return false;
  }

  const timestamps = eventRows.map((event) => event.timestamp);
  return (
    new Set(timestamps).size === timestamps.length &&
    timestamps.every((timestamp) => {
      const timestampMs = parseStoredTimestampMs(timestamp);
      return Number.isFinite(timestampMs) && normalizeStoredTimestamp(timestamp) === timestamp;
    })
  );
}

export async function deleteRun(id: string, database: Database = defaultDb): Promise<boolean> {
  // Foreign keys cascade events, but delete them explicitly so the result is
  // correct even if the connection has foreign_keys disabled.
  await database.delete(events).where(eq(events.runId, id));
  const result = await database.delete(runs).where(eq(runs.id, id));

  return result.changes > 0;
}

export async function deleteRuns(ids: string[], database: Database = defaultDb): Promise<number> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];

  if (uniqueIds.length === 0) {
    return 0;
  }

  await database.delete(events).where(inArray(events.runId, uniqueIds));
  const result = await database.delete(runs).where(inArray(runs.id, uniqueIds));

  return result.changes;
}

function mergeRunMetadata(
  metadata: unknown,
  summary: EventSummary | undefined,
  usageRows: Array<typeof usageSessions.$inferSelect> = []
): DashboardRunMetadata | undefined {
  const base = normalizeMetadataForDisplay(metadata);

  if (usageRows.length > 0) {
    return {
      ...base,
      summary: mergeUsageIntoSummary(summary, usageRows)
    };
  }

  if (summary === undefined) {
    return Object.keys(base).length === 0 ? undefined : base;
  }

  return {
    ...base,
    summary: toPublicSummary(summary)
  };
}

export function replaceTranscriptSnapshot(
  traces: TranscriptTrace[],
  reconciledClients: string[],
  currentSessionKeys: string[],
  database: Database = defaultDb
) {
  return database.transaction((transaction) => {
    const currentKeys = new Set(currentSessionKeys);

    for (const trace of traces) {
      const existingRun = transaction.select().from(runs).where(eq(runs.id, trace.run.id)).limit(1).get();
      const runValues = {
        id: trace.run.id,
        name: trace.run.name,
        status: trace.run.status,
        startedAt: trace.run.startedAt ?? new Date().toISOString(),
        endedAt: trace.run.endedAt,
        inputJson: stringifyJson(trace.run.input),
        outputJson: stringifyJson(trace.run.output),
        error: trace.run.error,
        metadataJson: stringifyJson(trace.run.metadata)
      };

      if (!existingRun) {
        transaction.insert(runs).values(runValues).run();
      } else if (getJsonSource(existingRun.inputJson) === "transcript-scan") {
        transaction
          .update(runs)
          .set({
            name: runValues.name,
            status: runValues.status,
            startedAt: runValues.startedAt,
            endedAt: runValues.endedAt,
            metadataJson: runValues.metadataJson
          })
          .where(eq(runs.id, trace.run.id))
          .run();
      }

      const currentEventIds = new Set(trace.events.map((event) => event.id));
      const priorTranscriptEvents = transaction
        .select({ id: events.id, metadataJson: events.metadataJson })
        .from(events)
        .where(eq(events.runId, trace.run.id))
        .all()
        .filter((event) => getJsonSource(event.metadataJson) === "transcript");

      for (const event of priorTranscriptEvents) {
        if (!currentEventIds.has(event.id)) transaction.delete(events).where(eq(events.id, event.id)).run();
      }

      for (const event of trace.events) {
        const values = {
          runId: event.runId,
          parentId: event.parentId,
          type: event.type,
          name: event.name,
          status: event.status,
          timestamp: event.timestamp ?? new Date().toISOString(),
          durationMs: event.durationMs,
          inputJson: stringifyJson(event.input),
          outputJson: stringifyJson(event.output),
          errorJson: stringifyJson(event.error),
          metadataJson: stringifyJson(event.metadata)
        };
        transaction
          .insert(events)
          .values({ id: event.id, ...values })
          .onConflictDoUpdate({ target: events.id, set: values })
          .run();
      }
    }

    if (reconciledClients.length === 0) return;

    const staleRunIds = new Set<string>();
    const transcriptEvents = transaction
      .select({ id: events.id, runId: events.runId, metadataJson: events.metadataJson })
      .from(events)
      .all();

    for (const event of transcriptEvents) {
      const metadata = asRecord(parseJson(event.metadataJson));
      const client = getString(metadata.transcriptClient);
      const sessionId = getString(metadata.sessionId);
      if (
        metadata.source !== "transcript" ||
        !client ||
        !sessionId ||
        !reconciledClients.includes(client) ||
        currentKeys.has(`${client}:${sessionId}`)
      ) continue;

      staleRunIds.add(event.runId);
      transaction.delete(events).where(eq(events.id, event.id)).run();
    }

    for (const runId of staleRunIds) {
      const run = transaction.select().from(runs).where(eq(runs.id, runId)).limit(1).get();
      const remaining = transaction.select({ id: events.id }).from(events).where(eq(events.runId, runId)).limit(1).get();
      if (run && getJsonSource(run.inputJson) === "transcript-scan" && !remaining) {
        transaction.delete(runs).where(eq(runs.id, runId)).run();
      }
    }
  });
}

function groupUsageBySession(rows: Array<typeof usageSessions.$inferSelect>) {
  const grouped = new Map<string, Array<typeof usageSessions.$inferSelect>>();

  for (const row of rows) {
    const key = `${row.client}\0${row.sessionId}`;
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }

  return grouped;
}

function getUsageForRun(
  metadata: unknown,
  grouped: Map<string, Array<typeof usageSessions.$inferSelect>>
) {
  const value = asRecord(metadata);
  const agent = getString(value.agent);
  const sessionId = getString(value.sessionId);

  if (!agent || !sessionId) return [];

  const client = agent === "claude-code"
    ? "claude"
    : agent === "github-copilot"
      ? "copilot"
      : agent;

  return grouped.get(`${client}\0${sessionId}`) ?? [];
}

function mergeUsageIntoSummary(
  summary: EventSummary | undefined,
  rows: Array<typeof usageSessions.$inferSelect>
): DashboardRunSummary {
  const base = summary ?? {
    commandCount: 0,
    toolCount: 0,
    mcpCount: 0,
    skillCount: 0,
    promptCount: 0,
    turnCount: 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
    costUsd: 0,
    unmodeledTokenUsage: { input: 0, output: 0, total: 0 },
    models: [],
    modelUsage: [],
    commands: [],
    tools: [],
    mcpTools: [],
    skills: [],
    hasErrorEvent: false
  } satisfies EventSummary;
  const tokenUsage: TokenUsage = {
    input: rows.reduce((sum, row) => sum + row.inputTokens, 0),
    output: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    total: rows.reduce((sum, row) => sum + row.totalTokens, 0),
    cachedInput: rows.reduce((sum, row) => sum + row.cacheReadTokens, 0),
    cacheReadInput: rows.reduce((sum, row) => sum + row.cacheReadTokens, 0),
    cacheCreationInput: rows.reduce((sum, row) => sum + row.cacheWriteTokens, 0),
    reasoningOutput: rows.reduce((sum, row) => sum + row.reasoningTokens, 0),
    source: "tokscale",
    sourceKind: "scan",
    scope: "session",
    method: "tokscale"
  };
  const modelUsage = rows
    .filter((row) => row.model)
    .map((row) => ({
      model: row.model,
      provider: row.provider || undefined,
      tokenUsage: {
        input: row.inputTokens,
        output: row.outputTokens,
        total: row.totalTokens,
        cachedInput: row.cacheReadTokens,
        cacheReadInput: row.cacheReadTokens,
        cacheCreationInput: row.cacheWriteTokens,
        reasoningOutput: row.reasoningTokens,
        source: "tokscale",
        sourceKind: "scan" as const,
        scope: "session" as const,
        method: "tokscale"
      },
      costUsd: row.costUsd ?? undefined
    }));

  return {
    ...toPublicSummary(base),
    tokenUsage,
    costUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    models: [...new Set(modelUsage.map((item) => item.model))],
    modelUsage
  };
}

function normalizeMetadataForDisplay(metadata: unknown): DashboardTraceMetadata {
  const base = { ...asRecord(metadata) };

  if (
    base.agent === "codex" &&
    base.source === "otel" &&
    (base.surface === undefined ||
      (base.surface === "unknown" && base.surfaceSource === "legacy-unmarked"))
  ) {
    base.surface = "desktop";
    base.surfaceSource = "default-v1-logs";
  } else if (
    base.agent === "codex" &&
    typeof base.surface === "string" &&
    base.surfaceSource === undefined
  ) {
    base.surface = "unknown";
    base.surfaceSource = "legacy-unmarked";
  }

  return base as DashboardTraceMetadata;
}

function summarizeEventsByRun(eventRows: EventSummaryRow[]) {
  const summaries = new Map<string, EventSummary>();
  const runIdsWithSessionScan = getRunIdsWithSessionScan(eventRows);
  const runIdsWithLiveActions = getRunIdsWithLiveActions(eventRows);

  for (const row of eventRows) {
    const metadata = asRecord(parseJson(row.metadataJson));
    if (runIdsWithLiveActions.has(row.runId) && metadata.source === "transcript") continue;
    const summary = summaries.get(row.runId) ?? {
      commandCount: 0,
      toolCount: 0,
      mcpCount: 0,
      skillCount: 0,
      promptCount: 0,
      turnCount: 0,
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0
      },
      costUsd: 0,
      unmodeledTokenUsage: {
        input: 0,
        output: 0,
        total: 0
      },
      models: [],
      modelUsage: [],
      commands: [],
      tools: [],
      mcpTools: [],
      skills: [],
      hasErrorEvent: false,
      lastEventAt: undefined
    };

    summary.hasErrorEvent = summary.hasErrorEvent || row.status === "error";
    summary.lastEventAt = getLatestDateString(summary.lastEventAt, row.timestamp);

    const command = getString(metadata.command);
    const toolName = getString(metadata.toolName);
    const toolKind = getString(metadata.toolKind);
    const category = getString(metadata.category);
    const mcpServer = getString(metadata.mcpServer);
    const mcpTool = getString(metadata.mcpTool);
    const skillName = getString(metadata.skillName);
    const hookEvent = getString(metadata.hookEvent);
    const model = getString(metadata.model);
    const provider = getString(metadata.provider);
    const tokenUsage = asRecord(metadata.tokenUsage);
    const hasSessionScan = runIdsWithSessionScan.has(row.runId);
    const isSessionScan = isScanSessionUsage(tokenUsage);
    const shouldAddTokenUsage = !hasSessionScan || isSessionScan;
    const costUsd = shouldAddTokenUsage ? getNumber(metadata.costUsd) : 0;

    if (category === "command" || command !== undefined || toolKind === "command") {
      summary.commandCount += 1;
      pushUnique(summary.commands, command ?? toolName ?? row.name);
    } else if (
      category === "mcp" ||
      (mcpServer !== undefined && mcpTool !== undefined) ||
      toolKind === "mcp"
    ) {
      summary.mcpCount += 1;
      pushUnique(summary.mcpTools, formatMcpTool(mcpServer, mcpTool, toolName, row.name));
    } else if (category === "skill" || skillName !== undefined) {
      summary.skillCount += 1;
      pushUnique(summary.skills, skillName ?? toolName ?? row.name);
    } else if (isPromptEvent(hookEvent, row.name)) {
      summary.promptCount += 1;
    } else if (isTurnEvent(hookEvent, row.name)) {
      summary.turnCount += 1;
    } else if (category === "tool" || toolName !== undefined) {
      summary.toolCount += 1;
      pushUnique(summary.tools, toolName ?? row.name);
    }

    if (shouldAddTokenUsage) {
      addTokenUsage(summary.tokenUsage, tokenUsage);
      summary.costUsd = (summary.costUsd ?? 0) + costUsd;
    }

    if (model !== undefined && shouldAddTokenUsage) {
      pushUnique(summary.models, model);
      addModelUsage(summary.modelUsage, model, provider, tokenUsage, costUsd);
    } else if (shouldAddTokenUsage) {
      addTokenUsage(summary.unmodeledTokenUsage, tokenUsage);
    }
    summaries.set(row.runId, summary);
  }

  for (const summary of summaries.values()) {
    attachUnmodeledTokenUsageToSingleModel(summary);
  }

  return summaries;
}

function getRunIdsWithLiveActions(eventRows: EventSummaryRow[]) {
  const runIds = new Set<string>();

  for (const row of eventRows) {
    const metadata = asRecord(parseJson(row.metadataJson));
    if (
      metadata.source !== "transcript" &&
      ["command", "tool", "mcp", "skill"].includes(getString(metadata.category) ?? "")
    ) {
      runIds.add(row.runId);
    }
  }

  return runIds;
}

async function closeStaleRunningRuns(
  runRows: Array<{ id: string; status: string; startedAt: string }>,
  summaries: Map<string, EventSummary>,
  activitySnapshots: Map<string, EventActivitySnapshot>,
  database: Database
) {
  let reconciledRuns = 0;
  const staleMs = getStaleRunMs();
  const now = Date.now();
  const error = `No completion hook received after ${Math.round(staleMs / 60_000)} minutes of inactivity.`;

  for (const run of runRows) {
    if (run.status !== "running") {
      continue;
    }

    const lastActivityAt = summaries.get(run.id)?.lastEventAt ?? run.startedAt;
    const lastActivityMs = new Date(lastActivityAt).getTime();

    if (!Number.isFinite(lastActivityMs) || now - lastActivityMs < staleMs) {
      continue;
    }

    const endedAt = lastActivityAt;
    const activitySnapshot = activitySnapshots.get(run.id) ?? {
      count: 0,
      maxTimestamp: null
    };
    const result = await database
      .update(runs)
      .set({ status: "error", endedAt, error })
      .where(
        and(
          eq(runs.id, run.id),
          eq(runs.status, "running"),
          sql`(SELECT count(*) FROM ${events} WHERE ${events.runId} = ${run.id}) = ${activitySnapshot.count}`,
          sql`coalesce((SELECT max(${events.timestamp}) FROM ${events} WHERE ${events.runId} = ${run.id}), ${noEventTimestampSentinel}) = ${activitySnapshot.maxTimestamp ?? noEventTimestampSentinel}`
        )
      );
    if (result.changes === 1) reconciledRuns += 1;
  }

  return reconciledRuns;
}

function shouldIncludeRunInList({
  input,
  isStale,
  summary,
  status
}: {
  input: unknown;
  isStale: boolean;
  summary: EventSummary | undefined;
  status: string;
}) {
  const collectorSource = getCollectorSource(input);

  if (!collectorSource) {
    return true;
  }

  if (!summary) {
    return !isStale && status === "error";
  }

  const visibleTotal = getSummaryDefaultVisibleTotal(summary, collectorSource);

  if (isStale && visibleTotal === 0) {
    return false;
  }

  return visibleTotal > 0 || summary.hasErrorEvent;
}

function getRunIdsWithSessionScan(eventRows: EventSummaryRow[]) {
  const runIds = new Set<string>();

  for (const row of eventRows) {
    const tokenUsage = asRecord(asRecord(parseJson(row.metadataJson)).tokenUsage);

    if (isScanSessionUsage(tokenUsage)) {
      runIds.add(row.runId);
    }
  }

  return runIds;
}

function isScanSessionUsage(tokenUsage: Record<string, unknown>) {
  return tokenUsage.sourceKind === "scan" && tokenUsage.scope === "session";
}

function isStaleClosedRun(run: { status: string; error: string | null }) {
  return (
    run.status === "error" &&
    typeof run.error === "string" &&
    run.error.startsWith("No completion hook received after ")
  );
}

function getCollectorSource(input: unknown) {
  const source = getString(asRecord(input).source);

  return source === "agent-hook" || source === "codex-otel" ? source : undefined;
}

function getRunEndedAt(
  input: unknown,
  status: string,
  storedEndedAt: string | undefined,
  lastEventAt: string | undefined
) {
  if (status === "running" || !storedEndedAt || !lastEventAt) {
    return storedEndedAt;
  }

  const source = getString(asRecord(input).source);
  return source === "codex-otel" || source === "transcript-scan"
    ? lastEventAt
    : storedEndedAt;
}

function getSummaryActionTotal(summary: EventSummary) {
  return (
    summary.commandCount +
    summary.toolCount +
    summary.mcpCount +
    summary.skillCount
  );
}

function getSummaryDefaultVisibleTotal(
  summary: EventSummary,
  collectorSource: "agent-hook" | "codex-otel"
) {
  if (collectorSource === "codex-otel") {
    return getSummaryActionTotal(summary);
  }

  return (
    getSummaryActionTotal(summary) +
    summary.promptCount +
    summary.turnCount +
    summary.tokenUsage.total
  );
}

function isPromptEvent(hookEvent: string | undefined, name: string) {
  return hookEvent === "UserPromptSubmit" || hookEvent === "codex.user_prompt" || name === "user_prompt";
}

function isTurnEvent(hookEvent: string | undefined, name: string) {
  return (
    hookEvent === "Stop" ||
    hookEvent === "SessionEnd" ||
    hookEvent?.includes("turn.completed") === true ||
    name === "turn"
  );
}

function formatMcpTool(
  mcpServer: string | undefined,
  mcpTool: string | undefined,
  toolName: string | undefined,
  fallback: string
) {
  return mcpServer !== undefined && mcpTool !== undefined
    ? `${mcpServer}.${mcpTool}`
    : (toolName ?? fallback);
}

function toPublicSummary(summary: EventSummary): DashboardRunSummary {
  const { hasErrorEvent, lastEventAt, unmodeledTokenUsage, ...publicSummary } = summary;

  return {
    ...publicSummary,
    modelUsage: publicSummary.modelUsage.filter((item) => item.tokenUsage.total > 0)
  };
}

function getStaleRunMs() {
  const raw =
    process.env.AGENT_TRACE_RUNNING_STALE_MINUTES ??
    process.env.AGENT_TRACE_STALE_RUN_MINUTES ??
    process.env.TOOLTRACE_RUNNING_STALE_MINUTES ??
    process.env.TOOLTRACE_STALE_RUN_MINUTES;
  const minutes = raw ? Number(raw) : defaultStaleRunMinutes;

  return Number.isFinite(minutes) && minutes > 0
    ? minutes * 60_000
    : defaultStaleRunMinutes * 60_000;
}

function getLatestDateString(current: string | undefined, next: string) {
  if (!current) {
    return next;
  }

  return getDateMs(next) > getDateMs(current) ? next : current;
}

function getDateMs(value: string) {
  const ms = parseStoredTimestampMs(value);

  return Number.isFinite(ms) ? ms : 0;
}

function normalizeStoredTimestamp(value: string) {
  const ms = parseStoredTimestampMs(value);

  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

function parseStoredTimestampMs(value: string) {
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    return parseNumericTimestampMs(trimmed);
  }

  const ms = new Date(trimmed).getTime();

  return isReasonableTimestampMs(ms) ? ms : Number.NaN;
}

function parseNumericTimestampMs(value: string) {
  const digits = BigInt(value);

  if (digits <= 0n) {
    return Number.NaN;
  }

  if (digits >= 100_000_000_000_000_000n) {
    return Number(digits / 1_000_000n);
  }

  if (digits >= 100_000_000_000_000n) {
    return Number(digits / 1_000n);
  }

  if (digits >= 100_000_000_000n) {
    return Number(digits);
  }

  if (digits >= 1_000_000_000n) {
    return Number(digits * 1_000n);
  }

  return Number.NaN;
}

function isReasonableTimestampMs(value: number) {
  return Number.isFinite(value) && value >= 946_684_800_000;
}

function addTokenUsage(target: TokenUsage, source: Record<string, unknown>) {
  target.input += getNumber(source.input);
  target.output += getNumber(source.output);
  target.total += getNumber(source.total);
  target.cachedInput = addOptional(target.cachedInput, source.cachedInput);
  target.cacheCreationInput = addOptional(target.cacheCreationInput, source.cacheCreationInput);
  target.cacheReadInput = addOptional(target.cacheReadInput, source.cacheReadInput);
  target.reasoningOutput = addOptional(target.reasoningOutput, source.reasoningOutput);

  if (source.estimated === true) {
    target.estimated = true;
  }

  if (source.sourceKind === "scan" || source.sourceKind === "official" || source.sourceKind === "estimate") {
    target.sourceKind = source.sourceKind;
  }

  if (source.scope === "session" || source.scope === "event") {
    target.scope = source.scope;
  }
}

function addModelUsage(
  modelUsage: DashboardModelUsage[],
  model: string,
  provider: string | undefined,
  source: Record<string, unknown>,
  costUsd = 0
) {
  if (getNumber(source.total) === 0) {
    return;
  }

  let entry = modelUsage.find((item) => item.model === model);

  if (!entry) {
    entry = {
      model,
      provider,
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0
      }
    };
    modelUsage.push(entry);
  } else if (!entry.provider && provider) {
    entry.provider = provider;
  }

  addTokenUsage(entry.tokenUsage, source);
  entry.costUsd = addOptional(entry.costUsd, costUsd);
}

function attachUnmodeledTokenUsageToSingleModel(summary: EventSummary) {
  if (summary.unmodeledTokenUsage.total === 0 || summary.models.length !== 1) {
    return;
  }

  const model = summary.models[0];
  if (model === undefined) {
    return;
  }

  const provider = summary.modelUsage.find((item) => item.model === model)?.provider;

  addModelUsage(summary.modelUsage, model, provider, summary.unmodeledTokenUsage);
}

function applyEventFilters(events: DashboardTraceEvent[], filters: DashboardEventFilters) {
  const query = filters.q?.trim().toLowerCase() ?? "";
  const status = normalizeFilter(filters.status);
  const type = normalizeFilter(filters.type);
  const category = normalizeFilter(filters.category);

  return events.filter((event) => {
    if (status !== "all" && event.status !== status) {
      return false;
    }

    if (type !== "all" && event.type !== type) {
      return false;
    }

    if (category !== "all" && getEventCategory(event) !== category) {
      return false;
    }

    if (!query) {
      return true;
    }

    return getEventSearchText(event).toLowerCase().includes(query);
  });
}

function getEventSearchText(event: DashboardTraceEvent) {
  const metadata = asRecord(event.metadata);

  return [
    event.id,
    event.parentId,
    event.type,
    event.name,
    event.status,
    asRecord(event.error).message,
    metadata.agent,
    metadata.hookEvent,
    metadata.command,
    metadata.toolName,
    metadata.toolKind,
    metadata.mcpServer,
    metadata.mcpTool,
    metadata.skillName,
    metadata.model,
    getObjectString(event.input, "command")
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

function isDisplayEvent(event: DashboardTraceEvent) {
  const category = getEventCategory(event);

  return (
    category === "command" ||
    category === "tool" ||
    category === "mcp" ||
    category === "skill" ||
    category === "tokens" ||
    asRecord(event.metadata).tokenUsage !== undefined
  );
}

function getEventCategory(event: DashboardTraceEvent) {
  const metadata = asRecord(event.metadata);
  const category = getString(metadata.category);

  if (category === "tool" && metadata.toolKind === "command") {
    return "command";
  }

  if (category !== undefined) {
    return category;
  }

  if (metadata.command !== undefined || getObjectString(event.input, "command") !== undefined) {
    return "command";
  }

  if (metadata.toolKind === "command") {
    return "command";
  }

  if (metadata.mcpServer !== undefined && metadata.mcpTool !== undefined) {
    return "mcp";
  }

  if (metadata.toolKind === "mcp") {
    return "mcp";
  }

  if (metadata.skillName !== undefined) {
    return "skill";
  }

  if (metadata.toolName !== undefined) {
    return "tool";
  }

  return metadata.tokenUsage ? "tokens" : undefined;
}

function normalizeVisibility(
  value: DashboardEventVisibility | undefined
): DashboardEventVisibility {
  return value === "hidden" || value === "all" ? value : "display";
}

function normalizeFilter(value: string | undefined) {
  return value && value.length > 0 ? value : "all";
}

function normalizePage(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined
    ? Math.max(1, Math.floor(value))
    : 1;
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isFinite(value) || value === undefined) {
    return defaultEventPageSize;
  }

  return Math.min(Math.max(1, Math.floor(value)), maxEventPageSize);
}

function normalizeRunPageSize(value: number | undefined) {
  if (!Number.isFinite(value) || value === undefined) {
    return defaultRunPageSize;
  }

  return Math.min(Math.max(1, Math.floor(value)), maxRunPageSize);
}

function sortEventsDesc(events: DashboardTraceEvent[]) {
  return [...events].sort((a, b) => getDateMs(b.timestamp) - getDateMs(a.timestamp));
}

function getObjectString(value: unknown, key: string) {
  const item = asRecord(value)[key];

  return typeof item === "string" && item.length > 0 ? item : undefined;
}

function getSourceMetadata(events: DashboardTraceEvent[]) {
  return events.find((event) => asRecord(event.metadata).agent !== undefined)?.metadata ?? {};
}

function getUniqueValues(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function addOptional(current: number | undefined, value: unknown) {
  const numeric = getNumber(value);

  if (numeric === 0) {
    return current;
  }

  return (current ?? 0) + numeric;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pushUnique(values: string[], value: string) {
  if (values.includes(value)) {
    return;
  }

  if (values.length < 5) {
    values.push(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
