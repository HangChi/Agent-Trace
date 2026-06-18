import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asc, desc, eq } from "drizzle-orm";

import type { CreateRun, CreateTraceEvent, Run, UpdateRun } from "@tooltrace/schema";

import { createSqliteDatabase, db as defaultDb } from "./db.js";
import { events, runs } from "./schema.js";

type Database = BetterSQLite3Database;

type ListRunsOptions = {
  includeUntracked?: boolean;
};

type EventSummary = {
  commandCount: number;
  toolCount: number;
  mcpCount: number;
  skillCount: number;
  promptCount: number;
  turnCount: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
    cachedInput?: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
    reasoningOutput?: number;
    estimated?: boolean;
  };
  commands: string[];
  tools: string[];
  mcpTools: string[];
  skills: string[];
  hasErrorEvent: boolean;
  lastEventAt?: string;
};

const defaultStaleRunMinutes = 30;

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
    timestamp: event.timestamp,
    durationMs: event.durationMs ?? undefined,
    input: parseJson(event.inputJson),
    output: parseJson(event.outputJson),
    error: parseJson(event.errorJson),
    metadata: normalizeMetadataForDisplay(parseJson(event.metadataJson))
  }));
}

export async function deleteRun(id: string, database: Database = defaultDb): Promise<boolean> {
  // Foreign keys cascade events, but delete them explicitly so the result is
  // correct even if the connection has foreign_keys disabled.
  await database.delete(events).where(eq(events.runId, id));
  const result = await database.delete(runs).where(eq(runs.id, id));

  return result.changes > 0;
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
    const mcpServer = getString(metadata.mcpServer);
    const mcpTool = getString(metadata.mcpTool);
    const skillName = getString(metadata.skillName);
    const hookEvent = getString(metadata.hookEvent);
    const tokenUsage = asRecord(metadata.tokenUsage);

    if (command !== undefined) {
      summary.commandCount += 1;
      pushUnique(summary.commands, command);
    } else if (mcpServer !== undefined && mcpTool !== undefined) {
      summary.mcpCount += 1;
      pushUnique(summary.mcpTools, `${mcpServer}.${mcpTool}`);
    } else if (skillName !== undefined) {
      summary.skillCount += 1;
      pushUnique(summary.skills, skillName);
    } else if (isPromptEvent(hookEvent, row.name)) {
      summary.promptCount += 1;
    } else if (isTurnEvent(hookEvent, row.name)) {
      summary.turnCount += 1;
    } else if (toolName !== undefined) {
      summary.toolCount += 1;
      pushUnique(summary.tools, toolName);
    }

    addTokenUsage(summary.tokenUsage, tokenUsage);
    summaries.set(row.runId, summary);
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

function toPublicSummary(summary: EventSummary) {
  const { hasErrorEvent, lastEventAt, ...publicSummary } = summary;

  return publicSummary;
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
  const ms = new Date(value).getTime();

  return Number.isFinite(ms) ? ms : 0;
}

function addTokenUsage(target: {
  input: number;
  output: number;
  total: number;
  cachedInput?: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
  reasoningOutput?: number;
  estimated?: boolean;
}, source: Record<string, unknown>) {
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
