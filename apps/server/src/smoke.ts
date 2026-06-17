import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), `tooltrace-api-smoke-${Date.now()}.db`);
process.env.TOOLTRACE_DB_PATH = databasePath;

const { createApp } = await import("./app.js");
const { initializeDatabase } = await import("./storage.js");

initializeDatabase(databasePath);

const app = createApp();
const runId = `run_${Date.now()}`;
const metadataRunId = `run_metadata_${Date.now()}`;
const eventId = `evt_${Date.now()}`;
const metadataEventId = `evt_metadata_${Date.now()}`;

const createRunResponse = await app.request("/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: runId,
    name: "smoke-agent",
    status: "running",
    input: { task: "smoke test" }
  })
});

if (createRunResponse.status !== 201) {
  throw new Error(`Expected run creation to return 201, got ${createRunResponse.status}`);
}

const createMetadataRunResponse = await app.request("/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: metadataRunId,
    name: "codex-agent",
    status: "running",
    input: { task: "metadata smoke test" },
    metadata: {
      agent: "codex",
      surface: "cli",
      sessionId: "session_smoke",
      turnId: "turn_smoke",
      redactionLevel: "metadata"
    }
  })
});

if (createMetadataRunResponse.status !== 201) {
  throw new Error(
    `Expected metadata run creation to return 201, got ${createMetadataRunResponse.status}`
  );
}

const createEventResponse = await app.request("/events", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: eventId,
    runId,
    type: "tool_call",
    name: "web_search",
    status: "success",
    input: { query: "MCP ecosystem" },
    output: { results: 1 },
    durationMs: 42,
    metadata: {
      agent: "codex",
      surface: "cli",
      sessionId: "session_smoke",
      turnId: "turn_smoke",
      toolUseId: "tool_smoke",
      hookEvent: "PostToolUse",
      redactionLevel: "metadata"
    }
  })
});

if (createEventResponse.status !== 201) {
  throw new Error(`Expected event creation to return 201, got ${createEventResponse.status}`);
}

const createMetadataEventResponse = await app.request("/events", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: metadataEventId,
    runId: metadataRunId,
    type: "tool_call",
    name: "Bash",
    status: "success",
    durationMs: 24,
    metadata: {
      agent: "codex",
      surface: "cli",
      sessionId: "session_smoke",
      turnId: "turn_smoke",
      toolUseId: "tool_smoke_2",
      hookEvent: "PostToolUse",
      redactionLevel: "metadata"
    }
  })
});

if (createMetadataEventResponse.status !== 201) {
  throw new Error(
    `Expected metadata event creation to return 201, got ${createMetadataEventResponse.status}`
  );
}

const runsResponse = await app.request("/runs");
const runs = await runsResponse.json();

if (!Array.isArray(runs) || !runs.some((run) => run.id === runId)) {
  throw new Error("Expected /runs to return the smoke run.");
}

const metadataRun = Array.isArray(runs) ? runs.find((run) => run.id === metadataRunId) : undefined;

if (metadataRun?.metadata?.agent !== "codex") {
  throw new Error("Expected /runs to return metadata for the agent run.");
}

const oldPayloadRun = Array.isArray(runs) ? runs.find((run) => run.id === runId) : undefined;

if (oldPayloadRun?.metadata?.agent !== undefined) {
  throw new Error("Expected old run payload without agent metadata to remain valid.");
}

const eventsResponse = await app.request(`/runs/${runId}/events`);
const events = await eventsResponse.json();

if (!Array.isArray(events) || events[0]?.id !== eventId) {
  throw new Error("Expected /runs/:id/events to return the smoke event.");
}

if (events[0]?.metadata?.toolUseId !== "tool_smoke") {
  throw new Error("Expected /runs/:id/events to return event metadata.");
}

const metadataEventsResponse = await app.request(`/runs/${metadataRunId}/events`);
const metadataEvents = await metadataEventsResponse.json();

if (!Array.isArray(metadataEvents) || metadataEvents[0]?.id !== metadataEventId) {
  throw new Error("Expected /runs/:id/events to return the metadata smoke event.");
}

const codexSessionId = "codex_session_smoke";
const codexRunId = "run_codex_codex_session_smoke";
const codexSecretPrompt = "please inspect the private billing token";
const codexSecretCommand = "cat .env";

await expectAccepted(
  app.request("/integrations/codex/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexSessionId,
      hook_event_name: "SessionStart",
      cwd: "/workspace/tooltrace",
      model: "gpt-5.4",
      source: "startup",
      permission_mode: "default"
    })
  }),
  "codex SessionStart hook"
);

await expectAccepted(
  app.request("/integrations/codex/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexSessionId,
      hook_event_name: "UserPromptSubmit",
      turn_id: "codex_turn_1",
      prompt: codexSecretPrompt,
      cwd: "/workspace/tooltrace",
      model: "gpt-5.4",
      permission_mode: "default"
    })
  }),
  "codex UserPromptSubmit hook"
);

await expectAccepted(
  app.request("/integrations/codex/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexSessionId,
      hook_event_name: "PostToolUse",
      turn_id: "codex_turn_1",
      tool_name: "Bash",
      tool_use_id: "codex_tool_1",
      tool_input: {
        command: codexSecretCommand
      },
      tool_response: {
        stdout: "TOKEN=secret"
      },
      cwd: "/workspace/tooltrace",
      model: "gpt-5.4",
      permission_mode: "default"
    })
  }),
  "codex PostToolUse hook"
);

await expectAccepted(
  app.request("/integrations/codex/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexSessionId,
      hook_event_name: "Stop",
      turn_id: "codex_turn_1",
      last_assistant_message: "Done.",
      cwd: "/workspace/tooltrace",
      model: "gpt-5.4",
      permission_mode: "default"
    })
  }),
  "codex Stop hook"
);

const codexRunsResponse = await app.request("/runs");
const codexRuns = await codexRunsResponse.json();
const codexRun = Array.isArray(codexRuns)
  ? codexRuns.find((run) => run.id === codexRunId)
  : undefined;

if (codexRun?.metadata?.agent !== "codex") {
  throw new Error("Expected Codex hook ingestion to create a metadata-backed run.");
}

if (codexRun?.status !== "success") {
  throw new Error("Expected Codex Stop to mark the run successful.");
}

const codexEventsResponse = await app.request(`/runs/${codexRunId}/events`);
const codexEvents = await codexEventsResponse.json();
const codexEventsJson = JSON.stringify(codexEvents);

if (!Array.isArray(codexEvents) || codexEvents.length !== 4) {
  throw new Error("Expected Codex hook ingestion to create four events.");
}

if (!codexEvents.some((event) => event.type === "run_started")) {
  throw new Error("Expected Codex SessionStart to map to run_started.");
}

if (!codexEvents.some((event) => event.name === "Bash command" && event.status === "success")) {
  throw new Error("Expected Codex PostToolUse to map to a successful tool event.");
}

if (codexEventsJson.includes(codexSecretPrompt)) {
  throw new Error("Expected Codex hook ingestion to redact raw prompt.");
}

if (!codexEventsJson.includes(codexSecretCommand)) {
  throw new Error("Expected Codex hook ingestion to store executed command text.");
}

await expectAccepted(
  app.request("/integrations/codex/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not-json"
  }),
  "unknown Codex hook payload"
);

const unknownCodexEventsResponse = await app.request("/runs/run_codex_unknown/events");
const unknownCodexEvents = await unknownCodexEventsResponse.json();

if (
  !Array.isArray(unknownCodexEvents) ||
  !unknownCodexEvents.some((event) => event.name === "unknown_hook_event" && event.status === "error")
) {
  throw new Error("Expected unknown Codex hook payload to create a minimal error event.");
}

const codexOtelSessionId = "codex_otel_session_smoke";
const codexOtelRunId = "run_codex_codex_otel_session_smoke";

await expectAccepted(
  app.request("/integrations/codex/otel/v1/logs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "codex" } }]
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
                  body: { stringValue: "codex.sse_event" },
                  attributes: [
                    { key: "event.name", value: { stringValue: "codex.sse_event" } },
                    { key: "conversation_id", value: { stringValue: codexOtelSessionId } },
                    { key: "gen_ai.response.model", value: { stringValue: "gpt-5.4" } },
                    { key: "input_tokens", value: { intValue: "100" } },
                    { key: "cached_input_tokens", value: { intValue: "60" } },
                    { key: "output_tokens", value: { intValue: "20" } }
                  ]
                },
                {
                  timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
                  body: {
                    stringValue: JSON.stringify({
                      type: "response.completed",
                      model: "gpt-5.4",
                      response: {
                        usage: {
                          prompt_tokens: 50,
                          completion_tokens: 25,
                          prompt_tokens_details: {
                            cached_tokens: 10
                          },
                          output_tokens_details: {
                            reasoning_tokens: 5
                          }
                        }
                      }
                    })
                  },
                  attributes: [
                    { key: "conversation_id", value: { stringValue: codexOtelSessionId } }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
  }),
  "Codex OTel log ingestion"
);

const codexOtelEventsResponse = await app.request(`/runs/${codexOtelRunId}/events`);
const codexOtelEvents = await codexOtelEventsResponse.json();

if (
  !Array.isArray(codexOtelEvents) ||
  !codexOtelEvents.some((event) => event.metadata?.tokenUsage?.total === 120)
) {
  throw new Error("Expected Codex OTel logs to persist official token usage.");
}

if (
  !Array.isArray(codexOtelEvents) ||
  !codexOtelEvents.some(
    (event) =>
      event.metadata?.tokenUsage?.total === 75 &&
      event.metadata.tokenUsage.cachedInput === 10 &&
      event.metadata.tokenUsage.reasoningOutput === 5
  )
) {
  throw new Error("Expected Codex OTel stringified usage payloads to be normalized.");
}

const claudeSessionId = "claude_session_smoke";
const claudeRunId = "run_claude-code_claude_session_smoke";
const claudeSecretCommand = "cat ~/.ssh/id_rsa";

await expectAccepted(
  app.request("/integrations/claude-code/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: claudeSessionId,
      hook_event_name: "SessionStart",
      cwd: "/workspace/tooltrace",
      model: "claude-sonnet-4-6",
      source: "startup",
      permission_mode: "acceptEdits"
    })
  }),
  "Claude Code SessionStart hook"
);

await expectAccepted(
  app.request("/integrations/claude-code/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: claudeSessionId,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "claude_tool_1",
      tool_input: {
        command: claudeSecretCommand
      },
      cwd: "/workspace/tooltrace",
      model: "claude-sonnet-4-6",
      permission_mode: "acceptEdits"
    })
  }),
  "Claude Code PreToolUse hook"
);

await expectAccepted(
  app.request("/integrations/claude-code/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: claudeSessionId,
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "claude_tool_1",
      tool_input: {
        command: claudeSecretCommand
      },
      tool_response: {
        stderr: "permission denied"
      },
      cwd: "/workspace/tooltrace",
      model: "claude-sonnet-4-6",
      permission_mode: "acceptEdits"
    })
  }),
  "Claude Code PostToolUseFailure hook"
);

await expectAccepted(
  app.request("/integrations/claude-code/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: claudeSessionId,
      hook_event_name: "PostToolUse",
      tool_name: "Agent",
      tool_use_id: "claude_tool_agent_1",
      tool_input: {
        description: "Find endpoints",
        subagent_type: "Explore"
      },
      tool_response: {
        status: "completed",
        totalTokens: 12450,
        totalDurationMs: 48211,
        usage: {
          input_tokens: 8320,
          output_tokens: 900,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 2230
        }
      },
      cwd: "/workspace/tooltrace",
      permission_mode: "acceptEdits"
    })
  }),
  "Claude Code Agent usage hook"
);

await expectAccepted(
  app.request("/integrations/claude-code/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: claudeSessionId,
      hook_event_name: "Stop",
      last_assistant_message: "I could not read the key.",
      cwd: "/workspace/tooltrace",
      model: "claude-sonnet-4-6",
      permission_mode: "acceptEdits"
    })
  }),
  "Claude Code Stop hook"
);

const claudeRunsResponse = await app.request("/runs");
const claudeRuns = await claudeRunsResponse.json();
const claudeRun = Array.isArray(claudeRuns)
  ? claudeRuns.find((run) => run.id === claudeRunId)
  : undefined;

if (claudeRun?.metadata?.agent !== "claude-code") {
  throw new Error("Expected Claude Code hook ingestion to create a metadata-backed run.");
}

if (claudeRun?.status !== "success") {
  throw new Error("Expected Claude Code Stop to mark the run successful.");
}

const claudeEventsResponse = await app.request(`/runs/${claudeRunId}/events`);
const claudeEvents = await claudeEventsResponse.json();
const claudeEventsJson = JSON.stringify(claudeEvents);

if (!Array.isArray(claudeEvents) || claudeEvents.length !== 5) {
  throw new Error("Expected Claude Code hook ingestion to create five events.");
}

if (!claudeEvents.some((event) => event.name === "Bash command" && event.status === "error")) {
  throw new Error("Expected Claude Code PostToolUseFailure to map to an error tool event.");
}

if (!claudeEvents.some((event) => event.metadata?.tokenUsage?.total === 12450)) {
  throw new Error("Expected Claude Code Agent response usage to be persisted.");
}

if (!claudeEvents.some((event) => event.type === "step_ended" && event.name === "turn")) {
  throw new Error("Expected Claude Code Stop to map to a completed turn event.");
}

if (!claudeEventsJson.includes(claudeSecretCommand)) {
  throw new Error("Expected Claude Code hook ingestion to store executed command text.");
}

console.log("ToolTrace API smoke test passed.");

async function expectAccepted(responseResult: Response | Promise<Response>, label: string) {
  const response = await responseResult;

  if (response.status !== 202) {
    throw new Error(`Expected ${label} to return 202, got ${response.status}`);
  }
}
