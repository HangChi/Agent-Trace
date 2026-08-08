import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const databasePath = join(tmpdir(), `agent-trace-transcript-api-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = databasePath;
let closeDatabase: (() => void) | undefined;

try {
  const [
    { createApp },
    { initializeDatabase },
    { db },
    { events: eventTable, runs: runTable }
  ] = await Promise.all([
    import("./app.js"),
    import("./storage.js"),
    import("./db.js"),
    import("./schema.js")
  ]);
  closeDatabase = () => db.$client.close();
  initializeDatabase(databasePath);
  const app = createApp();
  const sessionId = "transcript-session";
  const liveSessionId = "live-transcript-session";
  const workBuddySessionId = "workbuddy-session";
  const claudeSessionId = "claude-session";
  const liveTranscript = {
    client: "codex",
    sessionId: liveSessionId,
    title: "Readable Codex title",
    model: "gpt-5.5",
    provider: "openai",
    startedAt: "2026-07-12T10:30:00.000Z",
    lastUsedAt: "2026-07-12T10:30:05.000Z",
    events: [
      {
        kind: "prompt",
        timestamp: "2026-07-12T10:30:00.000Z",
        text: "start the live trace"
      },
      {
        kind: "turn",
        timestamp: "2026-07-12T10:30:05.000Z",
        tokens: {
          input: 50,
          output: 10,
          cacheRead: 100,
          cacheWrite: 0,
          reasoning: 0,
          total: 160
        },
        tools: []
      }
    ]
  };
  const payload = {
    source: "tokscale",
    complete: true,
    scannedAt: "2026-07-12T12:00:00.000Z",
    reconciledClients: ["claude", "codex", "workbuddy"],
    transcriptClients: ["claude", "codex", "workbuddy"],
    transcriptSessionIds: [
      `claude:${claudeSessionId}`,
      `codex:${sessionId}`,
      `codex:${liveSessionId}`,
      `workbuddy:${workBuddySessionId}`
    ],
    rows: [
      usageRow("claude", claudeSessionId),
      usageRow("codex", sessionId),
      usageRow("codex", liveSessionId),
      usageRow("workbuddy", workBuddySessionId)
    ],
    transcripts: [
      {
        client: "claude",
        sessionId: claudeSessionId,
        title: "Readable Claude title",
        model: "claude-sonnet",
        provider: "anthropic",
        startedAt: "2026-07-12T10:00:00.000Z",
        lastUsedAt: "2026-07-12T10:00:05.000Z",
        events: [
          {
            kind: "prompt",
            timestamp: "2026-07-12T10:00:00.000Z",
            text: "inspect the repository"
          },
          {
            kind: "turn",
            timestamp: "2026-07-12T10:00:05.000Z",
            tokens: {
              input: 40,
              output: 10,
              cacheRead: 50,
              cacheWrite: 0,
              reasoning: 0,
              total: 100
            },
            tools: []
          }
        ]
      },
      {
        client: "codex",
        sessionId,
        title: "Readable transcript-created title",
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
            actions: [
              {
                callId: "offline-command",
                name: "Bash",
                category: "command",
                toolName: "Bash",
                toolKind: "command",
                status: "success",
                timestamp: "2026-07-12T11:00:01.000Z",
                resultObserved: true
              },
              {
                callId: "offline-mcp",
                name: "mcp__ardot__batch_edit",
                category: "mcp",
                toolName: "mcp__ardot__batch_edit",
                toolKind: "mcp",
                mcpServer: "ardot",
                mcpTool: "batch_edit",
                status: "success",
                timestamp: "2026-07-12T11:00:02.000Z",
                resultObserved: true
              },
              {
                callId: "offline-tool",
                name: "Read",
                category: "tool",
                toolName: "Read",
                toolKind: "tool",
                status: "success",
                timestamp: "2026-07-12T11:00:03.000Z",
                resultObserved: true
              }
            ],
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
      },
      liveTranscript
    ]
  };

  db.insert(runTable).values([
    {
      id: `run_claude-code_${claudeSessionId}`,
      name: `claude-code:${claudeSessionId}`,
      status: "running",
      startedAt: "2026-07-12T09:59:00.000Z",
      inputJson: JSON.stringify({ source: "live-test" }),
      metadataJson: JSON.stringify({ agent: "claude-code", sessionId: claudeSessionId })
    },
    {
      id: `run_workbuddy_${workBuddySessionId}`,
      name: `workbuddy:${workBuddySessionId}`,
      status: "running",
      startedAt: "2026-07-12T11:29:00.000Z",
      inputJson: JSON.stringify({ source: "live-test" }),
      metadataJson: JSON.stringify({ agent: "workbuddy", sessionId: workBuddySessionId })
    }
  ]).run();
  db.insert(eventTable).values([
    {
      id: "evt_live_claude_fixture",
      runId: `run_claude-code_${claudeSessionId}`,
      type: "step_started",
      name: "live_claude_event",
      status: "success",
      timestamp: "2026-07-12T09:59:01.000Z",
      metadataJson: JSON.stringify({ source: "live-test" })
    },
    {
      id: "evt_live_workbuddy_fixture",
      runId: `run_workbuddy_${workBuddySessionId}`,
      type: "step_started",
      name: "live_workbuddy_event",
      status: "success",
      timestamp: "2026-07-12T11:29:01.000Z",
      metadataJson: JSON.stringify({ source: "live-test" })
    }
  ]).run();

  await expectAccepted(
    app.request("/integrations/codex/hook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: liveSessionId,
        hook_event_name: "SessionStart",
        timestamp: "2026-07-12T10:29:00.000Z"
      })
    })
  );
  const runsBeforeScan = runRows(await json(app.request("/runs?includeUntracked=1")));
  const liveRunBeforeScan = runsBeforeScan.find(
    (item: any) => item.id === `run_codex_${liveSessionId}`
  );
  const claudeRunBeforeScan = runsBeforeScan.find(
    (item: any) => item.id === `run_claude-code_${claudeSessionId}`
  );
  const workBuddyRunBeforeScan = runsBeforeScan.find(
    (item: any) => item.id === `run_workbuddy_${workBuddySessionId}`
  );
  if (!liveRunBeforeScan || liveRunBeforeScan.name !== `codex:${liveSessionId}`) {
    throw new Error("Expected the live Codex hook to create an ID-named run fixture.");
  }
  if (
    claudeRunBeforeScan?.name !== `claude-code:${claudeSessionId}` ||
    workBuddyRunBeforeScan?.name !== `workbuddy:${workBuddySessionId}`
  ) {
    throw new Error("Expected non-transcript Claude and WorkBuddy placeholder fixtures.");
  }

  await postScan(app, payload);
  await postScan(app, payload);

  const runs = runRows(await json(app.request("/runs?includeUntracked=1")));
  const run = runs.find((item: any) => item.id === `run_codex_${sessionId}`);
  const liveRun = runs.find((item: any) => item.id === `run_codex_${liveSessionId}`);
  const claudeRun = runs.find((item: any) => item.id === `run_claude-code_${claudeSessionId}`);
  const workBuddyRun = runs.find((item: any) => item.id === `run_workbuddy_${workBuddySessionId}`);
  if (
    !run ||
    !liveRun ||
    !claudeRun ||
    !workBuddyRun ||
    claudeRun.name !== "Readable Claude title" ||
    workBuddyRun.name !== "WorkBuddy session" ||
    run.name !== "Readable transcript-created title"
  ) {
    throw new Error("Expected readable transcript titles to upgrade every supported existing run.");
  }
  if (
    run.metadata?.summary?.commandCount !== 1 ||
    run.metadata?.summary?.mcpCount !== 1 ||
    run.metadata?.summary?.toolCount !== 1
  ) {
    throw new Error("Expected structured transcript actions to retain command, MCP, and tool categories.");
  }
  if (
    liveRun.name !== "Readable Codex title" ||
    liveRun.status !== liveRunBeforeScan.status ||
    liveRun.startedAt !== liveRunBeforeScan.startedAt ||
    JSON.stringify(liveRun.input) !== JSON.stringify(liveRunBeforeScan.input)
  ) {
    throw new Error("Expected transcript reconciliation to update only the live Codex run name.");
  }
  if (
    claudeRun.status !== claudeRunBeforeScan.status ||
    claudeRun.startedAt !== claudeRunBeforeScan.startedAt ||
    JSON.stringify(claudeRun.input) !== JSON.stringify(claudeRunBeforeScan.input) ||
    workBuddyRun.status !== workBuddyRunBeforeScan.status ||
    workBuddyRun.startedAt !== workBuddyRunBeforeScan.startedAt ||
    JSON.stringify(workBuddyRun.input) !== JSON.stringify(workBuddyRunBeforeScan.input)
  ) {
    throw new Error("Expected title upgrades to preserve Claude and WorkBuddy live run state.");
  }

  liveTranscript.title = "Renamed Codex title";
  payload.transcripts[0]!.title = "Renamed Claude title";
  payload.transcripts[2]!.title = "Renamed WorkBuddy title";
  await postScan(app, payload);
  const renamedRuns = runRows(await json(app.request("/runs?includeUntracked=1")));
  const renamedLiveRun = renamedRuns.find(
    (item: any) => item.id === `run_codex_${liveSessionId}`
  );
  const renamedClaudeRun = renamedRuns.find(
    (item: any) => item.id === `run_claude-code_${claudeSessionId}`
  );
  const renamedWorkBuddyRun = renamedRuns.find(
    (item: any) => item.id === `run_workbuddy_${workBuddySessionId}`
  );
  const liveEvents = eventRows(await json(
    app.request(`/runs/run_codex_${liveSessionId}/events?visibility=all&page=1&pageSize=100`)
  ));
  if (
    renamedLiveRun?.name !== "Renamed Codex title" ||
    renamedLiveRun.status !== liveRunBeforeScan.status ||
    renamedLiveRun.startedAt !== liveRunBeforeScan.startedAt ||
    renamedClaudeRun?.name !== "Renamed Claude title" ||
    renamedWorkBuddyRun?.name !== "Renamed WorkBuddy title" ||
    !liveEvents.some((event: any) => event.metadata?.source !== "transcript")
  ) {
    throw new Error("Expected later transcript title renames to preserve live run state and events.");
  }

  payload.transcripts[0]!.title = `claude-code:${claudeSessionId}`;
  payload.transcripts[1]!.title = `codex:${sessionId}`;
  payload.transcripts[2]!.title = `workbuddy:${workBuddySessionId}`;
  await postScan(app, payload);
  const placeholderRuns = runRows(await json(app.request("/runs?includeUntracked=1")));
  if (
    placeholderRuns.find((item: any) => item.id === `run_claude-code_${claudeSessionId}`)?.name !==
      "Renamed Claude title" ||
    placeholderRuns.find((item: any) => item.id === `run_workbuddy_${workBuddySessionId}`)?.name !==
      "Renamed WorkBuddy title" ||
    placeholderRuns.find((item: any) => item.id === `run_codex_${sessionId}`)?.name !==
      "Readable transcript-created title"
  ) {
    throw new Error("Expected placeholder transcript titles not to downgrade readable live names.");
  }

  const workBuddyEvents = eventRows(await json(
    app.request(`/runs/run_workbuddy_${workBuddySessionId}/events?visibility=all&page=1&pageSize=100`)
  ));
  if (
    !workBuddyEvents.some((event: any) => event.name === "Read") ||
    !workBuddyEvents.some((event: any) => event.name === "live_workbuddy_event")
  ) {
    throw new Error("Expected WorkBuddy transcript and live events to remain visible.");
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
    events.length !== 5 ||
    events.filter((event: any) => event.metadata?.source === "transcript").length !== 5 ||
    events.find((event: any) => event.name === "user_prompt")?.input?.promptPreview !== "fix the trace" ||
    events.find((event: any) => event.name === "assistant_turn")?.metadata?.tokenUsage?.total !== 420 ||
    !events.some((event: any) => event.name === "Bash" && event.metadata?.category === "command") ||
    !events.some((event: any) => event.name === "mcp__ardot__batch_edit" && event.metadata?.category === "mcp") ||
    !events.some((event: any) => event.name === "Read" && event.metadata?.category === "tool")
  ) {
    throw new Error("Expected deterministic prompt, turn, and classified action events from the transcript.");
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
