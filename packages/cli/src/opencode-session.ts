import { DatabaseSync } from "node:sqlite";

import type { HistoryContentMode, TranscriptEvent, TranscriptTokens } from "./transcript.js";
import { cleanPromptPreview } from "./transcript.js";

export function readOpenCodeSession(
  databasePaths: string[],
  sessionId: string,
  contentMode: HistoryContentMode
) {
  for (const path of databasePaths) {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(path, { readOnly: true });
      database.exec("PRAGMA busy_timeout = 250");
      const session = database
        .prepare("SELECT title, time_created AS created, time_updated AS updated FROM session WHERE id = ?")
        .get(sessionId) as { title?: string; created?: number; updated?: number } | undefined;
      if (!session) continue;

      const messages = database.prepare(MESSAGES_SQL).all(sessionId) as unknown as MessageRow[];
      const parts = database.prepare(PARTS_SQL).all(sessionId) as unknown as PartRow[];
      const events = buildEvents(messages, parts, contentMode);
      return {
        found: events.length > 0,
        title: session.title ?? "",
        startedAt: isoFromMs(session.created),
        lastUsedAt: isoFromMs(session.updated) || isoFromMs(session.created),
        events
      };
    } catch {
      // Try the next discovered OpenCode database.
    } finally {
      database?.close();
    }
  }

  return { found: false, title: "", startedAt: "", lastUsedAt: "", events: [] as TranscriptEvent[] };
}

const MESSAGES_SQL = `
  SELECT id,
         CAST(COALESCE(json_extract(data,'$.time.created'), time_created) AS INTEGER) AS createdMs,
         json_extract(data,'$.role') AS role,
         json_extract(data,'$.cost') AS cost,
         json_extract(data,'$.tokens.input') AS inputTokens,
         json_extract(data,'$.tokens.output') AS outputTokens,
         json_extract(data,'$.tokens.reasoning') AS reasoningTokens,
         json_extract(data,'$.tokens.cache.read') AS cacheReadTokens,
         json_extract(data,'$.tokens.cache.write') AS cacheWriteTokens
  FROM message
  WHERE session_id = ? AND json_valid(data)
  ORDER BY createdMs ASC, id ASC`;

const PARTS_SQL = `
  SELECT message_id AS messageId,
         json_extract(data,'$.type') AS type,
         json_extract(data,'$.text') AS text,
         json_extract(data,'$.tool') AS tool
  FROM part
  WHERE session_id = ? AND json_valid(data)
  ORDER BY time_created ASC, id ASC`;

type MessageRow = {
  id: string;
  createdMs?: number;
  role?: string;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

type PartRow = {
  messageId: string;
  type?: string;
  text?: string;
  tool?: string;
};

function buildEvents(
  messages: MessageRow[],
  parts: PartRow[],
  contentMode: HistoryContentMode
): TranscriptEvent[] {
  const textByMessage = new Map<string, string[]>();
  const toolsByMessage = new Map<string, string[]>();

  for (const part of parts) {
    if (part.type === "text" && part.text) {
      const values = textByMessage.get(part.messageId) ?? [];
      values.push(part.text);
      textByMessage.set(part.messageId, values);
    } else if (part.type === "tool" && part.tool) {
      const values = toolsByMessage.get(part.messageId) ?? [];
      values.push(part.tool);
      toolsByMessage.set(part.messageId, values);
    }
  }

  return messages.flatMap((message): TranscriptEvent[] => {
    const timestamp = isoFromMs(message.createdMs);
    if (message.role === "user") {
      const text = cleanPromptPreview((textByMessage.get(message.id) ?? []).join(" "));
      return [{
        kind: "prompt",
        timestamp,
        ...(contentMode === "preview" ? { text } : {})
      }];
    }

    if (message.role !== "assistant") return [];
    const tokens = makeTokens(message);
    return [{
      kind: "turn",
      timestamp,
      tokens,
      tools: [...new Set(toolsByMessage.get(message.id) ?? [])],
      costUsd: positiveNumber(message.cost)
    }];
  });
}

function makeTokens(message: MessageRow): TranscriptTokens {
  const input = positiveNumber(message.inputTokens) ?? 0;
  const output = positiveNumber(message.outputTokens) ?? 0;
  const cacheRead = positiveNumber(message.cacheReadTokens) ?? 0;
  const cacheWrite = positiveNumber(message.cacheWriteTokens) ?? 0;
  const reasoning = positiveNumber(message.reasoningTokens) ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: input + output + cacheRead + cacheWrite
  };
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function isoFromMs(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : "";
}
