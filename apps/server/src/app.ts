import {
  analyticsDimensionSchema,
  createAnalyticsBudgetSchema,
  createEvaluationCaseSchema,
  createEvaluationDatasetSchema,
  createEvaluationResultSchema,
  createRunSchema,
  createTraceEventSchema,
  privacySettingsSchema,
  runOrganizationSchema,
  createReplayTaskSchema,
  updateRunSchema
} from "@agent-trace/schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";

import {
  ingestAgentHook,
  ingestCodexOtelLogs,
  ingestUsageScan,
  type AgentHookSource
} from "./agent-hooks.js";
import {
  createEvent,
  createEvaluationCase,
  createEvaluationDataset,
  createRun,
  compactDatabase,
  createAnalyticsBudget,
  compareRunEvents,
  compareRuns,
  deleteRun,
  deleteAnalyticsBudget,
  deleteRuns,
  exportRedactedRun,
  getDashboardRunById,
  getAnalyticsBreakdown,
  getAnalyticsBudgetAlerts,
  getEvaluationDatasetReport,
  getPrivacySettings,
  getStorageStats,
  getRunTrends,
  getTraceInsights,
  listEventsByRunId,
  listAnalyticsBudgets,
  listEvaluationDatasets,
  listEventsPageByRunId,
  listRunTombstones,
  listRuns,
  listRunsPage,
  pruneRuns,
  recordEvaluationResult,
  restoreDeletedRun,
  updatePrivacySettings,
  updateRun,
  updateRunOrganization
} from "./storage.js";
import { getScannerStatus, getUsageSummary } from "./usage-storage.js";
import { getCurrentRevision, subscribeToChanges } from "./change-feed.js";
import { ingestOtlpTraces } from "./otlp-traces.js";
import {
  cancelReplayTask,
  createReplayTask,
  getReplayTask,
  listReplayTasks,
  ReplaySandboxError
} from "./replay-sandbox.js";

const loopbackDashboardOrigin = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/;

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({ origin: (origin) => (loopbackDashboardOrigin.test(origin) ? origin : undefined) })
  );

  app.get("/health", (c) => {
    return c.json({ ok: true, service: "agent-trace" });
  });

  app.get("/changes", (c) => streamSSE(c, async (stream) => {
    const revision = getCurrentRevision();
    await stream.writeSSE({
      event: "ready",
      id: String(revision),
      data: JSON.stringify({ revision })
    });

    await new Promise<void>((resolve) => {
      const unsubscribe = subscribeToChanges((event) => {
        void stream.writeSSE({
          event: "change",
          id: String(event.revision),
          data: JSON.stringify(event)
        });
      });

      stream.onAbort(() => {
        unsubscribe();
        resolve();
      });
    });
  }));

  app.post("/runs", async (c) => {
    const body = await readJson(c.req);
    const parsed = createRunSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "invalid_run", issues: parsed.error.issues }, 400);
    }

    const created = await createRun(parsed.data);

    if (!created) {
      return c.json({ error: "run_tombstoned" }, 409);
    }

    return c.json({ ok: true }, 201);
  });

  app.patch("/runs/:id", async (c) => {
    const body = await readJson(c.req);
    const parsed = updateRunSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "invalid_run_update", issues: parsed.error.issues }, 400);
    }

    await updateRun(c.req.param("id"), parsed.data);

    return c.json({ ok: true });
  });

  app.post("/events", async (c) => {
    const body = await readJson(c.req);
    const parsed = createTraceEventSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "invalid_trace_event", issues: parsed.error.issues }, 400);
    }

    await createEvent(parsed.data);

    return c.json({ ok: true }, 201);
  });

  app.post("/integrations/codex/hook", async (c) => {
    return ingestHook(c, "codex");
  });

  app.post("/integrations/codex/otel/v1/logs", async (c) => {
    return ingestCodexOtel(c);
  });

  app.post("/v1/logs", async (c) => {
    return ingestCodexOtel(c, {
      surface: "desktop",
      surfaceSource: "default-v1-logs"
    });
  });

  app.post("/integrations/claude-code/hook", async (c) => {
    return ingestHook(c, "claude-code");
  });

  app.post("/integrations/usage-scan", async (c) => {
    return ingestUsageScanRequest(c);
  });

  app.get("/usage/summary", async (c) => c.json(await getUsageSummary()));

  app.get("/usage/scanner", async (c) => c.json(await getScannerStatus()));

  app.get("/analytics/runs/compare", async (c) => {
    const ids = parseComparisonIds(c.req.query("ids"));

    if (!ids) {
      return c.json({ error: "comparison_requires_2_to_5_runs" }, 400);
    }

    const [runs, eventDiffs] = await Promise.all([
      compareRuns(ids),
      compareRunEvents(ids)
    ]);

    return c.json({
      runs,
      eventDiffs,
      regressionCount: eventDiffs.reduce((total, diff) => total + diff.regressions.length, 0)
    });
  });

  app.post("/v1/traces", async (c) => {
    const result = await ingestOtlpTraces(await readJson(c.req));
    return c.json({ ok: true, ...result }, 202);
  });

  app.post("/integrations/otlp/v1/traces", async (c) => {
    const result = await ingestOtlpTraces(await readJson(c.req));
    return c.json({ ok: true, ...result }, 202);
  });

  app.get("/analytics/runs/trends", async (c) => {
    return c.json(await getRunTrends(parseAnalyticsDays(c.req.query("days"))));
  });

  app.get("/analytics/breakdown", async (c) => {
    const dimension = analyticsDimensionSchema.safeParse(c.req.query("dimension") ?? "project");
    if (!dimension.success) return c.json({ error: "invalid_analytics_dimension" }, 400);
    return c.json(await getAnalyticsBreakdown(
      parseAnalyticsDays(c.req.query("days")),
      dimension.data
    ));
  });

  app.get("/analytics/budgets", async (c) => c.json({
    budgets: await listAnalyticsBudgets()
  }));

  app.post("/analytics/budgets", async (c) => {
    const parsed = createAnalyticsBudgetSchema.safeParse(await readJson(c.req));
    if (!parsed.success) {
      return c.json({ error: "invalid_analytics_budget", issues: parsed.error.issues }, 400);
    }
    return c.json(await createAnalyticsBudget(parsed.data), 201);
  });

  app.delete("/analytics/budgets/:id", async (c) => {
    const deleted = await deleteAnalyticsBudget(c.req.param("id"));
    return deleted ? c.json({ ok: true }) : c.json({ error: "analytics_budget_not_found" }, 404);
  });

  app.get("/analytics/alerts", async (c) => c.json({
    alerts: await getAnalyticsBudgetAlerts()
  }));

  app.get("/sandbox/replays", (c) => c.json({
    tasks: listReplayTasks(c.req.query("sourceRunId"), parseNumber(c.req.query("limit")))
  }));

  app.post("/sandbox/replays", async (c) => {
    const parsed = createReplayTaskSchema.safeParse(await readJson(c.req));
    if (!parsed.success) {
      return c.json({ error: "invalid_replay_task", issues: parsed.error.issues }, 400);
    }
    try {
      return c.json({ task: await createReplayTask(parsed.data) }, 202);
    } catch (error) {
      if (error instanceof ReplaySandboxError) {
        return c.json({ error: error.code }, error.status);
      }
      throw error;
    }
  });

  app.get("/sandbox/replays/:id", (c) => {
    const task = getReplayTask(c.req.param("id"));
    return task ? c.json({ task }) : c.json({ error: "replay_task_not_found" }, 404);
  });

  app.delete("/sandbox/replays/:id", (c) => {
    try {
      const task = cancelReplayTask(c.req.param("id"));
      return task ? c.json({ task }) : c.json({ error: "replay_task_not_found" }, 404);
    } catch (error) {
      if (error instanceof ReplaySandboxError) {
        return c.json({ error: error.code }, error.status);
      }
      throw error;
    }
  });

  app.get("/evaluations/datasets", async (c) => c.json({
    datasets: await listEvaluationDatasets()
  }));

  app.post("/evaluations/datasets", async (c) => {
    const parsed = createEvaluationDatasetSchema.safeParse(await readJson(c.req));
    if (!parsed.success) {
      return c.json({ error: "invalid_evaluation_dataset", issues: parsed.error.issues }, 400);
    }
    return c.json(await createEvaluationDataset(parsed.data), 201);
  });

  app.get("/evaluations/datasets/:id", async (c) => {
    const report = await getEvaluationDatasetReport(c.req.param("id"));
    return report ? c.json(report) : c.json({ error: "evaluation_dataset_not_found" }, 404);
  });

  app.post("/evaluations/datasets/:id/cases", async (c) => {
    const parsed = createEvaluationCaseSchema.safeParse(await readJson(c.req));
    if (!parsed.success) {
      return c.json({ error: "invalid_evaluation_case", issues: parsed.error.issues }, 400);
    }
    const evaluationCase = await createEvaluationCase(c.req.param("id"), parsed.data);
    return evaluationCase
      ? c.json(evaluationCase, 201)
      : c.json({ error: "evaluation_dataset_not_found" }, 404);
  });

  app.post("/evaluations/results", async (c) => {
    const parsed = createEvaluationResultSchema.safeParse(await readJson(c.req));
    if (!parsed.success) {
      return c.json({ error: "invalid_evaluation_result", issues: parsed.error.issues }, 400);
    }
    const result = await recordEvaluationResult(parsed.data);
    return result
      ? c.json(result, 201)
      : c.json({ error: "evaluation_case_or_run_not_found" }, 404);
  });

  app.get("/runs", async (c) => {
    const includeUntracked = ["1", "true"].includes(c.req.query("includeUntracked") ?? "");
    if (isLegacyQuery(c.req.query("legacy"))) {
      return c.json(await listRuns({ includeUntracked }));
    }

    return c.json(
      await listRunsPage({
        includeUntracked,
        page: parseNumber(c.req.query("page")),
        pageSize: parseNumber(c.req.query("pageSize")),
        q: c.req.query("q"),
        status: c.req.query("status"),
        source: c.req.query("source"),
        model: c.req.query("model"),
        project: c.req.query("project"),
        environment: c.req.query("environment"),
        tag: c.req.query("tag"),
        favorite: parseBoolean(c.req.query("favorite")),
        startedAfter: parseDate(c.req.query("startedAfter")),
        startedBefore: parseDate(c.req.query("startedBefore"), true),
        minCostUsd: parseNumber(c.req.query("minCostUsd")),
        maxCostUsd: parseNumber(c.req.query("maxCostUsd")),
        sort: parseRunSort(c.req.query("sort")),
        order: c.req.query("order") === "asc" ? "asc" : "desc"
      })
    );
  });

  app.delete("/runs", async (c) => {
    const ids = parseRunIds(await readJson(c.req));

    if (!ids) {
      return c.json({ error: "invalid_run_ids" }, 400);
    }

    const deleted = await deleteRuns(ids);

    return c.json({ ok: true, deleted });
  });

  app.get("/runs/:id/events", async (c) => {
    if (isLegacyQuery(c.req.query("legacy"))) {
      const events = await listEventsByRunId(c.req.param("id"));

      return c.json(events);
    }

    const result = await listEventsPageByRunId(c.req.param("id"), {
      visibility: parseVisibility(c.req.query("visibility")),
      page: parseNumber(c.req.query("page")),
      pageSize: parseNumber(c.req.query("pageSize")),
      q: c.req.query("q"),
      status: c.req.query("status"),
      type: c.req.query("type"),
      category: c.req.query("category")
    });

    return c.json(result);
  });

  app.get("/runs/:id/export", async (c) => {
    const result = await exportRedactedRun(c.req.param("id"));

    if (!result) {
      return c.json({ error: "run_not_found" }, 404);
    }

    c.header("content-disposition", `attachment; filename="agent-trace-${result.run.id}.json"`);
    c.header("content-type", "application/json; charset=UTF-8");
    return c.body(JSON.stringify(result, null, 2));
  });

  app.get("/runs/:id", async (c) => {
    const run = await getDashboardRunById(c.req.param("id"));

    if (!run) {
      return c.json({ error: "run_not_found" }, 404);
    }

    return c.json(run);
  });

  app.patch("/runs/:id/organization", async (c) => {
    const parsed = runOrganizationSchema.safeParse(await readJson(c.req));

    if (!parsed.success) {
      return c.json({ error: "invalid_run_organization", issues: parsed.error.issues }, 400);
    }
    const updated = await updateRunOrganization(c.req.param("id"), parsed.data);

    return updated ? c.json({ ok: true }) : c.json({ error: "run_not_found" }, 404);
  });

  app.get("/runs/:id/insights", async (c) => {
    return c.json({ insights: await getTraceInsights(c.req.param("id")) });
  });

  app.delete("/runs/:id", async (c) => {
    const deleted = await deleteRun(c.req.param("id"));

    if (!deleted) {
      return c.json({ error: "run_not_found" }, 404);
    }

    return c.json({ ok: true });
  });

  app.delete("/runs/:id/tombstone", async (c) => {
    const restored = await restoreDeletedRun(c.req.param("id"));

    return restored
      ? c.json({ ok: true })
      : c.json({ error: "tombstone_not_found" }, 404);
  });

  app.get("/maintenance/storage", async (c) => c.json(await getStorageStats()));

  app.get("/maintenance/tombstones", async (c) => {
    return c.json({ tombstones: await listRunTombstones(parseNumber(c.req.query("limit"))) });
  });

  app.get("/maintenance/privacy", (c) => c.json(getPrivacySettings()));

  app.put("/maintenance/privacy", async (c) => {
    const parsed = privacySettingsSchema.safeParse(await readJson(c.req));

    if (!parsed.success) {
      return c.json({ error: "invalid_privacy_settings", issues: parsed.error.issues }, 400);
    }

    return c.json(await updatePrivacySettings(parsed.data));
  });

  app.post("/maintenance/prune", async (c) => {
    const body = asRecord(await readJson(c.req));
    const before = parseDate(typeof body.before === "string" ? body.before : undefined);

    if (!before) return c.json({ error: "invalid_prune_before" }, 400);
    const statuses = Array.isArray(body.statuses)
      ? body.statuses.filter((value): value is string => typeof value === "string")
      : undefined;
    const deleted = await pruneRuns({
      before,
      statuses,
      keepTombstones: body.keepTombstones !== false
    });

    return c.json({ ok: true, deleted });
  });

  app.post("/maintenance/compact", (c) => {
    compactDatabase();
    return c.json({ ok: true });
  });

  return app;
}

function isLegacyQuery(value: string | undefined) {
  return value === "1" || value === "true";
}

function parseBoolean(value: string | undefined) {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}

function parseComparisonIds(value: string | undefined) {
  const ids = [...new Set(
    (value ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  )];

  return ids.length >= 2 && ids.length <= 5 ? ids : undefined;
}

function parseAnalyticsDays(value: string | undefined) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.min(90, Math.floor(parsed)) : 14;
}

function parseVisibility(value: string | undefined) {
  return value === "hidden" || value === "all" ? value : "display";
}

function parseNumber(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDate(value: string | undefined, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(value);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  const timestamp = date.getTime();

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function parseRunSort(value: string | undefined) {
  return value === "name" || value === "status" || value === "duration" ||
    value === "tokens" || value === "cost" || value === "startedAt"
    ? value
    : undefined;
}

async function ingestHook(
  c: {
    req: { json: () => Promise<unknown>; query: (name: string) => string | undefined };
    json: (value: unknown, status?: number) => Response;
  },
  source: AgentHookSource
) {
  const body = await readJson(c.req);

  try {
    const result = await ingestAgentHook(source, body, getIngestHints(c.req));

    return c.json({ ok: true, ...result }, 202);
  } catch (error) {
    return c.json(
      {
        ok: true,
        stored: false,
        error: error instanceof Error ? error.message : String(error)
      },
      202
    );
  }
}

async function ingestCodexOtel(
  c: {
    req: { json: () => Promise<unknown>; query: (name: string) => string | undefined };
    json: (value: unknown, status?: number) => Response;
  },
  defaultHints: { surface?: string; surfaceSource?: string } = {}
) {
  const body = await readJson(c.req);

  try {
    const result = await ingestCodexOtelLogs(body, getIngestHints(c.req, defaultHints));

    return c.json({ ok: true, ...result }, 202);
  } catch (error) {
    return c.json(
      {
        ok: true,
        stored: 0,
        error: error instanceof Error ? error.message : String(error)
      },
      202
    );
  }
}

async function ingestUsageScanRequest(
  c: {
    req: { json: () => Promise<unknown> };
    json: (value: unknown, status?: number) => Response;
  }
) {
  const body = await readJson(c.req);

  try {
    const result = await ingestUsageScan(body);

    return c.json({ ok: true, ...result }, 202);
  } catch (error) {
    return c.json(
      {
        ok: true,
        stored: 0,
        error: error instanceof Error ? error.message : String(error)
      },
      202
    );
  }
}

function getIngestHints(
  request: { query: (name: string) => string | undefined },
  defaults: { surface?: string; surfaceSource?: string } = {}
) {
  return {
    surface: request.query("surface") ?? defaults.surface,
    surfaceSource:
      request.query("surface_source") ?? request.query("surfaceSource") ?? defaults.surfaceSource
  };
}

async function readJson(request: { json: () => Promise<unknown> }) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function parseRunIds(value: unknown) {
  const ids = asRecord(value).ids;

  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== "string" || id.trim().length === 0)
  ) {
    return undefined;
  }

  return [...new Set(ids.map((id) => id.trim()))];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
