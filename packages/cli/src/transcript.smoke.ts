import { DatabaseSync } from "node:sqlite";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readOpenCodeSession } from "./opencode-session.js";
import { collectTranscriptDetails } from "./transcript-collector.js";
import {
  cleanPromptPreview,
  parseClaudeTranscript,
  parseCodexTranscript,
  parseWorkBuddyTitle,
  parseWorkBuddyTranscript
} from "./transcript.js";

const claudeUsage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 200,
  cache_creation_input_tokens: 10
};
const claudeTranscript = [
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
  JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command" } }),
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
  parseWorkBuddyTitle(workBuddyTranscript) !== "Workspace inspection" ||
  workBuddyEvents.find((event) => event.kind === "prompt")?.text !== "inspect the workspace" ||
  workBuddyTurn?.tokens?.input !== 40 ||
  workBuddyTurn.tokens.cacheRead !== 60 ||
  workBuddyTurn.tokens.total !== 120 ||
  workBuddyTurn.tools?.join(",") !== "Read"
) {
  throw new Error("Expected WorkBuddy JSONL to provide title, prompts, deduplicated tools, and tokens.");
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
  mkdirSync(join(codexFile, ".."), { recursive: true });
  mkdirSync(join(claudeFile, ".."), { recursive: true });
  mkdirSync(join(workBuddyFile, ".."), { recursive: true });
  writeFileSync(codexFile, codexTranscript);
  writeFileSync(claudeFile, claudeTranscript);
  writeFileSync(workBuddyFile, workBuddyTranscript);
  const rows = [
    transcriptUsageRow("codex", codexId, 0.42),
    transcriptUsageRow("claude", claudeId, 0.21),
    transcriptUsageRow("workbuddy", workBuddyId, 0.1)
  ];
  const cache = new Map<string, string>();
  const first = await collectTranscriptDetails(transcriptHome, rows, "preview", cache);
  const second = await collectTranscriptDetails(transcriptHome, rows, "preview", cache);

  if (
    first.transcripts.length !== 3 ||
    first.sessionKeys.join(",") !== `codex:${codexId},claude:${claudeId},workbuddy:${workBuddyId}` ||
    first.clients.join(",") !== "codex,claude,opencode,workbuddy" ||
    first.transcripts.find((detail) => detail.client === "codex")?.title !== "fix it" ||
    first.transcripts.find((detail) => detail.client === "claude")?.title !== "real prompt" ||
    second.transcripts.length !== 0 ||
    second.sessionKeys.length !== 3
  ) {
    throw new Error("Expected transcript collection to send changed details and a complete session index.");
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
  if (
    metadata.transcripts.length !== 3 ||
    metadata.transcripts.some((detail) => detail.events.some((event) => event.text !== undefined)) ||
    metadata.transcripts.some((detail) => ["fix it", "real prompt"].includes(detail.title))
  ) {
    throw new Error("Expected changing to metadata mode to rewrite every transcript without prompt text.");
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
  database.close();
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
