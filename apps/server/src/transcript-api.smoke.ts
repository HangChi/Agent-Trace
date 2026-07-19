import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const databasePath = join(tmpdir(), `agent-trace-transcript-api-${Date.now()}.db`);
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
  const sessionId = "transcript-session";
  const workBuddySessionId = "workbuddy-session";
  const payload = {
    source: "tokscale",
    complete: true,
    scannedAt: "2026-07-12T12:00:00.000Z",
    reconciledClients: ["codex", "workbuddy"],
    transcriptClients: ["codex", "workbuddy"],
    transcriptSessionIds: [`codex:${sessionId}`, `workbuddy:${workBuddySessionId}`],
    rows: [usageRow("codex", sessionId), usageRow("workbuddy", workBuddySessionId)],
    transcripts: [
      {
        client: "codex",
        sessionId,
        title: "Fix the trace",
        model: "gpt-5.5",
        provider: "openai",
        startedAt: "2026-07-12T11:00:00.000Z",
        lastUsedAt: "2026-07-12T11:00:05.000Z",
        events: [
          {
            kind: "prompt",
            timestamp: "2026-07-12T11:00:00.000Z",
            text: "fix the trace"
          },
          {
            kind: "turn",
            timestamp: "2026-07-12T11:00:05.000Z",
            tokens: {
              input: 100,
              output: 20,
              cacheRead: 300,
              cacheWrite: 0,
              reasoning: 5,
              total: 420
            },
            tools: ["exec_command"],
            costUsd: 0.42,
            costEstimated: true
          }
        ]
      },
      {
        client: "workbuddy",
        sessionId: workBuddySessionId,
        title: "WorkBuddy session",
        model: "deepseek-v4-pro",
        provider: "workbuddy",
        startedAt: "2026-07-12T11:30:00.000Z",
        lastUsedAt: "2026-07-12T11:30:05.000Z",
        events: [
          {
            kind: "prompt",
            timestamp: "2026-07-12T11:30:00.000Z",
            text: "inspect the workspace"
          },
          {
            kind: "turn",
            timestamp: "2026-07-12T11:30:05.000Z",
            tokens: {
              input: 40,
              output: 20,
              cacheRead: 60,
              cacheWrite: 0,
              reasoning: 0,
              total: 120
            },
            tools: ["Read"]
          }
        ]
      }
    ]
  };

  await postScan(app, payload);
  await postScan(app, payload);

  const runs = runRows(await json(app.request("/runs?includeUntracked=1")));
  const run = runs.find((item: any) => item.id === `run_codex_${sessionId}`);
  const workBuddyRun = runs.find((item: any) => item.id === `run_workbuddy_${workBuddySessionId}`);
  if (!run || run.name !== "Fix the trace" || !workBuddyRun || workBuddyRun.name !== "WorkBuddy session") {
    throw new Error("Expected Codex and WorkBuddy transcript-backed usage sessions to become runs.");
  }

  const workBuddyEvents = eventRows(await json(
    app.request(`/runs/run_workbuddy_${workBuddySessionId}/events?visibility=all&page=1&pageSize=100`)
  ));
  if (!workBuddyEvents.some((event: any) => event.name === "Read")) {
    throw new Error("Expected WorkBuddy tools to remain visible as tracked events.");
  }

  await json(
    app.request(`/runs/run_codex_${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "success", endedAt: "2026-07-13T11:58:47.368Z" })
    })
  );
  const repairedRuns = runRows(await json(app.request("/runs?includeUntracked=1")));
  const repairedRun = repairedRuns.find((item: any) => item.id === `run_codex_${sessionId}`);
  if (repairedRun?.endedAt !== "2026-07-12T11:00:05.000Z") {
    throw new Error("Expected transcript duration to end at the last real event timestamp.");
  }

  const events = eventRows(await json(
    app.request(`/runs/run_codex_${sessionId}/events?visibility=all&page=1&pageSize=100`)
  ));
  if (
    events.length !== 3 ||
    events.filter((event: any) => event.metadata?.source === "transcript").length !== 3 ||
    events.find((event: any) => event.name === "user_prompt")?.input?.promptPreview !== "fix the trace" ||
    events.find((event: any) => event.name === "assistant_turn")?.metadata?.tokenUsage?.total !== 420 ||
    !events.some((event: any) => event.name === "exec_command")
  ) {
    throw new Error("Expected one deterministic prompt, turn, and tool event from the transcript.");
  }

  await expectAccepted(
    app.request("/integrations/codex/hook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        hook_event_name: "PreToolUse",
        tool_name: "Shell",
        tool_input: { command: "git status" }
      })
    })
  );
  await json(
    app.request(`/runs/run_codex_${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `codex:${sessionId}` })
    })
  );
  await postScan(app, payload);
  const renamedRun = runRows(await json(app.request("/runs?includeUntracked=1")))
    .find((item: any) => item.id === `run_codex_${sessionId}`);
  if (renamedRun?.name !== "Fix the trace") {
    throw new Error("Expected transcript scan to replace a generated hook Run name.");
  }

  const visible = await json(
    app.request(`/runs/run_codex_${sessionId}/events?visibility=display&page=1&pageSize=100`)
  );
  if (
    !visible.events.some((event: any) => event.metadata?.source !== "transcript" && event.name === "Shell command") ||
    visible.events.some((event: any) => event.metadata?.source === "transcript")
  ) {
    throw new Error("Expected actionable live events to supersede transcript fallback events.");
  }

  const allEvents = await json(
    app.request(`/runs/run_codex_${sessionId}/events?visibility=all&page=1&pageSize=100`)
  );
  if (!allEvents.events.some((event: any) => event.metadata?.source === "transcript")) {
    throw new Error("Expected transcript fallback events to remain available as other events.");
  }

  console.log("Agent-Trace transcript API smoke test passed.");
} finally {
  closeDatabase?.();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
}

function usageRow(client: string, sessionId: string) {
  return {
    client,
    sessionId,
    model: "gpt-5.5",
    provider: "openai",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 300,
    cacheWriteTokens: 0,
    reasoningTokens: 5,
    totalTokens: 420,
    costUsd: 0.42
  };
}

async function postScan(app: { request: (path: string, init: RequestInit) => Response | Promise<Response> }, body: unknown) {
  await expectAccepted(
    app.request("/integrations/usage-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

async function expectAccepted(response: Response | Promise<Response>) {
  const resolved = await response;
  if (resolved.status !== 202) throw new Error(`Expected 202, received ${resolved.status}.`);
}

async function json(response: Response | Promise<Response>) {
  return (await response).json() as Promise<any>;
}

function runRows(payload: any) {
  return Array.isArray(payload) ? payload : payload.runs;
}

function eventRows(payload: any) {
  return Array.isArray(payload) ? payload : payload.events;
}
