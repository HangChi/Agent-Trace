import { createRunSchema, createTraceEventSchema, updateRunSchema } from "@agent-trace/schema";
import { Hono } from "hono";
import { cors } from "hono/cors";

import {
  ingestAgentHook,
  ingestCodexOtelLogs,
  ingestUsageScan,
  type AgentHookSource
} from "./agent-hooks.js";
import {
  createEvent,
  createRun,
  deleteRun,
  deleteRuns,
  listEventsByRunId,
  listEventsPageByRunId,
  listRuns,
  updateRun
} from "./storage.js";

export function createApp() {
  const app = new Hono();

  app.use("*", cors());

  app.get("/health", (c) => {
    return c.json({ ok: true, service: "agent-trace" });
  });

  app.post("/runs", async (c) => {
    const body = await readJson(c.req);
    const parsed = createRunSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "invalid_run", issues: parsed.error.issues }, 400);
    }

    await createRun(parsed.data);

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

  app.get("/runs", async (c) => {
    const includeUntracked = ["1", "true"].includes(c.req.query("includeUntracked") ?? "");
    const runs = await listRuns({ includeUntracked });

    return c.json(runs);
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
    if (!hasEventListQuery(c.req)) {
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

  app.delete("/runs/:id", async (c) => {
    const deleted = await deleteRun(c.req.param("id"));

    if (!deleted) {
      return c.json({ error: "run_not_found" }, 404);
    }

    return c.json({ ok: true });
  });

  return app;
}

function hasEventListQuery(request: { query: (name: string) => string | undefined }) {
  return ["visibility", "page", "pageSize", "q", "status", "type", "category"].some(
    (name) => request.query(name) !== undefined
  );
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
