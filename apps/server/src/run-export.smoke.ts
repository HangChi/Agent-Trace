import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), `agent-trace-run-export-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = databasePath;

const storage = await import("./storage.js");
const { createApp } = await import("./app.js");
const { db } = await import("./db.js");
storage.initializeDatabase(databasePath);

try {
  await storage.createRun({
    id: "secret-session-id",
    name: "deploy sk-live-secret",
    status: "error",
    startedAt: "2026-07-15T01:00:00.000Z",
    endedAt: "2026-07-15T01:00:03.000Z",
    input: { prompt: "read C:\\Users\\alice\\private.txt" },
    output: { token: "sk-live-secret" },
    error: "failed with sk-live-secret",
    metadata: {
      agent: "codex",
      model: "gpt-5",
      sessionId: "private-session",
      cwd: "C:\\Users\\alice\\workspace"
    }
  });
  await storage.createEvent({
    id: "private-event-id",
    runId: "secret-session-id",
    type: "tool_call",
    name: "powershell C:\\Users\\alice",
    status: "error",
    timestamp: "2026-07-15T01:00:01.000Z",
    durationMs: 2000,
    input: { command: "echo sk-live-secret" },
    output: { stdout: "private output" },
    error: { message: "private failure", stack: "C:\\Users\\alice\\trace.ts:1" },
    metadata: {
      category: "tool",
      toolName: "shell_command",
      command: "echo sk-live-secret",
      tokenUsage: Object.assign(
        { input: 10, output: 5, total: 15 },
        { credential: "nested-secret" }
      ),
      costUsd: 0.25,
      sessionId: "private-session"
    }
  });

  const response = await createApp().request("/runs/secret-session-id/export");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /attachment/);

  const body = await response.json() as {
    redaction?: string;
    run?: { id?: string; name?: string; error?: unknown; input?: unknown; output?: unknown };
    events?: Array<{
      id?: string;
      runId?: string;
      name?: string;
      input?: unknown;
      output?: unknown;
      error?: unknown;
      metadata?: Record<string, unknown>;
    }>;
  };
  const serialized = JSON.stringify(body);

  assert.equal(body.redaction, "metadata");
  assert.match(body.run?.id ?? "", /^run-[a-f0-9]{12}$/);
  assert.equal(body.run?.name, "redacted-run");
  assert.equal(body.events?.[0]?.runId, body.run?.id);
  assert.match(body.events?.[0]?.id ?? "", /^event-[a-f0-9]{12}$/);
  assert.equal(body.events?.[0]?.name, "tool_call");
  assert.equal(body.events?.[0]?.metadata?.toolName, "shell_command");
  assert.deepEqual(body.events?.[0]?.metadata?.tokenUsage, { input: 10, output: 5, total: 15 });
  assert.equal(body.events?.[0]?.metadata?.costUsd, 0.25);
  for (const sensitive of [
    "sk-live-secret",
    "private-session",
    "private output",
    "private failure",
    "Users\\\\alice",
    "secret-session-id",
    "private-event-id",
    "nested-secret"
  ]) {
    assert.equal(serialized.includes(sensitive), false, `export leaked ${sensitive}`);
  }
} finally {
  db.$client.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
}

console.log("run export smoke passed");
