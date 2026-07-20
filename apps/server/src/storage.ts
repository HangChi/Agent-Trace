import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type SqliteDatabase from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { privacySettingsSchema, type PrivacySettings } from "@agent-trace/schema";
import type {
  CreateRun,
  CreateTraceEvent,
  CreateEvaluationCase,
  CreateEvaluationDataset,
  CreateEvaluationResult,
  CreateAnalyticsBudget,
  AnalyticsBreakdown,
  AnalyticsBreakdownGroup,
  AnalyticsBudget,
  AnalyticsBudgetAlert,
  AnalyticsDimension,
  DashboardEventFilters,
  DashboardEventPage,
  DashboardEventVisibility,
  DashboardModelUsage,
  DashboardRun,
  DashboardRunFilters,
  DashboardRunEventChange,
  DashboardRunEventDiff,
  DashboardRunEventMetric,
  DashboardRunEventRegression,
  DashboardRunMetric,
  DashboardRunTrends,
  DashboardRunMetadata,
  DashboardRunPage,
  DashboardRunSummary,
  DashboardTraceEvent,
  DashboardTraceMetadata,
  EvaluationCase,
  EvaluationDatasetReport,
  EvaluationDatasetSummary,
  EvaluationResult,
  Run,
  RunOrganization,
  TokenUsage,
  UpdateRun
} from "@agent-trace/schema";

import { createSqliteDatabase, db as defaultDb, getDatabasePath } from "./db.js";
import { migrateDatabase } from "./migrations.js";
import { events, runs, runTombstones, settings, usageSessions } from "./schema.js";
import { publishChange } from "./change-feed.js";
import { analyzeTraceInsights } from "./trace-insights.js";
import { createRedactedRunExport } from "./run-export.js";
import type { TranscriptTrace } from "./transcript-scan.js";

type Database = BetterSQLite3Database & { $client: SqliteDatabase.Database };

type ListRunsOptions = {
  includeUntracked?: boolean;
};

type ListRunsPageOptions = ListRunsOptions & DashboardRunFilters & {
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
  includeInsights?: boolean;
};

type EventSummaryRow = Pick<
  typeof events.$inferSelect,
  "runId" | "status" | "timestamp" | "name" | "metadataJson"
>;

const defaultStaleRunMinutes = 30;
const defaultEventPageSize = 100;
const maxEventPageSize = 500;
const defaultRunPageSize = 50;
const maxRunPageSize = 200;
const noEventTimestampSentinel = "<no-events>";
const privacySettingsKey = "privacy";
const defaultPrivacySettings: PrivacySettings = {
  sensitiveKeys: [],
  replacement: "[REDACTED]"
};
const privacySettingsCache = new WeakMap<object, PrivacySettings>();

function stringifyJson(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson(value: string | null) {
  return value === null ? undefined : JSON.parse(value);
}

export function getPrivacySettings(database: Database = defaultDb): PrivacySettings {
  const cached = privacySettingsCache.get(database);

  if (cached) return cached;
  const row = database
    .select({ valueJson: settings.valueJson })
    .from(settings)
    .where(eq(settings.key, privacySettingsKey))
    .limit(1)
    .get();
  const parsed = privacySettingsSchema.safeParse(row ? parseJson(row.valueJson) : undefined);
  const value = parsed.success ? parsed.data : defaultPrivacySettings;

  privacySettingsCache.set(database, value);
  return value;
}

export async function updatePrivacySettings(
  input: PrivacySettings,
  database: Database = defaultDb
) {
  const parsed = privacySettingsSchema.parse(input);
  const seen = new Set<string>();
  const value = {
    sensitiveKeys: parsed.sensitiveKeys.filter((key) => {
      const normalized = key.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    }),
    replacement: parsed.replacement
  };
  const updatedAt = new Date().toISOString();

  await database
    .insert(settings)
    .values({ key: privacySettingsKey, valueJson: JSON.stringify(value), updatedAt })
    .onConflictDoUpdate({
      target: settings.key,
      set: { valueJson: JSON.stringify(value), updatedAt }
    });
  privacySettingsCache.set(database, value);
  publishChange("maintenance");
  return value;
}

function redactSensitiveValue(value: unknown, privacy: PrivacySettings): unknown {
  if (privacy.sensitiveKeys.length === 0) return value;
  const sensitiveKeys = new Set(privacy.sensitiveKeys.map((key) => key.toLowerCase()));

  return redactValue(value, sensitiveKeys, privacy.replacement);
}

function redactValue(value: unknown, sensitiveKeys: Set<string>, replacement: string): unknown {
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, sensitiveKeys, replacement));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      sensitiveKeys.has(key.toLowerCase())
        ? replacement
        : redactValue(entry, sensitiveKeys, replacement)
    ])
  );
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
  const tombstone = await database
    .select({ runId: runTombstones.runId })
    .from(runTombstones)
    .where(eq(runTombstones.runId, run.id))
    .limit(1)
    .get();

  if (tombstone) {
    return false;
  }
  const privacy = getPrivacySettings(database);

  await database.insert(runs).values({
    id: run.id,
    name: run.name,
    status: run.status,
    startedAt: run.startedAt ?? new Date().toISOString(),
    inputJson: stringifyJson(redactSensitiveValue(run.input, privacy)),
    outputJson: stringifyJson(redactSensitiveValue(run.output, privacy)),
    error: run.error,
    metadataJson: stringifyJson(redactSensitiveValue(run.metadata, privacy))
  });

  publishChange("run");
  return true;
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
  const privacy = getPrivacySettings(database);
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
    values.outputJson = stringifyJson(redactSensitiveValue(run.output, privacy));
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
  publishChange("run");
}

export async function updateRunMetadata(
  id: string,
  metadata: unknown,
  database: Database = defaultDb
) {
  const privacy = getPrivacySettings(database);
  await database
    .update(runs)
    .set({ metadataJson: stringifyJson(redactSensitiveValue(metadata, privacy)) })
    .where(eq(runs.id, id));
}

export async function updateRunOrganization(
  id: string,
  organization: RunOrganization,
  database: Database = defaultDb
) {
  const row = await database
    .select({ metadataJson: runs.metadataJson })
    .from(runs)
    .where(eq(runs.id, id))
    .limit(1)
    .get();

  if (!row) return false;
  const metadata = asRecord(parseJson(row.metadataJson));

  for (const key of ["project", "environment", "version", "note"] as const) {
    const value = organization[key];
    if (value === undefined) continue;
    if (value === null || value.trim() === "") delete metadata[key];
    else metadata[key] = value.trim();
  }
  if (organization.tags !== undefined) {
    metadata.tags = [...new Set(organization.tags.map((tag) => tag.trim()).filter(Boolean))];
  }
  if (organization.favorite !== undefined) metadata.favorite = organization.favorite;

  const privacy = getPrivacySettings(database);
  await database
    .update(runs)
    .set({ metadataJson: stringifyJson(redactSensitiveValue(metadata, privacy)) })
    .where(eq(runs.id, id));
  publishChange("run");
  return true;
}

export async function createEvent(
  event: CreateTraceEvent,
  database: Database = defaultDb
) {
  const privacy = getPrivacySettings(database);
  await database.insert(events).values({
    id: event.id,
    runId: event.runId,
    parentId: event.parentId,
    type: event.type,
    name: event.name,
    status: event.status,
    timestamp: event.timestamp ?? new Date().toISOString(),
    durationMs: event.durationMs,
    inputJson: stringifyJson(redactSensitiveValue(event.input, privacy)),
    outputJson: stringifyJson(redactSensitiveValue(event.output, privacy)),
    errorJson: stringifyJson(redactSensitiveValue(event.error, privacy)),
    metadataJson: stringifyJson(redactSensitiveValue(event.metadata, privacy))
  });
  publishChange("event");
}

export async function upsertEvent(
  event: CreateTraceEvent,
  database: Database = defaultDb
) {
  const existing = await database.select().from(events).where(eq(events.id, event.id)).limit(1).get();
  const privacy = getPrivacySettings(database);
  const values = {
    runId: event.runId,
    parentId: event.parentId,
    type: event.type,
    name: event.name,
    status: event.status,
    timestamp: event.timestamp ?? new Date().toISOString(),
    durationMs: event.durationMs,
    inputJson: stringifyJson(redactSensitiveValue(event.input, privacy)),
    outputJson: stringifyJson(redactSensitiveValue(event.output, privacy)),
    errorJson: stringifyJson(redactSensitiveValue(event.error, privacy)),
    metadataJson: stringifyJson(redactSensitiveValue(event.metadata, privacy))
  };

  if (!existing) {
    await database.insert(events).values({
      id: event.id,
      ...values
    });
    publishChange("event");
    return;
  }

  await database.update(events).set(values).where(eq(events.id, event.id));
  publishChange("event");
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
      const summary = summaries.get(run.id);

      return {
        ...toDashboardRun(run, summary, usageBySession),
        _include: options.includeUntracked || hasTrackedContent(summary)
      };
    })
    .filter((run) => run._include)
    .map(({ _include, ...run }) => run);
}

export async function getDashboardRunById(
  id: string,
  database: Database = defaultDb
): Promise<DashboardRun | undefined> {
  const run = await database.select().from(runs).where(eq(runs.id, id)).limit(1).get();

  if (!run) {
    return undefined;
  }

  const eventRows = await database
    .select({
      runId: events.runId,
      status: events.status,
      timestamp: events.timestamp,
      name: events.name,
      metadataJson: events.metadataJson
    })
    .from(events)
    .where(eq(events.runId, id));
  const summaries = summarizeEventsByRun(eventRows);
  const usageRows = await database.select().from(usageSessions);

  return toDashboardRun(run, summaries.get(id), groupUsageBySession(usageRows));
}

export async function exportRedactedRun(
  id: string,
  database: Database = defaultDb
) {
  const [run, eventRows] = await Promise.all([
    getRunById(id, database),
    listEventsByRunId(id, database)
  ]);

  return run ? createRedactedRunExport(run, eventRows) : undefined;
}

export async function compareRuns(
  ids: string[],
  database: Database = defaultDb
): Promise<DashboardRunMetric[]> {
  if (ids.length === 0) return [];

  const runRows = await database.select().from(runs).where(inArray(runs.id, ids));
  const eventRows = await selectEventSummaryRows(database, ids);
  const usageRows = await selectUsageRowsForRuns(runRows, database);
  const summaries = summarizeEventsByRun(eventRows);
  const usageBySession = groupUsageBySession(usageRows);
  const counts = new Map<string, { total: number; failed: number }>();

  for (const event of eventRows) {
    const count = counts.get(event.runId) ?? { total: 0, failed: 0 };
    count.total += 1;
    if (event.status === "error") count.failed += 1;
    counts.set(event.runId, count);
  }

  const order = new Map(ids.map((id, index) => [id, index]));

  return runRows
    .map((row) => {
      const run = toDashboardRun(row, summaries.get(row.id), usageBySession);
      const summary = run.metadata?.summary;
      const count = counts.get(row.id) ?? { total: 0, failed: 0 };
      const endedAt = run.endedAt ?? new Date().toISOString();
      const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(run.startedAt).getTime());

      return {
        id: run.id,
        name: run.name,
        status: run.status,
        startedAt: run.startedAt,
        durationMs,
        eventCount: count.total,
        failedEventCount: count.failed,
        totalTokens: summary?.tokenUsage.total ?? 0,
        costUsd: summary?.costUsd ?? 0
      };
    })
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function compareRunEvents(
  ids: string[],
  database: Database = defaultDb
): Promise<DashboardRunEventDiff[]> {
  const [baselineId, ...candidateIds] = ids;
  if (!baselineId || candidateIds.length === 0) return [];

  const eventGroups = await Promise.all(
    ids.map(async (runId) => [runId, indexComparableEvents(await listEventsByRunId(runId, database))] as const)
  );
  const indexedByRun = new Map(eventGroups);
  const baseline = indexedByRun.get(baselineId) ?? new Map();
  const diffs: DashboardRunEventDiff[] = [];

  for (const runId of candidateIds) {
    const candidate = indexedByRun.get(runId) ?? new Map();
    const keys = [...baseline.keys(), ...[...candidate.keys()].filter((key) => !baseline.has(key))];

    for (const key of keys) {
      const baselineEvent = baseline.get(key);
      const candidateEvent = candidate.get(key);
      const changes = getEventChanges(baselineEvent?.metric, candidateEvent?.metric);
      if (changes.length === 0) continue;
      const source = candidateEvent ?? baselineEvent!;

      diffs.push({
        runId,
        eventKey: key,
        type: source.type,
        name: source.name,
        occurrence: source.occurrence,
        baseline: baselineEvent?.metric,
        candidate: candidateEvent?.metric,
        changes,
        regressions: getEventRegressions(baselineEvent?.metric, candidateEvent?.metric)
      });
    }
  }

  return diffs;
}

export async function createEvaluationDataset(
  input: CreateEvaluationDataset,
  database: Database = defaultDb
): Promise<EvaluationDatasetSummary> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  database.$client.prepare(`
    INSERT INTO evaluation_datasets (id, name, description, score_weights_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.name, input.description ?? null, JSON.stringify(input.scoreWeights), createdAt);
  publishChange("evaluation");

  return {
    id,
    name: input.name,
    description: input.description,
    scoreWeights: input.scoreWeights,
    createdAt,
    caseCount: 0,
    resultCount: 0,
    averageQualityScore: 0
  };
}

export async function createEvaluationCase(
  datasetId: string,
  input: CreateEvaluationCase,
  database: Database = defaultDb
): Promise<EvaluationCase | undefined> {
  const dataset = database.$client
    .prepare("SELECT id FROM evaluation_datasets WHERE id = ?")
    .get(datasetId);
  if (!dataset) return undefined;
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  database.$client.prepare(`
    INSERT INTO evaluation_cases (
      id, dataset_id, name, input_json, expected_output_json, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    datasetId,
    input.name,
    JSON.stringify(input.input),
    stringifyJson(input.expectedOutput),
    stringifyJson(input.metadata),
    createdAt
  );
  publishChange("evaluation");

  return { id, datasetId, ...input, createdAt, results: [] };
}

export async function recordEvaluationResult(
  input: CreateEvaluationResult,
  database: Database = defaultDb
): Promise<EvaluationResult | undefined> {
  const context = database.$client.prepare(`
    SELECT dataset.score_weights_json AS scoreWeightsJson
    FROM evaluation_cases evaluation_case
    JOIN evaluation_datasets dataset ON dataset.id = evaluation_case.dataset_id
    JOIN runs run ON run.id = ?
    WHERE evaluation_case.id = ?
  `).get(input.runId, input.caseId) as { scoreWeightsJson: string } | undefined;
  if (!context) return undefined;
  const qualityScore = calculateQualityScore(input.scores, parseJson(context.scoreWeightsJson));
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  database.$client.prepare(`
    INSERT INTO evaluation_results (
      id, case_id, run_id, scores_json, quality_score, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(case_id, run_id) DO UPDATE SET
      scores_json = excluded.scores_json,
      quality_score = excluded.quality_score,
      notes = excluded.notes,
      created_at = excluded.created_at
  `).run(
    id,
    input.caseId,
    input.runId,
    JSON.stringify(input.scores),
    qualityScore,
    input.notes ?? null,
    createdAt
  );
  const stored = database.$client.prepare(`
    SELECT id, created_at AS createdAt
    FROM evaluation_results WHERE case_id = ? AND run_id = ?
  `).get(input.caseId, input.runId) as { id: string; createdAt: string };
  publishChange("evaluation");

  return { ...input, id: stored.id, qualityScore, createdAt: stored.createdAt };
}

export async function listEvaluationDatasets(
  database: Database = defaultDb
): Promise<EvaluationDatasetSummary[]> {
  const rows = database.$client.prepare(`
    SELECT
      dataset.id,
      dataset.name,
      dataset.description,
      dataset.score_weights_json AS scoreWeightsJson,
      dataset.created_at AS createdAt,
      count(distinct evaluation_case.id) AS caseCount,
      count(result.id) AS resultCount,
      coalesce(avg(result.quality_score), 0) AS averageQualityScore
    FROM evaluation_datasets dataset
    LEFT JOIN evaluation_cases evaluation_case ON evaluation_case.dataset_id = dataset.id
    LEFT JOIN evaluation_results result ON result.case_id = evaluation_case.id
    GROUP BY dataset.id
    ORDER BY dataset.created_at DESC
  `).all() as EvaluationDatasetSummaryRow[];

  return rows.map(toEvaluationDatasetSummary);
}

export async function getEvaluationDatasetReport(
  datasetId: string,
  database: Database = defaultDb
): Promise<EvaluationDatasetReport | undefined> {
  const datasets = await listEvaluationDatasets(database);
  const dataset = datasets.find((entry) => entry.id === datasetId);
  if (!dataset) return undefined;
  const caseRows = database.$client.prepare(`
    SELECT
      id, dataset_id AS datasetId, name, input_json AS inputJson,
      expected_output_json AS expectedOutputJson, metadata_json AS metadataJson,
      created_at AS createdAt
    FROM evaluation_cases WHERE dataset_id = ? ORDER BY created_at, id
  `).all(datasetId) as EvaluationCaseRow[];
  const caseIds = caseRows.map((row) => row.id);
  const resultRows = caseIds.length === 0 ? [] : database.$client.prepare(`
    SELECT
      id, case_id AS caseId, run_id AS runId, scores_json AS scoresJson,
      quality_score AS qualityScore, notes, created_at AS createdAt
    FROM evaluation_results
    WHERE case_id IN (${caseIds.map(() => "?").join(",")})
    ORDER BY created_at, id
  `).all(...caseIds) as EvaluationResultRow[];
  const resultsByCase = new Map<string, EvaluationResult[]>();

  for (const row of resultRows) {
    const result: EvaluationResult = {
      id: row.id,
      caseId: row.caseId,
      runId: row.runId,
      scores: asNumberRecord(parseJson(row.scoresJson)),
      qualityScore: roundQuality(row.qualityScore),
      notes: row.notes ?? undefined,
      createdAt: row.createdAt
    };
    const group = resultsByCase.get(row.caseId) ?? [];
    group.push(result);
    resultsByCase.set(row.caseId, group);
  }

  return {
    dataset,
    cases: caseRows.map((row) => ({
      id: row.id,
      datasetId: row.datasetId,
      name: row.name,
      input: parseJson(row.inputJson),
      expectedOutput: parseJson(row.expectedOutputJson),
      metadata: asRecord(parseJson(row.metadataJson)),
      createdAt: row.createdAt,
      results: resultsByCase.get(row.id) ?? []
    }))
  };
}

type EvaluationDatasetSummaryRow = {
  id: string;
  name: string;
  description: string | null;
  scoreWeightsJson: string;
  createdAt: string;
  caseCount: number;
  resultCount: number;
  averageQualityScore: number;
};

type EvaluationCaseRow = {
  id: string;
  datasetId: string;
  name: string;
  inputJson: string;
  expectedOutputJson: string | null;
  metadataJson: string | null;
  createdAt: string;
};

type EvaluationResultRow = {
  id: string;
  caseId: string;
  runId: string;
  scoresJson: string;
  qualityScore: number;
  notes: string | null;
  createdAt: string;
};

function toEvaluationDatasetSummary(row: EvaluationDatasetSummaryRow): EvaluationDatasetSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    scoreWeights: asNumberRecord(parseJson(row.scoreWeightsJson)),
    createdAt: row.createdAt,
    caseCount: Number(row.caseCount),
    resultCount: Number(row.resultCount),
    averageQualityScore: roundQuality(row.averageQualityScore)
  };
}

function calculateQualityScore(scores: Record<string, number>, rawWeights: unknown) {
  const weights = asNumberRecord(rawWeights);
  const weighted = Object.entries(scores)
    .map(([key, score]) => ({ score, weight: weights[key] ?? 0 }))
    .filter(({ weight }) => weight > 0);
  const selected = weighted.length > 0
    ? weighted
    : Object.values(scores).map((score) => ({ score, weight: 1 }));
  const totalWeight = selected.reduce((total, entry) => total + entry.weight, 0);
  return roundQuality(selected.reduce((total, entry) => total + entry.score * entry.weight, 0) / totalWeight);
}

function asNumberRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1])
    )
  );
}

function roundQuality(value: number) {
  return Math.round(Number(value) * 10_000) / 10_000;
}

function indexComparableEvents(eventRows: DashboardTraceEvent[]) {
  const occurrences = new Map<string, number>();
  const indexed = new Map<string, {
    type: string;
    name: string;
    occurrence: number;
    metric: DashboardRunEventMetric;
  }>();

  for (const event of eventRows) {
    const signature = `${event.type}:${event.name}`;
    const occurrence = (occurrences.get(signature) ?? 0) + 1;
    occurrences.set(signature, occurrence);
    const eventKey = `${signature}:${occurrence}`;

    indexed.set(eventKey, {
      type: event.type,
      name: event.name,
      occurrence,
      metric: {
        id: event.id,
        status: event.status,
        durationMs: event.durationMs ?? 0,
        totalTokens: Number(event.metadata?.tokenUsage?.total ?? 0)
      }
    });
  }

  return indexed;
}

function getEventChanges(
  baseline: DashboardRunEventMetric | undefined,
  candidate: DashboardRunEventMetric | undefined
): DashboardRunEventChange[] {
  if (!baseline) return candidate ? ["added"] : [];
  if (!candidate) return ["removed"];
  const changes: DashboardRunEventChange[] = [];
  if (baseline.status !== candidate.status) changes.push("status");
  if (baseline.durationMs !== candidate.durationMs) changes.push("duration");
  if (baseline.totalTokens !== candidate.totalTokens) changes.push("tokens");
  return changes;
}

function getEventRegressions(
  baseline: DashboardRunEventMetric | undefined,
  candidate: DashboardRunEventMetric | undefined
): DashboardRunEventRegression[] {
  if (!candidate) return baseline ? ["missing"] : [];
  const regressions: DashboardRunEventRegression[] = [];
  if (candidate.status === "error" && baseline?.status !== "error") regressions.push("status");
  if (baseline && baseline.durationMs > 0 && candidate.durationMs > baseline.durationMs * 1.2) {
    regressions.push("duration");
  }
  if (baseline && baseline.totalTokens > 0 && candidate.totalTokens > baseline.totalTokens * 1.2) {
    regressions.push("tokens");
  }
  return regressions;
}

export async function getRunTrends(
  days: number,
  database: Database = defaultDb,
  now = new Date()
): Promise<DashboardRunTrends> {
  const normalizedDays = Math.min(90, Math.max(1, Math.floor(days)));
  const endDate = startOfUtcDay(now);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - normalizedDays + 1);
  const exclusiveEnd = new Date(endDate);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
  const rows = database.$client.prepare(`
    with selected_runs as (
      select * from runs where started_at >= ? and started_at < ?
    ),
    event_metrics as (
      select
        event.run_id as run_id,
        sum(cast(json_extract(event.metadata_json, '$.tokenUsage.total') as integer)) as total_tokens,
        sum(cast(json_extract(event.metadata_json, '$.costUsd') as real)) as cost_usd
      from events event
      join selected_runs run on run.id = event.run_id
      group by event.run_id
    ),
    usage_metrics as (
      select
        usage.client as client,
        usage.session_id as session_id,
        sum(usage.total_tokens) as total_tokens,
        sum(usage.cost_usd) as cost_usd
      from usage_sessions usage
      where exists (
        select 1 from selected_runs run
        where usage.session_id = json_extract(run.metadata_json, '$.sessionId')
          and usage.client = case json_extract(run.metadata_json, '$.agent')
            when 'claude-code' then 'claude'
            when 'github-copilot' then 'copilot'
            else json_extract(run.metadata_json, '$.agent') end
      )
      group by usage.client, usage.session_id
    )
    select
      date(run.started_at) as date,
      count(*) as runCount,
      sum(case when run.status = 'success' then 1 else 0 end) as successfulRunCount,
      sum(case when run.status = 'error' then 1 else 0 end) as failedRunCount,
      cast(round(avg(max(0,
        (julianday(coalesce(run.ended_at, ?)) - julianday(run.started_at)) * 86400000
      ))) as integer) as averageDurationMs,
      sum(coalesce(usage.total_tokens, event.total_tokens, 0)) as totalTokens,
      sum(coalesce(usage.cost_usd, event.cost_usd, 0)) as costUsd
    from selected_runs run
    left join event_metrics event on event.run_id = run.id
    left join usage_metrics usage
      on usage.session_id = json_extract(run.metadata_json, '$.sessionId')
      and usage.client = case json_extract(run.metadata_json, '$.agent')
        when 'claude-code' then 'claude'
        when 'github-copilot' then 'copilot'
        else json_extract(run.metadata_json, '$.agent') end
    group by date(run.started_at)
    order by date(run.started_at)
  `).all(
    startDate.toISOString(),
    exclusiveEnd.toISOString(),
    now.toISOString()
  ) as Array<{
    date: string;
    runCount: number;
    successfulRunCount: number;
    failedRunCount: number;
    averageDurationMs: number;
    totalTokens: number;
    costUsd: number;
  }>;
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const points = Array.from({ length: normalizedDays }, (_, index) => {
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    const row = byDate.get(key);

    return {
      date: key,
      runCount: Number(row?.runCount ?? 0),
      successfulRunCount: Number(row?.successfulRunCount ?? 0),
      failedRunCount: Number(row?.failedRunCount ?? 0),
      averageDurationMs: Number(row?.averageDurationMs ?? 0),
      totalTokens: Number(row?.totalTokens ?? 0),
      costUsd: Number(row?.costUsd ?? 0)
    };
  });

  return { days: normalizedDays, points };
}

export async function getAnalyticsBreakdown(
  days: number,
  dimension: AnalyticsDimension,
  database: Database = defaultDb,
  now = new Date()
): Promise<AnalyticsBreakdown> {
  const normalizedDays = Math.min(90, Math.max(1, Math.floor(days)));
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - normalizedDays + 1);
  start.setUTCHours(0, 0, 0, 0);

  return {
    dimension,
    days: normalizedDays,
    groups: getAnalyticsBreakdownBetween(dimension, start, now, database)
  };
}

function getAnalyticsBreakdownBetween(
  dimension: AnalyticsDimension,
  start: Date,
  end: Date,
  database: Database
): AnalyticsBreakdownGroup[] {
  const dimensionExpression = getAnalyticsDimensionExpression(dimension);
  const rows = database.$client.prepare(`
    WITH selected_runs AS (
      SELECT * FROM runs WHERE started_at >= ? AND started_at <= ?
    ),
    event_metrics AS (
      SELECT
        run_id,
        sum(cast(json_extract(metadata_json, '$.tokenUsage.total') AS INTEGER)) AS total_tokens,
        sum(cast(json_extract(metadata_json, '$.costUsd') AS REAL)) AS cost_usd
      FROM events
      WHERE run_id IN (SELECT id FROM selected_runs)
      GROUP BY run_id
    )
    SELECT
      ${dimensionExpression} AS key,
      count(*) AS runCount,
      sum(CASE WHEN run.status = 'success' THEN 1 ELSE 0 END) AS successfulRunCount,
      sum(CASE WHEN run.status = 'error' THEN 1 ELSE 0 END) AS failedRunCount,
      cast(round(avg(max(0,
        (julianday(coalesce(run.ended_at, ?)) - julianday(run.started_at)) * 86400000
      ))) AS INTEGER) AS averageDurationMs,
      sum(coalesce(event.total_tokens, 0)) AS totalTokens,
      sum(coalesce(event.cost_usd, 0)) AS costUsd
    FROM selected_runs run
    LEFT JOIN event_metrics event ON event.run_id = run.id
    GROUP BY key
    ORDER BY costUsd DESC, totalTokens DESC, key
  `).all(start.toISOString(), end.toISOString(), end.toISOString()) as Array<{
    key: string;
    runCount: number;
    successfulRunCount: number;
    failedRunCount: number;
    averageDurationMs: number;
    totalTokens: number;
    costUsd: number;
  }>;

  return rows.map((row) => ({
    key: row.key,
    runCount: Number(row.runCount),
    successfulRunCount: Number(row.successfulRunCount),
    failedRunCount: Number(row.failedRunCount),
    failureRate: row.runCount === 0 ? 0 : roundQuality(row.failedRunCount / row.runCount),
    averageDurationMs: Number(row.averageDurationMs),
    totalTokens: Number(row.totalTokens),
    costUsd: roundCost(row.costUsd)
  }));
}

function getAnalyticsDimensionExpression(dimension: AnalyticsDimension) {
  if (dimension === "project") {
    return "coalesce(nullif(json_extract(run.metadata_json, '$.project'), ''), 'unassigned')";
  }
  if (dimension === "environment") {
    return "coalesce(nullif(json_extract(run.metadata_json, '$.environment'), ''), 'unassigned')";
  }
  if (dimension === "model") {
    return `coalesce(
      nullif(json_extract(run.metadata_json, '$.model'), ''),
      (SELECT nullif(json_extract(model_event.metadata_json, '$.model'), '')
        FROM events model_event WHERE model_event.run_id = run.id
        AND json_extract(model_event.metadata_json, '$.model') IS NOT NULL
        ORDER BY model_event.timestamp LIMIT 1),
      'unknown'
    )`;
  }
  return `coalesce(
    nullif(json_extract(run.metadata_json, '$.agent'), ''),
    nullif(json_extract(run.metadata_json, '$.source'), ''),
    nullif(json_extract(run.metadata_json, '$.surface'), ''),
    'manual'
  )`;
}

export async function createAnalyticsBudget(
  input: CreateAnalyticsBudget,
  database: Database = defaultDb
): Promise<AnalyticsBudget> {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.$client.prepare(`
    INSERT INTO analytics_budgets (
      id, name, dimension, dimension_value, period, max_cost_usd, max_tokens,
      max_runs, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.dimension,
    input.value,
    input.period,
    input.maxCostUsd ?? null,
    input.maxTokens ?? null,
    input.maxRuns ?? null,
    input.enabled ? 1 : 0,
    now,
    now
  );
  publishChange("budget");
  return { id, ...input, createdAt: now, updatedAt: now };
}

export async function listAnalyticsBudgets(
  database: Database = defaultDb
): Promise<AnalyticsBudget[]> {
  const rows = database.$client.prepare(`
    SELECT
      id, name, dimension, dimension_value AS value, period,
      max_cost_usd AS maxCostUsd, max_tokens AS maxTokens, max_runs AS maxRuns,
      enabled, created_at AS createdAt, updated_at AS updatedAt
    FROM analytics_budgets ORDER BY created_at DESC
  `).all() as Array<{
    id: string;
    name: string;
    dimension: AnalyticsDimension;
    value: string;
    period: "daily" | "monthly";
    maxCostUsd: number | null;
    maxTokens: number | null;
    maxRuns: number | null;
    enabled: number;
    createdAt: string;
    updatedAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    dimension: row.dimension,
    value: row.value,
    period: row.period,
    maxCostUsd: row.maxCostUsd ?? undefined,
    maxTokens: row.maxTokens ?? undefined,
    maxRuns: row.maxRuns ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
}

export async function deleteAnalyticsBudget(
  id: string,
  database: Database = defaultDb
) {
  const result = database.$client.prepare("DELETE FROM analytics_budgets WHERE id = ?").run(id);
  if (result.changes > 0) publishChange("budget");
  return result.changes > 0;
}

export async function getAnalyticsBudgetAlerts(
  database: Database = defaultDb,
  now = new Date()
): Promise<AnalyticsBudgetAlert[]> {
  const budgets = (await listAnalyticsBudgets(database)).filter((budget) => budget.enabled);
  const alerts: AnalyticsBudgetAlert[] = [];

  for (const budget of budgets) {
    const start = new Date(now);
    if (budget.period === "monthly") {
      start.setUTCDate(1);
    }
    start.setUTCHours(0, 0, 0, 0);
    const group = getAnalyticsBreakdownBetween(budget.dimension, start, now, database)
      .find((entry) => entry.key === budget.value);
    const metrics = [
      ["costUsd", budget.maxCostUsd, group?.costUsd ?? 0],
      ["tokens", budget.maxTokens, group?.totalTokens ?? 0],
      ["runs", budget.maxRuns, group?.runCount ?? 0]
    ] as const;

    for (const [metric, limit, actual] of metrics) {
      if (limit === undefined || actual <= limit) continue;
      alerts.push({
        budgetId: budget.id,
        budgetName: budget.name,
        dimension: budget.dimension,
        value: budget.value,
        period: budget.period,
        metric,
        limit,
        actual,
        ratio: limit === 0 ? Number.POSITIVE_INFINITY : roundQuality(actual / limit)
      });
    }
  }

  return alerts;
}

function roundCost(value: number) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export async function listRunsPage(
  options: ListRunsPageOptions = {},
  database: Database = defaultDb
): Promise<DashboardRunPage> {
  const pageSize = normalizeRunPageSize(options.pageSize);
  const where = getRunListWhere(options);
  const aggregate = await database
    .select({
      total: sql<number>`count(*)`,
      running: sql<number>`sum(case when ${runs.status} = 'running' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${runs.status} = 'error' then 1 else 0 end)`
    })
    .from(runs)
    .where(where)
    .get();
  const total = Number(aggregate?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(normalizePage(options.page), totalPages);
  const start = (page - 1) * pageSize;
  const pageRows = await database
    .select()
    .from(runs)
    .where(where)
    .orderBy(...getRunListOrder(options))
    .limit(pageSize)
    .offset(start);
  const pageIds = pageRows.map((run) => run.id);
  const eventRows = await selectEventSummaryRows(database, pageIds);
  const usageRows = await selectUsageRowsForRuns(pageRows, database);
  const summaries = summarizeEventsByRun(eventRows);
  const usageBySession = groupUsageBySession(usageRows);
  const agentExpression = sql<string>`coalesce(json_extract(${runs.metadataJson}, '$.agent'), 'manual')`;
  const agentRows = await database
    .select({ agent: agentExpression, count: sql<number>`count(*)` })
    .from(runs)
    .where(where)
    .groupBy(agentExpression);

  return {
    runs: pageRows.map((run) =>
      toDashboardRun(run, summaries.get(run.id), usageBySession)
    ),
    pagination: {
      page,
      pageSize,
      total,
      totalPages
    },
    summary: {
      totalRuns: total,
      runningRuns: Number(aggregate?.running ?? 0),
      failedRuns: Number(aggregate?.failed ?? 0),
      agents: agentRows
        .map((row) => ({ agent: row.agent, count: Number(row.count) }))
        .sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent))
    }
  };
}

function getRunListWhere(options: ListRunsPageOptions) {
  const conditions: SQL[] = [];
  const query = options.q?.trim().toLowerCase();
  const status = normalizeFilter(options.status);
  const source = normalizeFilter(options.source);
  const model = normalizeFilter(options.model);
  const project = normalizeFilter(options.project).toLowerCase();
  const environment = normalizeFilter(options.environment).toLowerCase();
  const tag = normalizeFilter(options.tag).toLowerCase();

  if (!options.includeUntracked) {
    conditions.push(sql`exists (
      select 1 from ${events}
      where ${events.runId} = ${runs.id}
        and json_extract(${events.metadataJson}, '$.category') in ('command', 'tool', 'mcp', 'skill')
    )`);
  }

  if (query) {
    const pattern = `%${query}%`;
    conditions.push(sql`(
      lower(${runs.id}) like ${pattern}
      or lower(${runs.name}) like ${pattern}
      or lower(coalesce(json_extract(${runs.metadataJson}, '$.agent'), '')) like ${pattern}
      or lower(coalesce(json_extract(${runs.metadataJson}, '$.sessionId'), '')) like ${pattern}
      or lower(coalesce(json_extract(${runs.metadataJson}, '$.model'), '')) like ${pattern}
      or lower(coalesce(json_extract(${runs.metadataJson}, '$.project'), '')) like ${pattern}
      or lower(coalesce(json_extract(${runs.metadataJson}, '$.environment'), '')) like ${pattern}
      or lower(coalesce(json_extract(${runs.metadataJson}, '$.version'), '')) like ${pattern}
      or lower(coalesce(json_extract(${runs.metadataJson}, '$.note'), '')) like ${pattern}
      or exists (
        select 1 from json_each(coalesce(json_extract(${runs.metadataJson}, '$.tags'), '[]'))
        where lower(cast(value as text)) like ${pattern}
      )
    )`);
  }

  if (status !== "all") conditions.push(eq(runs.status, status));
  if (source !== "all") {
    conditions.push(sql`(
      json_extract(${runs.metadataJson}, '$.agent') = ${source}
      or json_extract(${runs.metadataJson}, '$.source') = ${source}
      or json_extract(${runs.metadataJson}, '$.surface') = ${source}
      or json_extract(${runs.inputJson}, '$.source') = ${source}
    )`);
  }
  if (model !== "all") {
    conditions.push(sql`(
      json_extract(${runs.metadataJson}, '$.model') = ${model}
      or exists (
        select 1 from ${events}
        where ${events.runId} = ${runs.id}
          and json_extract(${events.metadataJson}, '$.model') = ${model}
      )
      or exists (
        select 1 from ${usageSessions}
        where ${usageSessions.sessionId} = json_extract(${runs.metadataJson}, '$.sessionId')
          and ${usageSessions.model} = ${model}
      )
    )`);
  }
  if (project !== "all") {
    conditions.push(sql`lower(coalesce(json_extract(${runs.metadataJson}, '$.project'), '')) = ${project}`);
  }
  if (environment !== "all") {
    conditions.push(sql`lower(coalesce(json_extract(${runs.metadataJson}, '$.environment'), '')) = ${environment}`);
  }
  if (tag !== "all") {
    conditions.push(sql`exists (
      select 1 from json_each(coalesce(json_extract(${runs.metadataJson}, '$.tags'), '[]'))
      where lower(cast(value as text)) = ${tag}
    )`);
  }
  if (options.favorite !== undefined) {
    conditions.push(sql`coalesce(json_extract(${runs.metadataJson}, '$.favorite'), 0) = ${options.favorite ? 1 : 0}`);
  }
  if (options.startedAfter) conditions.push(sql`${runs.startedAt} >= ${options.startedAfter}`);
  if (options.startedBefore) conditions.push(sql`${runs.startedAt} <= ${options.startedBefore}`);
  if (options.minCostUsd !== undefined) {
    conditions.push(sql`${getRunCostExpression()} >= ${options.minCostUsd}`);
  }
  if (options.maxCostUsd !== undefined) {
    conditions.push(sql`${getRunCostExpression()} <= ${options.maxCostUsd}`);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function getRunListOrder(options: ListRunsPageOptions) {
  const expression = options.sort === "name"
    ? runs.name
    : options.sort === "status"
      ? runs.status
      : options.sort === "duration"
        ? sql<number>`(julianday(coalesce(${runs.endedAt}, CURRENT_TIMESTAMP)) - julianday(${runs.startedAt})) * 86400000`
        : options.sort === "tokens"
          ? getRunTokensExpression()
          : options.sort === "cost"
            ? getRunCostExpression()
            : runs.startedAt;
  const primary = options.order === "asc" ? asc(expression) : desc(expression);

  return [primary, asc(runs.id)] as const;
}

function getRunClientExpression() {
  return sql<string>`case json_extract(${runs.metadataJson}, '$.agent')
    when 'claude-code' then 'claude'
    when 'github-copilot' then 'copilot'
    else json_extract(${runs.metadataJson}, '$.agent') end`;
}

function getRunCostExpression() {
  return sql<number>`coalesce(
    (select sum(${usageSessions.costUsd}) from ${usageSessions}
      where ${usageSessions.sessionId} = json_extract(${runs.metadataJson}, '$.sessionId')
        and ${usageSessions.client} = ${getRunClientExpression()}),
    (select sum(cast(json_extract(${events.metadataJson}, '$.costUsd') as real))
      from ${events} where ${events.runId} = ${runs.id}),
    0
  )`;
}

function getRunTokensExpression() {
  return sql<number>`coalesce(
    (select sum(${usageSessions.totalTokens}) from ${usageSessions}
      where ${usageSessions.sessionId} = json_extract(${runs.metadataJson}, '$.sessionId')
        and ${usageSessions.client} = ${getRunClientExpression()}),
    (select sum(cast(json_extract(${events.metadataJson}, '$.tokenUsage.total') as integer))
      from ${events} where ${events.runId} = ${runs.id}),
    0
  )`;
}

async function selectUsageRowsForRuns(
  runRows: Array<typeof runs.$inferSelect>,
  database: Database
) {
  const sessionIds = [...new Set(runRows
    .map((run) => getString(asRecord(parseJson(run.metadataJson)).sessionId))
    .filter((value): value is string => value !== undefined))];

  return sessionIds.length === 0
    ? []
    : database.select().from(usageSessions).where(inArray(usageSessions.sessionId, sessionIds));
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

function selectEventSummaryRows(database: Database, runIds?: string[]) {
  if (runIds?.length === 0) return Promise.resolve([] as EventSummaryRow[]);

  return database
    .select({
      runId: events.runId,
      status: events.status,
      timestamp: events.timestamp,
      name: events.name,
      metadataJson: events.metadataJson
    })
    .from(events)
    .where(runIds ? inArray(events.runId, runIds) : undefined);
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
  const visibility = normalizeVisibility(options.visibility);
  const pageSize = normalizePageSize(options.pageSize);
  const page = normalizePage(options.page);
  const runCondition = eq(events.runId, runId);
  const liveAction = sql<boolean>`coalesce(json_extract(${events.metadataJson}, '$.source'), '') != 'transcript'
    and json_extract(${events.metadataJson}, '$.category') in ('command', 'tool', 'mcp', 'skill')`;
  const liveActionRow = await database
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(runCondition, liveAction))
    .get();
  const displayCondition = getDisplayEventCondition(Number(liveActionRow?.count ?? 0) > 0);
  const visibilityCondition = visibility === "all"
    ? undefined
    : visibility === "display"
      ? displayCondition
      : sql<boolean>`not (${displayCondition})`;
  const filterConditions = getEventFilterConditions(options);
  const visibleWhere = and(runCondition, visibilityCondition);
  const filteredWhere = and(runCondition, visibilityCondition, ...filterConditions);
  const [countRow, matchingRow, aggregateRow] = await Promise.all([
    database.select({
      total: sql<number>`count(*)`,
      display: sql<number>`sum(case when ${displayCondition} then 1 else 0 end)`
    }).from(events).where(runCondition).get(),
    database.select({ count: sql<number>`count(*)` }).from(events).where(filteredWhere).get(),
    database.select({
      totalTokens: sql<number>`coalesce(sum(cast(json_extract(${events.metadataJson}, '$.tokenUsage.total') as integer)), 0)`,
      totalDurationMs: sql<number>`coalesce(sum(${events.durationMs}), 0)`,
      failedEvents: sql<number>`sum(case when ${events.status} = 'error' then 1 else 0 end)`
    }).from(events).where(runCondition).get()
  ]);
  const total = Number(countRow?.total ?? 0);
  const display = Number(countRow?.display ?? 0);
  const matching = Number(matchingRow?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(matching / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = await database
    .select()
    .from(events)
    .where(filteredWhere)
    .orderBy(desc(sql`julianday(${events.timestamp})`), asc(events.id))
    .limit(pageSize)
    .offset(start);
  const errorEvents = (
    await database
      .select()
      .from(events)
      .where(and(eq(events.runId, runId), eq(events.status, "error")))
      .orderBy(asc(events.timestamp))
  ).map(toDashboardEvent);
  const typeRows = await database
    .selectDistinct({ value: events.type })
    .from(events)
    .where(visibleWhere)
    .orderBy(asc(events.type));
  const categoryExpression = getEventCategoryExpression();
  const categoryRows = await database
    .selectDistinct({ value: categoryExpression })
    .from(events)
    .where(and(visibleWhere, sql`${categoryExpression} is not null`))
    .orderBy(asc(categoryExpression));
  const sourceRow = await database
    .select({ metadataJson: events.metadataJson })
    .from(events)
    .where(and(runCondition, sql`json_extract(${events.metadataJson}, '$.agent') is not null`))
    .orderBy(asc(events.timestamp))
    .limit(1)
    .get();
  const insights = options.includeInsights ? await getTraceInsights(runId, database) : undefined;

  return {
    events: pageRows.map(toDashboardEvent),
    counts: {
      total,
      display,
      hidden: total - display,
      matching
    },
    facets: {
      types: typeRows.map(({ value }) => value),
      categories: categoryRows
        .map(({ value }) => value)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    },
    pagination: {
      page: safePage,
      pageSize,
      total: matching,
      totalPages
    },
    summary: {
      totalTokens: Number(aggregateRow?.totalTokens ?? 0),
      totalDurationMs: Number(aggregateRow?.totalDurationMs ?? 0),
      failedEvents: Number(aggregateRow?.failedEvents ?? 0),
      sourceMetadata: normalizeMetadataForDisplay(parseJson(sourceRow?.metadataJson ?? null)),
      errorEvents,
      insights
    },
    visibility
  };
}

export async function getTraceInsights(
  runId: string,
  database: Database = defaultDb
) {
  const rows = await database
    .select()
    .from(events)
    .where(eq(events.runId, runId))
    .orderBy(asc(events.timestamp));

  return analyzeTraceInsights(rows.map(toDashboardEvent));
}

function getDisplayEventCondition(hasLiveActions: boolean) {
  const category = getEventCategoryExpression();
  const display = sql<boolean>`(
    ${category} in ('command', 'tool', 'mcp', 'skill', 'tokens')
    or json_type(${events.metadataJson}, '$.tokenUsage') is not null
  )`;

  return hasLiveActions
    ? sql<boolean>`${display} and coalesce(json_extract(${events.metadataJson}, '$.source'), '') != 'transcript'`
    : display;
}

function getEventCategoryExpression() {
  return sql<string | null>`case
    when json_extract(${events.metadataJson}, '$.category') = 'tool'
      and json_extract(${events.metadataJson}, '$.toolKind') = 'command' then 'command'
    when json_extract(${events.metadataJson}, '$.category') is not null
      then json_extract(${events.metadataJson}, '$.category')
    when json_extract(${events.metadataJson}, '$.command') is not null
      or json_extract(${events.inputJson}, '$.command') is not null
      or json_extract(${events.metadataJson}, '$.toolKind') = 'command' then 'command'
    when json_extract(${events.metadataJson}, '$.mcpServer') is not null
      and json_extract(${events.metadataJson}, '$.mcpTool') is not null then 'mcp'
    when json_extract(${events.metadataJson}, '$.skillName') is not null then 'skill'
    when json_extract(${events.metadataJson}, '$.toolName') is not null then 'tool'
    when json_type(${events.metadataJson}, '$.tokenUsage') is not null then 'tokens'
    else null end`;
}

function getEventFilterConditions(options: ListEventsOptions) {
  const conditions: SQL[] = [];
  const status = normalizeFilter(options.status);
  const type = normalizeFilter(options.type);
  const category = normalizeFilter(options.category);
  const query = options.q?.trim().toLowerCase();

  if (status !== "all") conditions.push(eq(events.status, status));
  if (type !== "all") conditions.push(eq(events.type, type));
  if (category !== "all") conditions.push(sql`${getEventCategoryExpression()} = ${category}`);
  if (query) {
    const pattern = `%${query}%`;
    conditions.push(sql`(
      lower(${events.id}) like ${pattern}
      or lower(${events.name}) like ${pattern}
      or lower(${events.type}) like ${pattern}
      or lower(${events.status}) like ${pattern}
      or lower(coalesce(json_extract(${events.inputJson}, '$.command'), '')) like ${pattern}
      or lower(coalesce(json_extract(${events.errorJson}, '$.message'), '')) like ${pattern}
      or lower(coalesce(${events.metadataJson}, '')) like ${pattern}
    )`);
  }

  return conditions;
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

export async function deleteRun(id: string, database: Database = defaultDb): Promise<boolean> {
  const existing = await database.select({ id: runs.id }).from(runs).where(eq(runs.id, id)).limit(1).get();

  if (!existing) return false;

  await database
    .insert(runTombstones)
    .values({ runId: id, deletedAt: new Date().toISOString(), reason: "user_deleted" })
    .onConflictDoUpdate({
      target: runTombstones.runId,
      set: { deletedAt: new Date().toISOString(), reason: "user_deleted" }
    });
  // Foreign keys cascade events, but delete them explicitly so the result is
  // correct even if the connection has foreign_keys disabled.
  await database.delete(events).where(eq(events.runId, id));
  const result = await database.delete(runs).where(eq(runs.id, id));

  if (result.changes > 0) publishChange("maintenance");

  return result.changes > 0;
}

export async function deleteRuns(ids: string[], database: Database = defaultDb): Promise<number> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];

  if (uniqueIds.length === 0) {
    return 0;
  }

  const existingRows = await database
    .select({ id: runs.id })
    .from(runs)
    .where(inArray(runs.id, uniqueIds));
  const deletedAt = new Date().toISOString();

  if (existingRows.length > 0) {
    await database
      .insert(runTombstones)
      .values(existingRows.map(({ id }) => ({ runId: id, deletedAt, reason: "user_deleted" })))
      .onConflictDoUpdate({
        target: runTombstones.runId,
        set: { deletedAt, reason: "user_deleted" }
      });
  }

  await database.delete(events).where(inArray(events.runId, uniqueIds));
  const result = await database.delete(runs).where(inArray(runs.id, uniqueIds));

  if (result.changes > 0) publishChange("maintenance");

  return result.changes;
}

export async function restoreDeletedRun(id: string, database: Database = defaultDb) {
  const result = await database.delete(runTombstones).where(eq(runTombstones.runId, id));

  if (result.changes > 0) publishChange("maintenance");
  return result.changes > 0;
}

export async function listRunTombstones(limit: number | undefined = 50, database: Database = defaultDb) {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit ?? 50)));

  return database
    .select()
    .from(runTombstones)
    .orderBy(desc(runTombstones.deletedAt))
    .limit(boundedLimit);
}

export async function pruneRuns(
  options: { before: string; statuses?: string[]; keepTombstones?: boolean },
  database: Database = defaultDb
) {
  const conditions: SQL[] = [sql`${runs.startedAt} < ${options.before}`];
  const statuses = options.statuses?.filter(Boolean) ?? [];

  if (statuses.length > 0) conditions.push(inArray(runs.status, statuses));
  const rows = await database
    .select({ id: runs.id })
    .from(runs)
    .where(and(...conditions));

  if (rows.length === 0) return 0;
  const ids = rows.map(({ id }) => id);

  if (options.keepTombstones === false) {
    await database.delete(events).where(inArray(events.runId, ids));
    const result = await database.delete(runs).where(inArray(runs.id, ids));
    if (result.changes > 0) publishChange("maintenance");
    return result.changes;
  }

  return deleteRuns(ids, database);
}

export async function getStorageStats(database: Database = defaultDb) {
  const [runCount, eventCount, usageCount, tombstoneCount] = await Promise.all([
    database.select({ count: sql<number>`count(*)` }).from(runs).get(),
    database.select({ count: sql<number>`count(*)` }).from(events).get(),
    database.select({ count: sql<number>`count(*)` }).from(usageSessions).get(),
    database.select({ count: sql<number>`count(*)` }).from(runTombstones).get()
  ]);
  const path = getDatabasePath();

  return {
    databasePath: path,
    databaseBytes: existsSync(path) ? statSync(path).size : undefined,
    runs: Number(runCount?.count ?? 0),
    events: Number(eventCount?.count ?? 0),
    usageSessions: Number(usageCount?.count ?? 0),
    tombstones: Number(tombstoneCount?.count ?? 0)
  };
}

export function compactDatabase(path = getDatabasePath()) {
  const sqlite = createSqliteDatabase(path);

  try {
    migrateDatabase(sqlite);
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
  } finally {
    sqlite.close();
  }

  publishChange("maintenance");
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
  const privacy = getPrivacySettings(database);
  return database.transaction((transaction) => {
    const currentKeys = new Set(currentSessionKeys);

    for (const trace of traces) {
      const tombstone = transaction
        .select({ runId: runTombstones.runId })
        .from(runTombstones)
        .where(eq(runTombstones.runId, trace.run.id))
        .limit(1)
        .get();

      if (tombstone) continue;
      const existingRun = transaction.select().from(runs).where(eq(runs.id, trace.run.id)).limit(1).get();
      const runValues = {
        id: trace.run.id,
        name: trace.run.name,
        status: trace.run.status,
        startedAt: trace.run.startedAt ?? new Date().toISOString(),
        endedAt: trace.run.endedAt,
        inputJson: stringifyJson(redactSensitiveValue(trace.run.input, privacy)),
        outputJson: stringifyJson(redactSensitiveValue(trace.run.output, privacy)),
        error: trace.run.error,
        metadataJson: stringifyJson(redactSensitiveValue(trace.run.metadata, privacy))
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
          inputJson: stringifyJson(redactSensitiveValue(event.input, privacy)),
          outputJson: stringifyJson(redactSensitiveValue(event.output, privacy)),
          errorJson: stringifyJson(redactSensitiveValue(event.error, privacy)),
          metadataJson: stringifyJson(redactSensitiveValue(event.metadata, privacy))
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

    publishChange("event");
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

function hasTrackedContent(summary: EventSummary | undefined) {
  return summary !== undefined && getSummaryActionTotal(summary) > 0;
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

function getObjectString(value: unknown, key: string) {
  const item = asRecord(value)[key];

  return typeof item === "string" && item.length > 0 ? item : undefined;
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
