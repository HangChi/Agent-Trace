import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asc, desc, eq, inArray } from "drizzle-orm";

import type { CreateRun, CreateTraceEvent, Run, UpdateRun } from "@tooltrace/schema";

import { createSqliteDatabase, db as defaultDb } from "./db.js";
import { events, runs } from "./schema.js";

type Database = BetterSQLite3Database;

type ListRunsOptions = {
  includeUntracked?: boolean;
};

type TokenUsageSummary = {
  input: number;
  output: number;
  total: number;
  cachedInput?: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
  reasoningOutput?: number;
  estimated?: boolean;
};

type ModelUsageSummary = {
  model: string;
  provider?: string;
  tokenUsage: TokenUsageSummary;
};

type EventSummary = {
  commandCount: number;
  toolCount: number;
  mcpCount: number;
  skillCount: number;
  promptCount: number;
  turnCount: number;
  tokenUsage: TokenUsageSummary;
  unmodeledTokenUsage: TokenUsageSummary;
  models: string[];
  modelUsage: ModelUsageSummary[];
  commands: string[];
  tools: string[];
  mcpTools: string[];
  skills: string[];
  hasErrorEvent: boolean;
  lastEventAt?: string;
};

type EventVisibility = "display" | "hidden" | "all";

type EventFilters = {
  q?: string;
  status?: string;
  type?: string;
  category?: string;
};

type ListEventsOptions = EventFilters & {
  visibility?: EventVisibility;
  page?: number;
  pageSize?: number;
};

type PublicTraceEvent = Awaited<ReturnType<typeof listEventsByRunId>>[number];

const defaultStaleRunMinutes = 30;
const defaultEventPageSize = 100;
const maxEventPageSize = 500;

function stringifyJson(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson(value: string | null) {
  return value === null ? undefined : JSON.parse(value);
}

export function initializeDatabase(path?: string) {
  const sqlite = createSqliteDatabase(path);

  sqlite.exec(`
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
    CREATE INDEX IF NOT EXISTS runs_started_at_idx ON runs(started_at);
  `);

  ensureColumn(sqlite, "runs", "metadata_json", "TEXT");

  sqlite.close();
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

export async function listRuns(
  options: ListRunsOptions = {},
  database: Database = defaultDb
) {
  const rows = await database.select().from(runs).orderBy(desc(runs.startedAt));
  const eventRows = await database.select().from(events);
  const summaries = summarizeEventsByRun(eventRows);
  const staleRuns = await closeStaleRunningRuns(rows, summaries, database);

  return rows
    .map((run) => {
      const input = parseJson(run.inputJson);
      const metadata = parseJson(run.metadataJson);
      const summary = summaries.get(run.id);
      const staleRun = staleRuns.get(run.id);
      const isStale = staleRun !== undefined || isStaleClosedRun(run);

      const status = staleRun?.status ?? run.status;

      return {
        id: run.id,
        name: run.name,
        status,
        startedAt: run.startedAt,
        endedAt: staleRun?.endedAt ?? run.endedAt ?? undefined,
        input,
        output: parseJson(run.outputJson),
        error: status === "error" ? (staleRun?.error ?? run.error ?? undefined) : undefined,
        metadata: mergeRunMetadata(metadata, summary),
        _include:
          options.includeUntracked ||
          shouldIncludeRunInList({
            input,
            summary,
            isStale,
            status
          })
      };
    })
    .filter((run) => run._include)
    .map(({ _include, ...run }) => run);
}

export async function listEventsByRunId(
  runId: string,
  database: Database = defaultDb
) {
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
) {
  const allEvents = await listEventsByRunId(runId, database);
  const visibility = normalizeVisibility(options.visibility);
  const pageSize = normalizePageSize(options.pageSize);
  const page = normalizePage(options.page);
  const displayEvents = allEvents.filter(isDisplayEvent);
  const hiddenEvents = allEvents.filter((event) => !isDisplayEvent(event));
  const visibleEvents =
    visibility === "display" ? displayEvents : visibility === "hidden" ? hiddenEvents : allEvents;
  const filteredEvents = applyEventFilters(visibleEvents, options);
  const sortedEvents = sortEventsDesc(filteredEvents);
  const totalPages = Math.max(1, Math.ceil(sortedEvents.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    events: sortedEvents.slice(start, start + pageSize),
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
      errorEvents: allEvents.filter((event) => event.status === "error")
    },
    visibility
  };
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

function ensureColumn(
  sqlite: ReturnType<typeof createSqliteDatabase>,
  tableName: string,
  columnName: string,
  definition: string
) {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;

  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function mergeRunMetadata(metadata: unknown, summary: EventSummary | undefined) {
  const base = normalizeMetadataForDisplay(metadata);

  if (summary === undefined) {
    return Object.keys(base).length === 0 ? undefined : base;
  }

  return {
    ...base,
    summary: toPublicSummary(summary)
  };
}

function normalizeMetadataForDisplay(metadata: unknown) {
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

  return base;
}

function summarizeEventsByRun(eventRows: Array<typeof events.$inferSelect>) {
  const summaries = new Map<string, EventSummary>();

  for (const row of eventRows) {
    const metadata = asRecord(parseJson(row.metadataJson));
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

    addTokenUsage(summary.tokenUsage, tokenUsage);
    if (model !== undefined) {
      pushUnique(summary.models, model);
      addModelUsage(summary.modelUsage, model, provider, tokenUsage);
    } else {
      addTokenUsage(summary.unmodeledTokenUsage, tokenUsage);
    }
    summaries.set(row.runId, summary);
  }

  for (const summary of summaries.values()) {
    attachUnmodeledTokenUsageToSingleModel(summary);
  }

  return summaries;
}

async function closeStaleRunningRuns(
  runRows: Array<typeof runs.$inferSelect>,
  summaries: Map<string, EventSummary>,
  database: Database
) {
  const staleRuns = new Map<string, { status: "error"; endedAt: string; error: string }>();
  const staleMs = getStaleRunMs();
  const now = Date.now();
  const endedAt = new Date(now).toISOString();
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

    staleRuns.set(run.id, { status: "error", endedAt, error });

    await database
      .update(runs)
      .set({ status: "error", endedAt, error })
      .where(eq(runs.id, run.id));
  }

  return staleRuns;
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
  if (!isCollectorRun(input)) {
    return true;
  }

  if (isStale && (!summary || getSummaryActionTotal(summary) === 0)) {
    return false;
  }

  if (!summary) {
    return status === "error";
  }

  return getSummaryActionTotal(summary) > 0 || summary.hasErrorEvent;
}

function isStaleClosedRun(run: typeof runs.$inferSelect) {
  return (
    run.status === "error" &&
    typeof run.error === "string" &&
    run.error.startsWith("No completion hook received after ")
  );
}

function isCollectorRun(input: unknown) {
  const source = getString(asRecord(input).source);

  return source === "agent-hook" || source === "codex-otel";
}

function getSummaryActionTotal(summary: EventSummary) {
  return (
    summary.commandCount +
    summary.toolCount +
    summary.mcpCount +
    summary.skillCount
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

function toPublicSummary(summary: EventSummary) {
  const { hasErrorEvent, lastEventAt, unmodeledTokenUsage, ...publicSummary } = summary;

  return {
    ...publicSummary,
    modelUsage: publicSummary.modelUsage.filter((item) => item.tokenUsage.total > 0)
  };
}

function getStaleRunMs() {
  const raw =
    process.env.TOOLTRACE_RUNNING_STALE_MINUTES ?? process.env.TOOLTRACE_STALE_RUN_MINUTES;
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

function addTokenUsage(target: TokenUsageSummary, source: Record<string, unknown>) {
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
}

function addModelUsage(
  modelUsage: ModelUsageSummary[],
  model: string,
  provider: string | undefined,
  source: Record<string, unknown>
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

function applyEventFilters(events: PublicTraceEvent[], filters: EventFilters) {
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

function getEventSearchText(event: PublicTraceEvent) {
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

function isDisplayEvent(event: PublicTraceEvent) {
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

function getEventCategory(event: PublicTraceEvent) {
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

function normalizeVisibility(value: EventVisibility | undefined): EventVisibility {
  return value === "hidden" || value === "all" ? value : "display";
}

function normalizeFilter(value: string | undefined) {
  return value && value.length > 0 ? value : "all";
}

function normalizePage(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : 1;
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return defaultEventPageSize;
  }

  return Math.min(Math.floor(value), maxEventPageSize);
}

function sortEventsDesc(events: PublicTraceEvent[]) {
  return [...events].sort((a, b) => getDateMs(b.timestamp) - getDateMs(a.timestamp));
}

function getObjectString(value: unknown, key: string) {
  const item = asRecord(value)[key];

  return typeof item === "string" && item.length > 0 ? item : undefined;
}

function getSourceMetadata(events: PublicTraceEvent[]) {
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
