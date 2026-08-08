import { DatabaseSync } from "node:sqlite";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readOpenCodeSession } from "./opencode-session.js";
import { parseCodexThreadIndex, readCodexThreadTitles } from "./codex-thread-index.js";
import { collectTranscriptDetails } from "./transcript-collector.js";
import { readWorkBuddySessionTitles } from "./workbuddy-session-index.js";
import {
  cleanPromptPreview,
  parseClaudeTranscript,
  parseCodexTranscript,
  parseTranscriptAiTitle,
  parseWorkBuddyTranscript,
  resolveTranscriptTitle,
  transcriptPlaceholder
} from "./transcript.js";

const indexedTitles = parseCodexThreadIndex([
  JSON.stringify({
    id: "session-a",
    thread_name: "Old title",
    updated_at: "2026-08-08T08:00:00.000Z"
  }),
  "not-json",
  JSON.stringify({
    id: "session-a",
    thread_name: "New title",
    updated_at: "2026-08-08T09:00:00.000Z"
  }),
  JSON.stringify({ id: "session-b", thread_name: "  " })
].join("\n"));

if (indexedTitles.get("session-a") !== "New title" || indexedTitles.has("session-b")) {
  throw new Error("Expected the latest valid Codex thread title per session.");
}

if (readCodexThreadTitles(join(tmpdir(), "missing-agent-trace-codex-home")).size !== 0) {
  throw new Error("Expected a missing Codex thread index to be optional.");
}

if (readWorkBuddySessionTitles(join(tmpdir(), "missing-agent-trace-workbuddy-home")).size !== 0) {
  throw new Error("Expected a missing WorkBuddy database to be optional.");
}

const claudeUsage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 200,
  cache_creation_input_tokens: 10
};
const claudeTranscript = [
  JSON.stringify({
    type: "ai-title",
    aiTitle: "Claude title",
    sessionId: "claude-session"
  }),
  JSON.stringify({
    type: "user",
    uuid: "user-1",
    timestamp: "2026-07-12T10:00:00.000Z",
    message: { content: "real prompt" }
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "assistant-block-1",
    timestamp: "2026-07-12T10:00:01.000Z",
    message: { id: "message-1", usage: claudeUsage, content: [{ type: "text", text: "ok" }] }
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "assistant-block-2",
    timestamp: "2026-07-12T10:00:01.000Z",
    message: { id: "message-1", usage: claudeUsage, content: [{ type: "tool_use", name: "Read" }] }
  }),
  JSON.stringify({
    type: "user",
    uuid: "synthetic-1",
    timestamp: "2026-07-12T10:00:02.000Z",
    message: { content: [{ type: "tool_result", content: "not a prompt" }] }
  }),
  JSON.stringify({
    type: "user",
    uuid: "user-1",
    timestamp: "2026-07-12T10:00:00.000Z",
    message: { content: "real prompt" }
  })
].join("\n");
const claudeEvents = parseClaudeTranscript(claudeTranscript, "preview");

if (parseTranscriptAiTitle(claudeTranscript) !== "Claude title") {
  throw new Error("Expected ai-title parsing to be client-independent.");
}

if (
  resolveTranscriptTitle({
    client: "claude",
    sessionId: "session-a",
    nativeTitle: "Native",
    aiTitle: "Generated",
    promptTitle: "Prompt"
  }) !== "Native" ||
  resolveTranscriptTitle({
    client: "workbuddy",
    sessionId: "session-b",
    aiTitle: "Generated",
    promptTitle: "Prompt"
  }) !== "Prompt" ||
  resolveTranscriptTitle({
    client: "workbuddy",
    sessionId: "session-c",
    aiTitle: "Generated"
  }) !== "Generated" ||
  resolveTranscriptTitle({ client: "workbuddy", sessionId: "session-d" }) !==
    "workbuddy:session-d"
) {
  throw new Error("Expected native, prompt, ai-title, and placeholder title precedence.");
}

if (transcriptPlaceholder("claude", "session-a") !== "claude-code:session-a") {
  throw new Error("Expected Claude's internal client key to use the Claude Code display prefix.");
}

if (claudeEvents.filter((event) => event.kind === "prompt").length !== 1) {
  throw new Error("Expected Claude resume replay and tool results to avoid duplicate prompts.");
}

const claudeTurns = claudeEvents.filter((event) => event.kind === "turn");
if (
  claudeTurns.length !== 1 ||
  claudeTurns[0]?.tokens?.total !== 360 ||
  claudeTurns[0]?.tools?.[0] !== "Read"
) {
  throw new Error("Expected Claude content blocks with one message id to merge into one turn.");
}

const codexTranscript = [
  JSON.stringify({
    type: "event_msg",
    timestamp: "2026-07-12T11:00:00.000Z",
    payload: {
      type: "user_message",
      message: "## My request for Codex:\nfix it",
      local_images: ["C:\\private\\shot.png"]
    }
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ command: "echo collector-secret" })
    }
  }),
  JSON.stringify({
    type: "event_msg",
    timestamp: "2026-07-12T11:00:01.000Z",
    payload: { type: "mcp_tool_call_end", tool_name: "github.search" }
  }),
  JSON.stringify({
    type: "event_msg",
    timestamp: "2026-07-12T11:00:02.000Z",
    payload: { type: "token_count", info: { last_token_usage: null } }
  }),
  JSON.stringify({
    type: "event_msg",
    timestamp: "2026-07-12T11:00:03.000Z",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 5000,
          cached_input_tokens: 4000,
          output_tokens: 200,
          reasoning_output_tokens: 50,
          total_tokens: 5200
        }
      }
    }
  })
].join("\n");
const codexEvents = parseCodexTranscript(codexTranscript, "preview");
const codexPrompt = codexEvents.find((event) => event.kind === "prompt");
const codexTurns = codexEvents.filter((event) => event.kind === "turn");

if (codexPrompt?.text !== "[image] fix it") {
  throw new Error("Expected Codex prompts to strip IDE context and retain an image marker.");
}

if (
  codexTurns.length !== 1 ||
  codexTurns[0]?.tokens?.input !== 1000 ||
  codexTurns[0]?.tokens?.cacheRead !== 4000 ||
  codexTurns[0]?.tokens?.output !== 200 ||
  codexTurns[0]?.tokens?.reasoning !== 50 ||
  codexTurns[0]?.tokens?.total !== 5200 ||
  codexTurns[0]?.tools?.join(",") !== "exec_command,github.search"
) {
  throw new Error("Expected Codex token subsets and pending tools to produce one exact turn.");
}

if (
  codexTurns[0]?.actions?.[0]?.category !== "command" ||
  codexTurns[0]?.actions?.[1]?.category !== "mcp"
) {
  throw new Error("Expected Codex offline actions to distinguish commands and explicit MCP calls.");
}

if (parseCodexTranscript(codexTranscript, "metadata").some((event) => event.text !== undefined)) {
  throw new Error("Expected metadata mode to omit prompt text.");
}

const workBuddyStartedAt = Date.parse("2026-07-12T11:30:00.000Z");
const workBuddyTranscript = [
  JSON.stringify({
    type: "message",
    role: "user",
    timestamp: workBuddyStartedAt,
    content: [{ type: "input_text", text: "inspect the workspace" }]
  }),
  JSON.stringify({
    type: "ai-title",
    timestamp: workBuddyStartedAt,
    aiTitle: "Workspace inspection"
  }),
  JSON.stringify({
    type: "function_call",
    timestamp: workBuddyStartedAt + 1000,
    callId: "call-1",
    name: "Read"
  }),
  JSON.stringify({
    type: "function_call",
    timestamp: workBuddyStartedAt + 1000,
    callId: "call-1",
    name: "Read",
    message: {
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        cache_read_input_tokens: 60
      }
    }
  })
].join("\n");
const workBuddyEvents = parseWorkBuddyTranscript(workBuddyTranscript, "preview");
const workBuddyTurn = workBuddyEvents.find((event) => event.kind === "turn");
if (
  parseTranscriptAiTitle(workBuddyTranscript) !== "Workspace inspection" ||
  workBuddyEvents.find((event) => event.kind === "prompt")?.text !== "inspect the workspace" ||
  workBuddyTurn?.tokens?.input !== 40 ||
  workBuddyTurn.tokens.cacheRead !== 60 ||
  workBuddyTurn.tokens.total !== 120 ||
  workBuddyTurn.tools?.join(",") !== "Read"
) {
  throw new Error("Expected WorkBuddy JSONL to provide title, prompts, deduplicated tools, and tokens.");
}

const offlineSecret = "sk-offline-secret";
const classifiedWorkBuddyTranscript = [
  JSON.stringify({
    type: "function_call",
    timestamp: workBuddyStartedAt,
    callId: "bash-call",
    name: "Bash",
    arguments: JSON.stringify({ command: `echo ${offlineSecret}`, description: "test" })
  }),
  JSON.stringify({
    type: "function_call_result",
    timestamp: workBuddyStartedAt + 50,
    callId: "bash-call",
    name: "Bash",
    status: "completed"
  }),
  JSON.stringify({
    type: "function_call",
    timestamp: workBuddyStartedAt + 100,
    callId: "mcp-call",
    name: "mcp__ardot__batch_edit",
    arguments: JSON.stringify({ operations: [] }),
    message: { usage: { input_tokens: 10, output_tokens: 2 } }
  })
].join("\n");
const classifiedMetadataTurn = parseWorkBuddyTranscript(
  classifiedWorkBuddyTranscript,
  "metadata",
  "metadata"
).find((event) => event.kind === "turn");
if (
  classifiedMetadataTurn?.actions?.[0]?.category !== "command" ||
  classifiedMetadataTurn.actions[0]?.resultObserved !== true ||
  classifiedMetadataTurn.actions[0]?.durationMs !== 50 ||
  classifiedMetadataTurn.actions[0]?.command !== undefined ||
  classifiedMetadataTurn.actions[1]?.category !== "mcp" ||
  classifiedMetadataTurn.actions[1]?.mcpServer !== "ardot" ||
  classifiedMetadataTurn.actions[1]?.mcpTool !== "batch_edit" ||
  JSON.stringify(classifiedMetadataTurn).includes(offlineSecret)
) {
  throw new Error("Expected metadata transcript actions to classify calls without retaining command text.");
}

const classifiedFullTurn = parseWorkBuddyTranscript(
  classifiedWorkBuddyTranscript,
  "metadata",
  "full"
).find((event) => event.kind === "turn");
if (classifiedFullTurn?.actions?.[0]?.command !== `echo ${offlineSecret}`) {
  throw new Error("Expected full command capture to require explicit opt-in.");
}

const workBuddyPromptOnlyTranscript = [
  JSON.stringify({
    type: "message",
    role: "user",
    timestamp: workBuddyStartedAt,
    content: [{
      type: "input_text",
      text: [
        '<system-reminder data-role="user-context">private workspace context',
        "Automation instructions refer to <user_query>. Follow the scheduled task.",
        "<user_query>inspect the workspace</user_query>"
      ].join("\n")
    }]
  }),
  JSON.stringify({
    type: "function_call",
    timestamp: workBuddyStartedAt + 1000,
    callId: "call-1",
    name: "Read",
    message: {
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        cache_read_input_tokens: 60
      }
    }
  })
].join("\n");

const workBuddySyntheticOnly = JSON.stringify({
  type: "message",
  role: "user",
  timestamp: workBuddyStartedAt,
  content: [{
    type: "input_text",
    text: '<system-reminder data-role="user-context">private workspace context</system-reminder>'
  }]
});
if (parseWorkBuddyTranscript(workBuddySyntheticOnly, "preview").some((event) => event.kind === "prompt")) {
  throw new Error("Expected WorkBuddy system context without a user query not to become a prompt.");
}

const dirtyPreview = `${"x".repeat(300)} [Image: source: C:\\private\\shot.png]`;
const cleanPreview = cleanPromptPreview(dirtyPreview);
if (cleanPreview.length !== 240 || cleanPreview.includes("private")) {
  throw new Error("Expected prompt previews to remove image paths and stop at 240 characters.");
}

const databasePath = join(tmpdir(), `agent-trace-opencode-${Date.now()}.db`);
try {
  createOpenCodeFixture(databasePath);
  const detail = readOpenCodeSession([databasePath], "session-open", "preview");
  const turn = detail.events.find((event) => event.kind === "turn");

  if (
    !detail.found ||
    detail.title !== "Open session" ||
    detail.events.find((event) => event.kind === "prompt")?.text !== "search the repo" ||
    turn?.tokens?.total !== 95 ||
    turn.tokens.reasoning !== 5 ||
    turn.costUsd !== 0.25 ||
    turn.tools?.[0] !== "websearch"
  ) {
    throw new Error("Expected OpenCode SQLite rows to provide prompts, tools, tokens, and real cost.");
  }
} finally {
  rmSync(databasePath, { force: true });
}

console.log("Agent-Trace transcript smoke test passed.");

const transcriptHome = join(tmpdir(), `agent-trace-transcript-home-${Date.now()}`);
try {
  const codexId = "019f0000-0000-7000-8000-000000000001";
  const codexFile = join(
    transcriptHome,
    ".codex",
    "sessions",
    "2026",
    "07",
    "12",
    `rollout-2026-07-12T12-00-00-${codexId}.jsonl`
  );
  const claudeId = "claude-session";
  const claudeFile = join(transcriptHome, ".claude", "projects", "project", `${claudeId}.jsonl`);
  const workBuddyId = "workbuddy-session";
  const workBuddyFile = join(transcriptHome, ".workbuddy", "projects", "project", `${workBuddyId}.jsonl`);
  const workBuddyDatabase = join(transcriptHome, ".workbuddy", "workbuddy.db");
  const openCodeId = "session-open";
  const openCodeFallbackId = "session-open-fallback";
  const openCodeDatabase = join(transcriptHome, ".local", "share", "opencode", "opencode.db");
  mkdirSync(join(codexFile, ".."), { recursive: true });
  mkdirSync(join(claudeFile, ".."), { recursive: true });
  mkdirSync(join(workBuddyFile, ".."), { recursive: true });
  mkdirSync(join(openCodeDatabase, ".."), { recursive: true });
  writeFileSync(codexFile, codexTranscript);
  writeFileSync(claudeFile, claudeTranscript);
  writeFileSync(workBuddyFile, workBuddyPromptOnlyTranscript);
  createWorkBuddyTitleFixture(workBuddyDatabase, workBuddyId);
  createOpenCodeFixture(openCodeDatabase);
  const codexIndexFile = join(transcriptHome, ".codex", "session_index.jsonl");
  writeFileSync(
    codexIndexFile,
    JSON.stringify({
      id: codexId,
      thread_name: "Readable Codex title",
      updated_at: "2026-08-08T09:00:00.000Z"
    })
  );
  const rows = [
    transcriptUsageRow("codex", codexId, 0.42),
    transcriptUsageRow("claude", claudeId, 0.21),
    transcriptUsageRow("opencode", openCodeId, 0.15),
    transcriptUsageRow("opencode", openCodeFallbackId, 0.05),
    transcriptUsageRow("workbuddy", workBuddyId, 0.1)
  ];
  const cache = new Map<string, string>();
  const first = await collectTranscriptDetails(transcriptHome, rows, "preview", cache);
  const second = await collectTranscriptDetails(transcriptHome, rows, "preview", cache);
  const firstCodex = first.transcripts.find((detail) => detail.client === "codex");
  const firstClaude = first.transcripts.find((detail) => detail.client === "claude");
  const firstOpenCode = first.transcripts.find((detail) => detail.client === "opencode");
  const firstOpenCodeFallback = first.transcripts.find(
    (detail) => detail.client === "opencode" && detail.sessionId === openCodeFallbackId
  );
  const firstWorkBuddy = first.transcripts.find((detail) => detail.client === "workbuddy");

  if (
    first.transcripts.length !== 5 ||
    firstCodex?.title !== "Readable Codex title" ||
    firstClaude?.title !== "real prompt" ||
    firstOpenCode?.title !== "Open session" ||
    firstOpenCodeFallback?.title !== "OpenCode prompt fallback" ||
    firstWorkBuddy?.title !== "WorkBuddy database title" ||
    first.sessionKeys.join(",") !==
      `codex:${codexId},claude:${claudeId},opencode:${openCodeId},opencode:${openCodeFallbackId},workbuddy:${workBuddyId}` ||
    first.clients.join(",") !== "codex,claude,opencode,workbuddy" ||
    second.transcripts.length !== 0 ||
    second.sessionKeys.length !== 5
  ) {
    throw new Error("Expected every transcript client to use the unified readable-title policy.");
  }

  if (JSON.stringify(first).includes("collector-secret")) {
    throw new Error("Expected transcript collection to omit command text by default.");
  }

  const fullCapture = await collectTranscriptDetails(
    transcriptHome,
    rows,
    "preview",
    new Map<string, string>(),
    "full"
  );
  if (!JSON.stringify(fullCapture).includes("collector-secret")) {
    throw new Error("Expected transcript collection to include command text only after full opt-in.");
  }

  const workBuddyTitleDatabase = new DatabaseSync(workBuddyDatabase);
  workBuddyTitleDatabase.prepare("UPDATE sessions SET custom_title = ? WHERE id = ?").run(
    "Renamed WorkBuddy database title",
    workBuddyId
  );
  workBuddyTitleDatabase.close();
  const workBuddyRenamed = await collectTranscriptDetails(transcriptHome, rows, "preview", cache);
  if (
    workBuddyRenamed.transcripts.length !== 1 ||
    workBuddyRenamed.transcripts[0]?.client !== "workbuddy" ||
    workBuddyRenamed.transcripts[0]?.title !== "Renamed WorkBuddy database title"
  ) {
    throw new Error("Expected a WorkBuddy database-only title change to refresh that transcript.");
  }

  writeFileSync(
    codexIndexFile,
    JSON.stringify({
      id: codexId,
      thread_name: "Renamed Codex title",
      updated_at: "2026-08-08T10:00:00.000Z"
    })
  );
  const renamed = await collectTranscriptDetails(transcriptHome, rows, "preview", cache);
  if (
    renamed.transcripts.length !== 1 ||
    renamed.transcripts[0]?.client !== "codex" ||
    renamed.transcripts[0]?.title !== "Renamed Codex title"
  ) {
    throw new Error("Expected a Codex index-only title change to refresh that transcript.");
  }

  appendFileSync(codexFile, "\n");
  const third = await collectTranscriptDetails(transcriptHome, rows, "preview", cache);
  if (
    third.transcripts.length !== 1 ||
    third.transcripts[0]?.client !== "codex"
  ) {
    throw new Error("Expected file fingerprints to update only the changed session.");
  }

  const metadata = await collectTranscriptDetails(transcriptHome, rows, "metadata", cache);
  const metadataClaude = metadata.transcripts.find((detail) => detail.client === "claude");
  const metadataWorkBuddy = metadata.transcripts.find((detail) => detail.client === "workbuddy");
  const metadataOpenCodeFallback = metadata.transcripts.find(
    (detail) => detail.client === "opencode" && detail.sessionId === openCodeFallbackId
  );
  if (
    metadata.transcripts.length !== 5 ||
    metadataClaude?.title !== `claude-code:${claudeId}` ||
    metadataWorkBuddy?.title !== "Renamed WorkBuddy database title" ||
    metadataOpenCodeFallback?.title !== `opencode:${openCodeFallbackId}` ||
    metadata.transcripts.some((detail) => detail.events.some((event) => event.text !== undefined))
  ) {
    throw new Error("Expected metadata mode to avoid prompt-derived titles and event text.");
  }

  writeFileSync(codexIndexFile, "");
  const fallbackCache = new Map<string, string>();
  const previewFallback = await collectTranscriptDetails(transcriptHome, rows, "preview", fallbackCache);
  const previewCodex = previewFallback.transcripts.find((detail) => detail.client === "codex");
  const metadataFallback = await collectTranscriptDetails(transcriptHome, rows, "metadata", fallbackCache);
  const metadataCodex = metadataFallback.transcripts.find((detail) => detail.client === "codex");
  if (
    previewCodex?.title !== "[image] fix it" ||
    metadataCodex?.title !== `codex:${codexId}`
  ) {
    throw new Error("Expected Codex titles to fall back to preview text and then the session ID.");
  }
} finally {
  rmSync(transcriptHome, { recursive: true, force: true });
}

function createOpenCodeFixture(path: string) {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
  `);
  const startedAt = Date.parse("2026-07-12T12:00:00.000Z");
  database.prepare("INSERT INTO session VALUES (?,?,?,?,?)").run(
    "session-open",
    null,
    "Open session",
    startedAt,
    startedAt + 1000
  );
  database.prepare("INSERT INTO session VALUES (?,?,?,?,?)").run(
    "session-open-fallback",
    null,
    "",
    startedAt + 2000,
    startedAt + 2000
  );
  database.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run(
    "user-message",
    "session-open",
    startedAt,
    startedAt,
    JSON.stringify({ role: "user", time: { created: startedAt } })
  );
  database.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run(
    "assistant-message",
    "session-open",
    startedAt + 1000,
    startedAt + 1000,
    JSON.stringify({
      role: "assistant",
      cost: 0.25,
      tokens: { input: 50, output: 30, reasoning: 5, cache: { read: 15, write: 0 } },
      time: { created: startedAt + 1000 }
    })
  );
  database.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run(
    "fallback-user-message",
    "session-open-fallback",
    startedAt + 2000,
    startedAt + 2000,
    JSON.stringify({ role: "user", time: { created: startedAt + 2000 } })
  );
  const insertPart = database.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)");
  insertPart.run(
    "part-user",
    "user-message",
    "session-open",
    startedAt,
    startedAt,
    JSON.stringify({ type: "text", text: "search the repo" })
  );
  insertPart.run(
    "part-tool",
    "assistant-message",
    "session-open",
    startedAt + 1000,
    startedAt + 1000,
    JSON.stringify({ type: "tool", tool: "websearch" })
  );
  insertPart.run(
    "part-fallback-user",
    "fallback-user-message",
    "session-open-fallback",
    startedAt + 2000,
    startedAt + 2000,
    JSON.stringify({ type: "text", text: "OpenCode prompt fallback" })
  );
  database.close();
}

function createWorkBuddyTitleFixture(path: string, sessionId: string) {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      custom_title TEXT,
      deleted_at INTEGER
    );
  `);
  database.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(
    sessionId,
    null,
    "WorkBuddy database title",
    null
  );
  database.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(
    "manual-session",
    "Manual WorkBuddy title",
    null,
    null
  );
  database.close();

  const titles = readWorkBuddySessionTitles(join(path, "..", ".."));
  if (
    titles.get(sessionId) !== "WorkBuddy database title" ||
    titles.get("manual-session") !== "Manual WorkBuddy title"
  ) {
    throw new Error("Expected WorkBuddy custom and generated database titles to be indexed.");
  }
}

function transcriptUsageRow(client: string, sessionId: string, costUsd: number) {
  return {
    client,
    sessionId,
    model: "test-model",
    provider: "test-provider",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 300,
    cacheWriteTokens: 0,
    reasoningTokens: 5,
    totalTokens: 420,
    costUsd
  };
}
