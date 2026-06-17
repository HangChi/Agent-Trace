#!/usr/bin/env node

const endpoint = trimTrailingSlash(process.env.TOOLTRACE_ENDPOINT ?? "http://localhost:4319");
const suffix = Date.now().toString(36);
const codexSessionId = `codex_e2e_${suffix}`;
const claudeSessionId = `claude_e2e_${suffix}`;
const codexRunId = `run_codex_${codexSessionId}`;
const claudeRunId = `run_claude-code_${claudeSessionId}`;
const secretPrompt = "please inspect the private billing token";
const secretCommand = "cat .env";

await postHook("/integrations/codex/hook", {
  session_id: codexSessionId,
  hook_event_name: "SessionStart",
  cwd: process.cwd(),
  model: "gpt-5.4",
  source: "startup",
  permission_mode: "default"
});

await postHook("/integrations/codex/hook", {
  session_id: codexSessionId,
  hook_event_name: "UserPromptSubmit",
  turn_id: "turn_1",
  prompt: secretPrompt,
  cwd: process.cwd(),
  model: "gpt-5.4",
  permission_mode: "default"
});

await postHook("/integrations/codex/hook", {
  session_id: codexSessionId,
  hook_event_name: "PostToolUse",
  turn_id: "turn_1",
  tool_name: "Bash",
  tool_use_id: "tool_1",
  tool_input: {
    command: secretCommand
  },
  tool_response: {
    stdout: "TOKEN=secret"
  },
  cwd: process.cwd(),
  model: "gpt-5.4",
  permission_mode: "default"
});

await postHook("/integrations/claude-code/hook", {
  session_id: claudeSessionId,
  hook_event_name: "SessionStart",
  cwd: process.cwd(),
  model: "claude-sonnet-4-6",
  source: "startup",
  permission_mode: "acceptEdits"
});

await postHook("/integrations/claude-code/hook", {
  session_id: claudeSessionId,
  hook_event_name: "PostToolUseFailure",
  tool_name: "Bash",
  tool_use_id: "tool_1",
  tool_input: {
    command: secretCommand
  },
  tool_response: {
    stderr: "permission denied"
  },
  cwd: process.cwd(),
  model: "claude-sonnet-4-6",
  permission_mode: "acceptEdits"
});

const codexEvents = await getJson(`/runs/${codexRunId}/events`);
const claudeEvents = await getJson(`/runs/${claudeRunId}/events`);
const combined = JSON.stringify([codexEvents, claudeEvents]);

assert(Array.isArray(codexEvents), "Expected Codex events response to be an array.");
assert(Array.isArray(claudeEvents), "Expected Claude Code events response to be an array.");
assert(
  codexEvents.some((event) => event.type === "run_started" && event.metadata?.agent === "codex"),
  "Expected Codex SessionStart to create a run_started event."
);
assert(
  codexEvents.some((event) => event.name === "Bash command" && event.status === "success"),
  "Expected Codex PostToolUse to create a successful tool event."
);
assert(
  claudeEvents.some((event) => event.name === "Bash command" && event.status === "error"),
  "Expected Claude Code PostToolUseFailure to create an error tool event."
);
assert(!combined.includes(secretPrompt), "Raw prompt was unexpectedly persisted.");
assert(combined.includes(secretCommand), "Executed command text was not persisted.");

console.log("ToolTrace agent hook smoke passed.");
console.log(`Codex run: ${endpoint}/runs/${codexRunId}/events`);
console.log(`Claude Code run: ${endpoint}/runs/${claudeRunId}/events`);

async function postHook(path, body) {
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  assert(response.status === 202, `Expected ${path} to return 202, got ${response.status}.`);
}

async function getJson(path) {
  const response = await fetch(`${endpoint}${path}`, {
    headers: {
      accept: "application/json"
    }
  });

  assert(response.ok, `Expected ${path} to return 2xx, got ${response.status}.`);

  return response.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
