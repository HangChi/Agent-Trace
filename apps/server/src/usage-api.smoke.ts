import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const databasePath = join(tmpdir(), `agent-trace-usage-api-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = databasePath;
let closeDatabase: (() => void) | undefined;

try {
  const [{ createApp }, { initializeDatabase }, { db }] = await Promise.all([
    import("./app.js"),
    import("./storage.js"),
    import("./db.js")
  ]);
  closeDatabase = () => db.$client.close();
  initializeDatabase(databasePath);
  const app = createApp();
  const sessionId = "usage-api-session";

  await expectStatus(
    app.request("/integrations/codex/hook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        hook_event_name: "UserPromptSubmit",
        prompt: "real traced prompt",
        model: "gpt-5.5"
      })
    }),
    202,
    "Codex hook"
  );

  await expectStatus(
    app.request("/integrations/usage-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "tokscale",
        complete: true,
        scannedAt: "2026-07-12T11:00:00.000Z",
        reconciledClients: ["codex", "workbuddy", "kiro"],
        rows: [
          usageRow("codex", sessionId, 4200, 0.42),
          usageRow("workbuddy", "usage-only", 500, 0.05),
          usageRow("kiro", "false-positive", 800, 0.08),
          usageRow("micode", "imported-claude", 900, 0.09)
        ],
        diagnostics: [
          { client: "codex", status: "available", pathExists: true },
          { client: "workbuddy", status: "available", pathExists: true },
          { client: "kiro", status: "available", pathExists: false, messageCount: 377 },
          { client: "micode", status: "available", pathExists: true, messageCount: 20 }
        ]
      })
    }),
    202,
    "usage snapshot"
  );

  const usage = await json(app.request("/usage/summary"));
  if (usage.totalTokens !== 4700 || usage.costUsd !== 0.47) {
    throw new Error("Expected the usage summary endpoint to include aggregate-only clients.");
  }

  const scanner = await json(app.request("/usage/scanner"));
  if (
    scanner.scannedAt !== "2026-07-12T11:00:00.000Z" ||
    scanner.diagnostics.find((item: { client?: string }) => item.client === "kiro")?.status !== "missing"
  ) {
    throw new Error("Expected scanner diagnostics from the dedicated endpoint.");
  }

  const runs = await json(app.request("/runs?includeUntracked=1"));
  if (!Array.isArray(runs) || runs.some((run) => run.input?.source === "usage-scan")) {
    throw new Error("Expected /runs to exclude every scanner-only record.");
  }

  if (runs.some((run) => run.metadata?.agent === "workbuddy" || run.metadata?.agent === "usage-scan")) {
    throw new Error("Expected aggregate-only clients and scanner status to stay out of recent runs.");
  }

  const codexRun = runs.find((run) => run.id === `run_codex_${sessionId}`);
  if (
    codexRun?.metadata?.summary?.tokenUsage?.total !== 4200 ||
    codexRun.metadata.summary.costUsd !== 0.42 ||
    codexRun.metadata.summary.tokenUsage.sourceKind !== "scan" ||
    codexRun.metadata.summary.tokenUsage.scope !== "session"
  ) {
    throw new Error("Expected a matching usage snapshot to authoritatively enrich a real run.");
  }

  const events = await json(app.request(`/runs/run_codex_${sessionId}/events`));
  if (!Array.isArray(events) || events.some((event) => event.metadata?.source === "usage-scan")) {
    throw new Error("Expected usage snapshots to avoid creating trace events.");
  }

  console.log("Agent-Trace usage API smoke test passed.");
} finally {
  closeDatabase?.();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
}

function usageRow(client: string, sessionId: string, totalTokens: number, costUsd: number) {
  return {
    client,
    sessionId,
    model: "gpt-5.5",
    provider: "openai",
    inputTokens: totalTokens - 200,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 50,
    totalTokens,
    costUsd,
    messageCount: 2,
    startedAt: "2026-07-12T10:00:00.000Z",
    lastUsedAt: "2026-07-12T10:01:00.000Z"
  };
}

async function expectStatus(response: Response | Promise<Response>, status: number, label: string) {
  const resolved = await response;
  if (resolved.status !== status) {
    throw new Error(`Expected ${label} to return ${status}, received ${resolved.status}.`);
  }
}

async function json(response: Response | Promise<Response>) {
  return (await response).json() as Promise<any>;
}
