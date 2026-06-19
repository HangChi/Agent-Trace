import { writeFileSync } from "node:fs";
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
const untrackedRunId = `run_untracked_${Date.now()}`;
const recoveredRunId = `run_recovered_${Date.now()}`;
const modelRunId = `run_model_${Date.now()}`;
const hiddenRunId = `run_hidden_${Date.now()}`;
const eventId = `evt_${Date.now()}`;
const metadataEventId = `evt_metadata_${Date.now()}`;
const untrackedEventId = `evt_untracked_${Date.now()}`;
const staleTimestamp = new Date(Date.now() - 31 * 60 * 1000).toISOString();

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
      category: "tool",
      toolName: "shell_command",
      toolKind: "command",
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

if (
  metadataRun.metadata.surface !== "unknown" ||
  metadataRun.metadata.surfaceSource !== "legacy-unmarked"
) {
  throw new Error("Expected legacy Codex metadata without a source marker to be unmarked.");
}

if (
  metadataRun.metadata.summary?.commandCount !== 1 ||
  metadataRun.metadata.summary.toolCount !== 0 ||
  !metadataRun.metadata.summary.commands?.includes("shell_command")
) {
  throw new Error("Expected legacy command-like tool metadata to summarize as a command.");
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

const batchRunAId = `run_batch_${Date.now()}_a`;
const batchRunBId = `run_batch_${Date.now()}_b`;
const batchRunIds = [batchRunAId, batchRunBId];

for (const id of batchRunIds) {
  const createBatchRunResponse = await app.request("/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      name: `batch-${id}`,
      status: "success",
      startedAt: new Date().toISOString()
    })
  });

  if (createBatchRunResponse.status !== 201) {
    throw new Error(
      `Expected batch run creation to return 201, got ${createBatchRunResponse.status}`
    );
  }
}

const createBatchEventResponse = await app.request("/events", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: `evt_batch_${Date.now()}`,
    runId: batchRunAId,
    type: "tool_call",
    name: "batch_event",
    status: "success"
  })
});

if (createBatchEventResponse.status !== 201) {
  throw new Error(
    `Expected batch event creation to return 201, got ${createBatchEventResponse.status}`
  );
}

const invalidBatchDeleteResponse = await app.request("/runs", {
  method: "DELETE",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ids: [""] })
});

if (invalidBatchDeleteResponse.status !== 400) {
  throw new Error(
    `Expected invalid batch delete to return 400, got ${invalidBatchDeleteResponse.status}`
  );
}

const batchDeleteResponse = await app.request("/runs", {
  method: "DELETE",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ids: batchRunIds })
});
const batchDeleteResult = await batchDeleteResponse.json();

if (batchDeleteResponse.status !== 200 || batchDeleteResult.deleted !== 2) {
  throw new Error("Expected batch delete to remove both selected runs.");
}

const afterBatchDeleteRunsResponse = await app.request("/runs?includeUntracked=1");
const afterBatchDeleteRuns = await afterBatchDeleteRunsResponse.json();

if (
  Array.isArray(afterBatchDeleteRuns) &&
  afterBatchDeleteRuns.some((run) => batchRunIds.includes(run.id))
) {
  throw new Error("Expected batch deleted runs to be absent from /runs.");
}

const batchDeletedEventsResponse = await app.request(`/runs/${batchRunAId}/events`);
const batchDeletedEvents = await batchDeletedEventsResponse.json();

if (Array.isArray(batchDeletedEvents) && batchDeletedEvents.length > 0) {
  throw new Error("Expected batch delete to remove events for deleted runs.");
}

const createUntrackedRunResponse = await app.request("/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: untrackedRunId,
    name: "codex:untracked",
    status: "running",
    startedAt: staleTimestamp,
    input: { source: "agent-hook", redactionLevel: "metadata" },
    metadata: {
      agent: "codex",
      surface: "desktop",
      redactionLevel: "metadata"
    }
  })
});

if (createUntrackedRunResponse.status !== 201) {
  throw new Error(
    `Expected untracked run creation to return 201, got ${createUntrackedRunResponse.status}`
  );
}

const createUntrackedEventResponse = await app.request("/events", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: untrackedEventId,
    runId: untrackedRunId,
    type: "run_started",
    name: "session",
    status: "running",
    timestamp: staleTimestamp,
    metadata: {
      agent: "codex",
      surface: "desktop",
      hookEvent: "SessionStart",
      category: "lifecycle",
      redactionLevel: "metadata"
    }
  })
});

if (createUntrackedEventResponse.status !== 201) {
  throw new Error(
    `Expected untracked event creation to return 201, got ${createUntrackedEventResponse.status}`
  );
}

const filteredRunsResponse = await app.request("/runs");
const filteredRuns = await filteredRunsResponse.json();

if (Array.isArray(filteredRuns) && filteredRuns.some((run) => run.id === untrackedRunId)) {
  throw new Error("Expected untracked collector-only runs to be hidden by default.");
}

const allRunsResponse = await app.request("/runs?includeUntracked=1");
const allRuns = await allRunsResponse.json();
const untrackedRun = Array.isArray(allRuns)
  ? allRuns.find((run) => run.id === untrackedRunId)
  : undefined;

if (untrackedRun?.status !== "error" || !untrackedRun.endedAt || !untrackedRun.error) {
  throw new Error("Expected stale running runs to be closed when runs are listed.");
}

const createRecoveredRunResponse = await app.request("/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: recoveredRunId,
    name: "recovered-stale-run",
    status: "running",
    startedAt: staleTimestamp,
    input: { task: "recover stale run" }
  })
});

if (createRecoveredRunResponse.status !== 201) {
  throw new Error(
    `Expected recovered run creation to return 201, got ${createRecoveredRunResponse.status}`
  );
}

const staleRecoveredRunsResponse = await app.request("/runs?includeUntracked=1");
const staleRecoveredRuns = await staleRecoveredRunsResponse.json();
const staleRecoveredRun = Array.isArray(staleRecoveredRuns)
  ? staleRecoveredRuns.find((run) => run.id === recoveredRunId)
  : undefined;

if (staleRecoveredRun?.status !== "error" || !staleRecoveredRun.error) {
  throw new Error("Expected stale recovered run fixture to be closed with an error first.");
}

const recoverRunResponse = await app.request(`/runs/${recoveredRunId}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    status: "success",
    endedAt: new Date().toISOString()
  })
});

if (recoverRunResponse.status !== 200) {
  throw new Error(`Expected recovered run update to return 200, got ${recoverRunResponse.status}`);
}

const recoveredRunsResponse = await app.request("/runs?includeUntracked=1");
const recoveredRuns = await recoveredRunsResponse.json();
const recoveredRun = Array.isArray(recoveredRuns)
  ? recoveredRuns.find((run) => run.id === recoveredRunId)
  : undefined;

if (recoveredRun?.status !== "success" || recoveredRun.error !== undefined) {
  throw new Error("Expected success updates to clear stale run errors.");
}

const metadataEventsResponse = await app.request(`/runs/${metadataRunId}/events`);
const metadataEvents = await metadataEventsResponse.json();

if (!Array.isArray(metadataEvents) || metadataEvents[0]?.id !== metadataEventId) {
  throw new Error("Expected /runs/:id/events to return the metadata smoke event.");
}

const createModelRunResponse = await app.request("/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: modelRunId,
    name: "model-cost-smoke",
    status: "running",
    input: { task: "model summary smoke" }
  })
});

if (createModelRunResponse.status !== 201) {
  throw new Error(`Expected model run creation to return 201, got ${createModelRunResponse.status}`);
}

const modelEvents = [
  {
    id: `${modelRunId}_openai`,
    model: "gpt-5.4",
    provider: "openai",
    tokenUsage: { input: 100, output: 20, total: 120, cachedInput: 60 }
  },
  {
    id: `${modelRunId}_claude`,
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    tokenUsage: {
      input: 8320,
      output: 900,
      total: 12450,
      cacheCreationInput: 1000,
      cacheReadInput: 2230
    }
  },
  {
    id: `${modelRunId}_custom`,
    model: "custom-local-model",
    provider: "local",
    tokenUsage: { input: 3, output: 4, total: 7, estimated: true }
  }
];

for (const item of modelEvents) {
  const response = await app.request("/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: item.id,
      runId: modelRunId,
      type: "llm_call",
      name: "model_usage",
      status: "success",
      metadata: {
        agent: "codex",
        surface: "cli",
        category: "tokens",
        model: item.model,
        provider: item.provider,
        tokenUsage: item.tokenUsage,
        redactionLevel: "metadata"
      }
    })
  });

  if (response.status !== 201) {
    throw new Error(`Expected model event creation to return 201, got ${response.status}`);
  }
}

const modelRunsResponse = await app.request("/runs?includeUntracked=1");
const modelRuns = await modelRunsResponse.json();
const modelRun = Array.isArray(modelRuns)
  ? modelRuns.find((run) => run.id === modelRunId)
  : undefined;
const modelSummary = modelRun?.metadata?.summary;

if (
  !modelSummary?.models?.includes("gpt-5.4") ||
  !modelSummary.models.includes("claude-sonnet-4-6") ||
  !modelSummary.models.includes("custom-local-model")
) {
  throw new Error("Expected run summaries to include tracked model names.");
}

if (
  modelSummary.tokenUsage?.total !== 12577 ||
  modelSummary.tokenUsage.estimated !== true ||
  modelSummary.modelUsage?.length !== 3
) {
  throw new Error("Expected run summaries to aggregate token usage by model.");
}

const createHiddenRunResponse = await app.request("/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: hiddenRunId,
    name: "hidden-pagination-smoke",
    status: "running",
    input: { task: "hidden event pagination smoke" }
  })
});

if (createHiddenRunResponse.status !== 201) {
  throw new Error(`Expected hidden run creation to return 201, got ${createHiddenRunResponse.status}`);
}

for (let index = 0; index < 105; index += 1) {
  const response = await app.request("/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: `${hiddenRunId}_${index}`,
      runId: hiddenRunId,
      type: "step_started",
      name: "lifecycle",
      status: "running",
      timestamp: new Date(Date.now() + index).toISOString(),
      metadata: {
        agent: "codex",
        surface: "cli",
        hookEvent: "Notification",
        category: "lifecycle",
        redactionLevel: "metadata"
      }
    })
  });

  if (response.status !== 201) {
    throw new Error(`Expected hidden event creation to return 201, got ${response.status}`);
  }
}

const hiddenEventsResponse = await app.request(
  `/runs/${hiddenRunId}/events?visibility=hidden&page=2&pageSize=100`
);
const hiddenEventsPage = await hiddenEventsResponse.json();

if (
  !Array.isArray(hiddenEventsPage.events) ||
  hiddenEventsPage.events.length !== 5 ||
  hiddenEventsPage.counts?.hidden !== 105 ||
  hiddenEventsPage.pagination?.totalPages !== 2
) {
  throw new Error("Expected hidden events to be paginated by the events API.");
}

const codexSessionId = "codex_session_smoke";
const codexRunId = "run_codex_codex_session_smoke";
const codexCliHookPath = "/integrations/codex/hook?surface=cli&surface_source=tooltrace-cli";
const codexSecretPrompt = "please inspect the private billing token";
const codexSecretCommand = "cat .env";

await expectAccepted(
  app.request(codexCliHookPath, {
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
  app.request(codexCliHookPath, {
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
  app.request(codexCliHookPath, {
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
  app.request(codexCliHookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexSessionId,
      hook_event_name: "PostToolUse",
      turn_id: "codex_turn_1",
      tool_name: "Read",
      tool_use_id: "codex_tool_2",
      tool_input: {
        path: "/workspace/tooltrace/README.md"
      },
      tool_response: {
        bytes: 128
      },
      cwd: "/workspace/tooltrace",
      model: "gpt-5.4",
      permission_mode: "default"
    })
  }),
  "codex generic PostToolUse hook"
);

await expectAccepted(
  app.request(codexCliHookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexSessionId,
      hook_event_name: "PostToolUse",
      turn_id: "codex_turn_1",
      tool_name: "mcp__node_repl__js",
      tool_use_id: "codex_tool_3",
      tool_input: {
        code: "1 + 1"
      },
      tool_response: {
        result: 2
      },
      cwd: "/workspace/tooltrace",
      model: "gpt-5.4",
      permission_mode: "default"
    })
  }),
  "codex MCP PostToolUse hook"
);

await expectAccepted(
  app.request(codexCliHookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexSessionId,
      hook_event_name: "PostToolUse",
      turn_id: "codex_turn_1",
      tool_name: "SlashCommand",
      tool_use_id: "codex_tool_4",
      tool_input: {
        name: "openai-docs"
      },
      tool_response: {
        ok: true
      },
      cwd: "/workspace/tooltrace",
      model: "gpt-5.4",
      permission_mode: "default"
    })
  }),
  "codex skill PostToolUse hook"
);

await expectAccepted(
  app.request(codexCliHookPath, {
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

if (codexRun.metadata.surface !== "cli" || codexRun.metadata.surfaceSource !== "tooltrace-cli") {
  throw new Error("Expected Codex hook ingestion to preserve the ToolTrace CLI surface hint.");
}

if (codexRun?.status !== "success") {
  throw new Error("Expected Codex Stop to mark the run successful.");
}

if (
  codexRun?.metadata?.summary?.tokenUsage?.estimated !== true ||
  (codexRun.metadata.summary.tokenUsage.input ?? 0) <= 0 ||
  (codexRun.metadata.summary.tokenUsage.output ?? 0) <= 0
) {
  throw new Error("Expected Codex hook fallback token estimates to be summarized.");
}

if (
  codexRun.metadata.summary.commandCount !== 1 ||
  codexRun.metadata.summary.toolCount !== 1 ||
  codexRun.metadata.summary.mcpCount !== 1 ||
  codexRun.metadata.summary.skillCount !== 1 ||
  !codexRun.metadata.summary.mcpTools?.includes("node_repl.js") ||
  !codexRun.metadata.summary.skills?.includes("openai-docs")
) {
  throw new Error("Expected Codex hook ingestion to summarize commands, tools, MCP, and skills.");
}

const codexEventsResponse = await app.request(`/runs/${codexRunId}/events`);
const codexEvents = await codexEventsResponse.json();
const codexEventsJson = JSON.stringify(codexEvents);

if (!Array.isArray(codexEvents) || codexEvents.length !== 7) {
  throw new Error("Expected Codex hook ingestion to create seven events.");
}

if (!codexEvents.some((event) => event.type === "run_started")) {
  throw new Error("Expected Codex SessionStart to map to run_started.");
}

if (!codexEvents.some((event) => event.name === "Bash command" && event.status === "success")) {
  throw new Error("Expected Codex PostToolUse to map to a successful tool event.");
}

if (!codexEvents.some((event) => event.name === "mcp:node_repl.js" && event.metadata?.category === "mcp")) {
  throw new Error("Expected MCP tool names to map to MCP events.");
}

if (!codexEvents.some((event) => event.name === "skill:openai-docs" && event.metadata?.category === "skill")) {
  throw new Error("Expected SlashCommand tool input names to map to skill events.");
}

if (codexEventsJson.includes(codexSecretPrompt)) {
  throw new Error("Expected Codex hook ingestion to redact raw prompt.");
}

if (codexEventsJson.includes("Done.")) {
  throw new Error("Expected Codex hook ingestion to redact raw assistant output.");
}

if (!codexEventsJson.includes(codexSecretCommand)) {
  throw new Error("Expected Codex hook ingestion to store executed command text.");
}

const codexPromptEvent = Array.isArray(codexEvents)
  ? codexEvents.find((event) => event.name === "user_prompt")
  : undefined;

if (
  codexPromptEvent?.metadata?.tokenUsage?.estimated !== true ||
  codexPromptEvent.metadata.tokenUsage.source !== "codex-estimate" ||
  codexPromptEvent.metadata.tokenUsage.method !== "tiktoken:o200k_base" ||
  codexPromptEvent.metadata.tokenUsage.input <= 0 ||
  codexPromptEvent.metadata.tokenUsage.output !== 0
) {
  throw new Error("Expected Codex user prompts to receive estimated input token usage.");
}

const codexStopEvent = Array.isArray(codexEvents)
  ? codexEvents.find((event) => event.name === "turn")
  : undefined;

if (
  codexStopEvent?.metadata?.tokenUsage?.estimated !== true ||
  codexStopEvent.metadata.tokenUsage.source !== "codex-estimate" ||
  codexStopEvent.metadata.tokenUsage.method !== "tiktoken:o200k_base" ||
  codexStopEvent.metadata.tokenUsage.input !== 0 ||
  codexStopEvent.metadata.tokenUsage.output <= 0
) {
  throw new Error("Expected Codex Stop hooks to receive estimated output token usage.");
}

const codexPromptOnlySessionId = "codex_prompt_only_session_smoke";
const codexPromptOnlyRunId = "run_codex_codex_prompt_only_session_smoke";

await expectAccepted(
  app.request(codexCliHookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexPromptOnlySessionId,
      hook_event_name: "SessionStart",
      cwd: "/workspace/tooltrace"
    })
  }),
  "codex prompt-only SessionStart hook"
);

await expectAccepted(
  app.request(codexCliHookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexPromptOnlySessionId,
      hook_event_name: "UserPromptSubmit",
      turn_id: "codex_prompt_only_turn_1",
      prompt: "hello",
      cwd: "/workspace/tooltrace"
    })
  }),
  "codex prompt-only UserPromptSubmit hook"
);

await expectAccepted(
  app.request(codexCliHookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexPromptOnlySessionId,
      hook_event_name: "Stop",
      turn_id: "codex_prompt_only_turn_1",
      last_assistant_message: "hi",
      cwd: "/workspace/tooltrace"
    })
  }),
  "codex prompt-only Stop hook"
);

const promptOnlyRunsResponse = await app.request("/runs");
const promptOnlyRuns = await promptOnlyRunsResponse.json();
const promptOnlyRun = Array.isArray(promptOnlyRuns)
  ? promptOnlyRuns.find((run) => run.id === codexPromptOnlyRunId)
  : undefined;

if (promptOnlyRun !== undefined) {
  throw new Error("Expected prompt-only Codex CLI runs to be hidden in the default runs list.");
}

const promptOnlyUntrackedRunsResponse = await app.request("/runs?includeUntracked=1");
const promptOnlyUntrackedRuns = await promptOnlyUntrackedRunsResponse.json();
const promptOnlyUntrackedRun = Array.isArray(promptOnlyUntrackedRuns)
  ? promptOnlyUntrackedRuns.find((run) => run.id === codexPromptOnlyRunId)
  : undefined;

if (
  promptOnlyUntrackedRun?.metadata?.summary?.promptCount !== 1 ||
  promptOnlyUntrackedRun.metadata.summary.turnCount !== 1 ||
  promptOnlyUntrackedRun.metadata.summary.commandCount !== 0 ||
  (promptOnlyUntrackedRun.metadata.summary.tokenUsage?.total ?? 0) <= 0
) {
  throw new Error("Expected prompt-only Codex CLI runs to be available with includeUntracked=1.");
}

const codexExpansionSessionId = "codex_expansion_skill_smoke";
const codexExpansionRunId = "run_codex_codex_expansion_skill_smoke";

await expectAccepted(
  app.request(codexCliHookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexExpansionSessionId,
      hook_event_name: "UserPromptExpansion",
      turn_id: "codex_expansion_turn_1",
      prompt: "expand without skill",
      cwd: "/workspace/tooltrace"
    })
  }),
  "codex unnamed UserPromptExpansion hook"
);

await expectAccepted(
  app.request(codexCliHookPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexExpansionSessionId,
      hook_event_name: "UserPromptExpansion",
      turn_id: "codex_expansion_turn_1",
      tool_input: {
        name: "baoyu-translate"
      },
      cwd: "/workspace/tooltrace"
    })
  }),
  "codex named UserPromptExpansion hook"
);

const codexExpansionEventsResponse = await app.request(`/runs/${codexExpansionRunId}/events`);
const codexExpansionEvents = await codexExpansionEventsResponse.json();

if (
  !Array.isArray(codexExpansionEvents) ||
  codexExpansionEvents.filter((event) => event.metadata?.category === "skill").length !== 1 ||
  !codexExpansionEvents.some((event) => event.name === "skill:baoyu-translate")
) {
  throw new Error("Expected UserPromptExpansion to map to skill only when a skill name is present.");
}

await expectAccepted(
  app.request(codexCliHookPath, {
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
  app.request("/integrations/codex/otel/v1/logs?surface=cli&surface_source=tooltrace-cli", {
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
                },
                {
                  timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
                  body: {
                    stringValue: JSON.stringify({
                      type: "response.completed",
                      model: "gpt-5.4",
                      response: {
                        usage: {
                          input_tokens: 10,
                          output_tokens: 2,
                          total_tokens: 12,
                          output_tokens_details: {
                            reasoning_tokens: 3
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
  !codexOtelEvents.every(
    (event) => event.metadata?.surface === "cli" && event.metadata.surfaceSource === "tooltrace-cli"
  )
) {
  throw new Error("Expected Codex OTel logs to preserve the ToolTrace CLI surface hint.");
}

if (
  !Array.isArray(codexOtelEvents) ||
  !codexOtelEvents.some(
    (event) => event.metadata?.tokenUsage?.total === 120 && event.metadata.tokenUsage.estimated !== true
  )
) {
  throw new Error("Expected Codex OTel usage to remain official, not estimated.");
}

if (
  !Array.isArray(codexOtelEvents) ||
  !codexOtelEvents.some(
    (event) =>
      event.metadata?.tokenUsage?.total === 80 &&
      event.metadata.tokenUsage.cachedInput === 10 &&
      event.metadata.tokenUsage.reasoningOutput === 5
  )
) {
  throw new Error("Expected Codex OTel reasoning usage to be included in derived totals.");
}

if (
  !Array.isArray(codexOtelEvents) ||
  !codexOtelEvents.some(
    (event) =>
      event.metadata?.tokenUsage?.total === 12 &&
      event.metadata.tokenUsage.reasoningOutput === 3
  )
) {
  throw new Error("Expected Codex OTel explicit totals to remain authoritative.");
}

const codexOtelRunsResponse = await app.request("/runs");
const codexOtelRuns = await codexOtelRunsResponse.json();

if (Array.isArray(codexOtelRuns) && codexOtelRuns.some((run) => run.id === codexOtelRunId)) {
  throw new Error("Expected token-only Codex OTel runs to be hidden by default.");
}

const allCodexOtelRunsResponse = await app.request("/runs?includeUntracked=1");
const allCodexOtelRuns = await allCodexOtelRunsResponse.json();
const listedCodexOtelRun = Array.isArray(allCodexOtelRuns)
  ? allCodexOtelRuns.find((run) => run.id === codexOtelRunId)
  : undefined;

if (
  listedCodexOtelRun?.metadata?.surface !== "cli" ||
  listedCodexOtelRun.metadata.surfaceSource !== "tooltrace-cli"
) {
  throw new Error("Expected untracked Codex OTel runs to keep CLI surface hints.");
}

const codexDesktopOtelSessionId = "codex_desktop_otel_session_smoke";
const codexDesktopOtelRunId = "run_codex_codex_desktop_otel_session_smoke";

await expectAccepted(
  app.request("/v1/logs", {
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
                    { key: "conversation_id", value: { stringValue: codexDesktopOtelSessionId } },
                    { key: "reasoning_output_tokens", value: { intValue: "9" } }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
  }),
  "Codex desktop OTel log ingestion"
);

const desktopOtelEventsResponse = await app.request(`/runs/${codexDesktopOtelRunId}/events`);
const desktopOtelEvents = await desktopOtelEventsResponse.json();

if (
  !Array.isArray(desktopOtelEvents) ||
  !desktopOtelEvents.every(
    (event) =>
      event.metadata?.surface === "desktop" &&
      event.metadata.surfaceSource === "default-v1-logs"
  )
) {
  throw new Error("Expected generic OTel /v1/logs ingestion to default to desktop surface.");
}

const mainstreamUsageFixtures = [
  {
    id: "gemini_usage_smoke",
    model: "gemini-2.5-pro",
    provider: "google",
    payload: {
      usageMetadata: {
        promptTokenCount: 100,
        cachedContentTokenCount: 30,
        candidatesTokenCount: 20,
        toolUsePromptTokenCount: 5,
        thoughtsTokenCount: 7,
        totalTokenCount: 132
      }
    },
    expected: {
      input: 105,
      output: 20,
      total: 132,
      cachedInput: 30,
      reasoningOutput: 7
    }
  },
  {
    id: "cohere_usage_smoke",
    model: "command-a-plus-05-2026",
    provider: "cohere",
    payload: {
      usage: {
        billed_units: {
          input_tokens: 5,
          output_tokens: 418
        },
        tokens: {
          input_tokens: 71,
          output_tokens: 418
        }
      }
    },
    expected: {
      input: 71,
      output: 418,
      total: 489
    }
  },
  {
    id: "bedrock_usage_smoke",
    model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    provider: "anthropic",
    payload: {
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        cacheReadInputTokens: 3,
        cacheWriteInputTokens: 4
      }
    },
    expected: {
      input: 10,
      output: 2,
      total: 12,
      cachedInput: 3,
      cacheCreationInput: 4,
      cacheReadInput: 3
    }
  },
  {
    id: "deepseek_usage_smoke",
    model: "deepseek-v4-pro",
    provider: "deepseek",
    payload: {
      usage: {
        prompt_tokens: 50,
        completion_tokens: 15,
        total_tokens: 80,
        prompt_cache_hit_tokens: 10,
        completion_tokens_details: {
          reasoning_tokens: 15
        }
      }
    },
    expected: {
      input: 50,
      output: 15,
      total: 80,
      cachedInput: 10,
      reasoningOutput: 15
    }
  },
  {
    id: "xai_usage_smoke",
    model: "grok-4",
    provider: "xai",
    payload: {
      usage: {
        prompt_tokens: 32,
        completion_tokens: 9,
        total_tokens: 151,
        prompt_tokens_details: {
          cached_tokens: 8
        },
        completion_tokens_details: {
          reasoning_tokens: 110
        }
      }
    },
    expected: {
      input: 32,
      output: 9,
      total: 151,
      cachedInput: 8,
      reasoningOutput: 110
    }
  }
];

for (const item of mainstreamUsageFixtures) {
  await expectAccepted(
    app.request(codexCliHookPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: item.id,
        hook_event_name: "Stop",
        cwd: "/workspace/tooltrace",
        model: item.model,
        ...item.payload
      })
    }),
    `${item.model} official usage hook`
  );
}

const mainstreamRunsResponse = await app.request("/runs?includeUntracked=1");
const mainstreamRuns = await mainstreamRunsResponse.json();

for (const item of mainstreamUsageFixtures) {
  const runIdForFixture = `run_codex_${item.id}`;
  const run = Array.isArray(mainstreamRuns)
    ? mainstreamRuns.find((candidate) => candidate.id === runIdForFixture)
    : undefined;
  const summary = run?.metadata?.summary;
  const modelUsage = summary?.modelUsage?.[0];

  if (
    !summary?.models?.includes(item.model) ||
    modelUsage?.model !== item.model ||
    modelUsage.provider !== item.provider
  ) {
    throw new Error(`Expected ${item.model} usage to be attributed to its provider and model.`);
  }

  for (const [key, value] of Object.entries(item.expected)) {
    if (modelUsage.tokenUsage[key] !== value) {
      throw new Error(`Expected ${item.model} ${key} to equal ${value}.`);
    }
  }
}

const claudeSessionId = "claude_session_smoke";
const claudeRunId = "run_claude-code_claude_session_smoke";
const claudeSecretPrompt = "summarize the private vendor token";
const claudeSecretCommand = "cat ~/.ssh/id_rsa";
const claudeTranscriptSessionId = "claude_transcript_model_smoke";
const claudeTranscriptRunId = "run_claude-code_claude_transcript_model_smoke";
const claudeTranscriptModel = "claude-sonnet-4-5-20250929";
const claudeTranscriptPath = join(tmpdir(), `tooltrace-claude-transcript-${Date.now()}.jsonl`);

writeFileSync(
  claudeTranscriptPath,
  [
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: "hello"
      }
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        model: claudeTranscriptModel,
        content: [{ type: "text", text: "Transcript-backed response." }]
      }
    })
  ].join("\n"),
  "utf8"
);

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
      hook_event_name: "UserPromptSubmit",
      turn_id: "claude_turn_1",
      prompt: claudeSecretPrompt,
      cwd: "/workspace/tooltrace",
      model: "claude-sonnet-4-6",
      permission_mode: "acceptEdits"
    })
  }),
  "Claude Code UserPromptSubmit hook"
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

if (!Array.isArray(claudeEvents) || claudeEvents.length !== 6) {
  throw new Error("Expected Claude Code hook ingestion to create six events.");
}

if (!claudeEvents.some((event) => event.name === "Bash command" && event.status === "error")) {
  throw new Error("Expected Claude Code PostToolUseFailure to map to an error tool event.");
}

if (!claudeEvents.some((event) => event.metadata?.tokenUsage?.total === 12450)) {
  throw new Error("Expected Claude Code Agent response usage to be persisted.");
}

if (
  !claudeEvents.some(
    (event) => event.metadata?.tokenUsage?.total === 12450 && event.metadata.tokenUsage.estimated !== true
  )
) {
  throw new Error("Expected Claude Code official usage to remain official, not estimated.");
}

const claudePromptEvent = Array.isArray(claudeEvents)
  ? claudeEvents.find((event) => event.name === "user_prompt")
  : undefined;

if (
  claudePromptEvent?.metadata?.tokenUsage?.estimated !== true ||
  claudePromptEvent.metadata.tokenUsage.source !== "claude-code-estimate" ||
  claudePromptEvent.metadata.tokenUsage.method !== "tiktoken:o200k_base" ||
  claudePromptEvent.metadata.tokenUsage.input <= 0 ||
  claudePromptEvent.metadata.tokenUsage.output !== 0
) {
  throw new Error("Expected Claude Code user prompts to receive estimated input token usage.");
}

const claudeStopEvent = Array.isArray(claudeEvents)
  ? claudeEvents.find((event) => event.name === "turn")
  : undefined;

if (
  claudeStopEvent?.type !== "llm_call" ||
  claudeStopEvent.metadata?.tokenUsage?.estimated !== true ||
  claudeStopEvent.metadata.tokenUsage.source !== "claude-code-estimate" ||
  claudeStopEvent.metadata.tokenUsage.input !== 0 ||
  claudeStopEvent.metadata.tokenUsage.output <= 0
) {
  throw new Error("Expected Claude Code Stop hooks to receive estimated output token usage.");
}

if (
  claudeRun?.metadata?.summary?.tokenUsage?.estimated !== true ||
  (claudeRun.metadata.summary.tokenUsage.input ?? 0) <= 0 ||
  (claudeRun.metadata.summary.tokenUsage.output ?? 0) <= 0 ||
  (claudeRun.metadata.summary.tokenUsage.total ?? 0) <= 12450
) {
  throw new Error("Expected Claude Code fallback token estimates to be summarized with official usage.");
}

if (claudeEventsJson.includes(claudeSecretPrompt)) {
  throw new Error("Expected Claude Code hook ingestion to redact raw prompt.");
}

if (!claudeEventsJson.includes(claudeSecretCommand)) {
  throw new Error("Expected Claude Code hook ingestion to store executed command text.");
}

await expectAccepted(
  app.request("/integrations/claude-code/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: claudeTranscriptSessionId,
      hook_event_name: "SessionStart",
      cwd: "/workspace/tooltrace",
      permission_mode: "acceptEdits"
    })
  }),
  "Claude Code transcript-model SessionStart hook"
);

await expectAccepted(
  app.request("/integrations/claude-code/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: claudeTranscriptSessionId,
      hook_event_name: "UserPromptSubmit",
      prompt: "hello from a prompt before Claude Code reports its model",
      cwd: "/workspace/tooltrace",
      permission_mode: "acceptEdits"
    })
  }),
  "Claude Code transcript-model UserPromptSubmit hook"
);

await expectAccepted(
  app.request("/integrations/claude-code/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: claudeTranscriptSessionId,
      hook_event_name: "Stop",
      transcript_path: claudeTranscriptPath,
      last_assistant_message: "Transcript-backed response.",
      cwd: "/workspace/tooltrace",
      permission_mode: "acceptEdits"
    })
  }),
  "Claude Code transcript-model Stop hook"
);

const claudeTranscriptRunsResponse = await app.request("/runs?includeUntracked=1");
const claudeTranscriptRuns = await claudeTranscriptRunsResponse.json();
const claudeTranscriptRun = Array.isArray(claudeTranscriptRuns)
  ? claudeTranscriptRuns.find((run) => run.id === claudeTranscriptRunId)
  : undefined;
const claudeTranscriptSummary = claudeTranscriptRun?.metadata?.summary;
const claudeTranscriptModelUsage = claudeTranscriptSummary?.modelUsage?.[0];

if (!claudeTranscriptSummary?.models?.includes(claudeTranscriptModel)) {
  throw new Error("Expected Claude Code transcript metadata to supply the run model.");
}

if (
  claudeTranscriptSummary.modelUsage?.length !== 1 ||
  claudeTranscriptModelUsage?.model !== claudeTranscriptModel ||
  claudeTranscriptModelUsage.provider !== "anthropic" ||
  claudeTranscriptModelUsage.tokenUsage.total !== claudeTranscriptSummary.tokenUsage.total
) {
  throw new Error("Expected unmodeled Claude Code estimates to be attributed to the transcript model.");
}

console.log("ToolTrace API smoke test passed.");

async function expectAccepted(responseResult: Response | Promise<Response>, label: string) {
  const response = await responseResult;

  if (response.status !== 202) {
    throw new Error(`Expected ${label} to return 202, got ${response.status}`);
  }
}
