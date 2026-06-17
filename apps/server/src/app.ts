import { createRunSchema, createTraceEventSchema, updateRunSchema } from "@tooltrace/schema";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { ingestAgentHook, type AgentHookSource } from "./agent-hooks.js";
import { createEvent, createRun, deleteRun, listEventsByRunId, listRuns, updateRun } from "./storage.js";

export function createApp() {
  const app = new Hono();

  app.use("*", cors());

  app.get("/health", (c) => {
    return c.json({ ok: true });
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

  app.post("/integrations/claude-code/hook", async (c) => {
    return ingestHook(c, "claude-code");
  });

  app.get("/runs", async (c) => {
    const runs = await listRuns();

    return c.json(runs);
  });

  app.get("/runs/:id/events", async (c) => {
    const events = await listEventsByRunId(c.req.param("id"));

    return c.json(events);
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

async function ingestHook(
  c: { req: { json: () => Promise<unknown> }; json: (value: unknown, status?: number) => Response },
  source: AgentHookSource
) {
  const body = await readJson(c.req);

  try {
    const result = await ingestAgentHook(source, body);

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

async function readJson(request: { json: () => Promise<unknown> }) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
