import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), `agent-trace-otlp-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = databasePath;

const storage = await import("./storage.js");
const { createApp } = await import("./app.js");
const { db } = await import("./db.js");
storage.initializeDatabase(databasePath);
const app = createApp();

try {
  const response = await app.request("/v1/traces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      resourceSpans: [{
        resource: { attributes: [
          { key: "service.name", value: { stringValue: "checkout-agent" } },
          { key: "deployment.environment.name", value: { stringValue: "production" } }
        ] },
        scopeSpans: [{ spans: [
          {
            traceId: "trace-1",
            spanId: "root-span",
            name: "checkout",
            startTimeUnixNano: "1784109600000000000",
            endTimeUnixNano: "1784109602000000000",
            status: { code: 1 }
          },
          {
            traceId: "trace-1",
            spanId: "model-span",
            parentSpanId: "root-span",
            name: "call-model",
            startTimeUnixNano: "1784109600500000000",
            endTimeUnixNano: "1784109601500000000",
            status: { code: 1 },
            attributes: [
              { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
              { key: "gen_ai.request.model", value: { stringValue: "gpt-5" } },
              { key: "gen_ai.usage.input_tokens", value: { intValue: "60" } },
              { key: "gen_ai.usage.output_tokens", value: { intValue: "40" } }
            ]
          }
        ] }]
      }]
    })
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, runs: 1, events: 2 });

  const runResponse = await app.request("/runs/otlp%3Atrace-1");
  assert.equal(runResponse.status, 200);
  const run = await runResponse.json() as {
    name: string;
    status: string;
    metadata: { source: string; project: string; environment: string };
  };
  assert.equal(run.name, "checkout-agent");
  assert.equal(run.status, "success");
  assert.equal(run.metadata.source, "otlp");
  assert.equal(run.metadata.project, "checkout-agent");
  assert.equal(run.metadata.environment, "production");

  const eventsResponse = await app.request("/runs/otlp%3Atrace-1/events?legacy=1");
  assert.equal(eventsResponse.status, 200);
  const events = await eventsResponse.json() as Array<{
    id: string;
    parentId?: string;
    type: string;
    name: string;
    durationMs: number;
    metadata?: { model?: string; tokenUsage?: { input: number; output: number; total: number } };
  }>;
  assert.deepEqual(events.map((event) => ({
    id: event.id,
    parentId: event.parentId,
    type: event.type,
    name: event.name,
    durationMs: event.durationMs,
    model: event.metadata?.model,
    tokenUsage: event.metadata?.tokenUsage ? {
      input: event.metadata.tokenUsage.input,
      output: event.metadata.tokenUsage.output,
      total: event.metadata.tokenUsage.total
    } : undefined
  })), [
    {
      id: "otlp:root-span",
      parentId: undefined,
      type: "step_ended",
      name: "checkout",
      durationMs: 2000,
      model: undefined,
      tokenUsage: undefined
    },
    {
      id: "otlp:model-span",
      parentId: "otlp:root-span",
      type: "llm_call",
      name: "call-model",
      durationMs: 1000,
      model: "gpt-5",
      tokenUsage: { input: 60, output: 40, total: 100 }
    }
  ]);
} finally {
  db.$client.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
}

console.log("OTLP traces smoke passed");
