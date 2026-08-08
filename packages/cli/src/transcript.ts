import {
  classifyAction,
  type ActionCategory,
  type CommandCaptureMode
} from "@agent-trace/schema";

export type HistoryContentMode = "preview" | "metadata";

export type TranscriptTokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
};

export type TranscriptEvent = {
  kind: "prompt" | "turn";
  timestamp: string;
  text?: string;
  tokens?: TranscriptTokens;
  tools?: string[];
  actions?: TranscriptAction[];
  costUsd?: number;
  costEstimated?: boolean;
};

export type TranscriptAction = {
  callId?: string;
  name: string;
  category: ActionCategory;
  toolName?: string;
  toolKind: "command" | "tool" | "mcp";
  mcpServer?: string;
  mcpTool?: string;
  skillName?: string;
  status: "success" | "error";
  timestamp: string;
  durationMs?: number;
  resultObserved: boolean;
  command?: string;
};

export function cleanPromptPreview(value: unknown) {
  const cleaned = String(value ?? "")
    .replace(/\[Image:[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return Array.from(cleaned).slice(0, 240).join("");
}

export function parseClaudeTranscript(
  text: string,
  contentMode: HistoryContentMode,
  commandCapture: CommandCaptureMode = "metadata"
): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  const seenLineIds = new Set<string>();
  const turnsByMessageId = new Map<string, TranscriptEvent>();
  const records = parseJsonLines(text);
  const results = indexClaudeToolResults(records);

  for (const record of records) {
    const lineId = getString(record.uuid);
    if (lineId) {
      if (seenLineIds.has(lineId)) continue;
      seenLineIds.add(lineId);
    }

    const message = asRecord(record.message);
    const timestamp = getString(record.timestamp) ?? "";

    if (record.type === "user") {
      const prompt = getClaudePrompt(message.content);
      if (!prompt.valid) continue;
      events.push({
        kind: "prompt",
        timestamp,
        ...(contentMode === "preview" ? { text: prompt.text } : {})
      });
      continue;
    }

    if (record.type !== "assistant") continue;
    const usage = asRecord(message.usage);
    if (Object.keys(usage).length === 0) continue;
    const messageId = getString(message.id);
    const actions = getClaudeActions(message.content, timestamp, results, commandCapture);
    const tools = actions.map((action) => action.name);

    if (messageId && turnsByMessageId.has(messageId)) {
      const existing = turnsByMessageId.get(messageId)!;
      existing.tools = unique([...(existing.tools ?? []), ...tools]);
      existing.actions = uniqueActions([...(existing.actions ?? []), ...actions]);
      continue;
    }

    const event: TranscriptEvent = {
      kind: "turn",
      timestamp,
      tokens: makeTokens({
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens,
        cacheWrite: usage.cache_creation_input_tokens
      }),
      tools,
      actions
    };
    if (messageId) turnsByMessageId.set(messageId, event);
    events.push(event);
  }

  return events;
}

export function parseCodexTranscript(
  text: string,
  contentMode: HistoryContentMode,
  commandCapture: CommandCaptureMode = "metadata"
): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  let pendingActions: TranscriptAction[] = [];

  for (const record of parseJsonLines(text)) {
    const payload = asRecord(record.payload);
    const recordType = getString(record.type);
    const payloadType = getString(payload.type);
    const timestamp = getString(record.timestamp) ?? "";

    if (
      recordType === "response_item" &&
      ["function_call", "custom_tool_call", "tool_search_call"].includes(payloadType ?? "")
    ) {
      const tool = getToolName(payload);
      if (tool) {
        pendingActions.push(createTranscriptAction({
          callId: getString(payload.call_id) ?? getString(payload.callId),
          toolName: tool,
          argumentsValue: payload.arguments ?? payload.input,
          timestamp,
          commandCapture
        }));
      }
      continue;
    }

    if (recordType === "event_msg" && payloadType === "mcp_tool_call_end") {
      const tool = getToolName(payload);
      if (tool) {
        const [server, ...toolParts] = tool.split(".");
        pendingActions.push(createTranscriptAction({
          callId: getString(payload.call_id) ?? getString(payload.callId),
          toolName: tool,
          timestamp,
          commandCapture,
          resultObserved: true,
          explicitCategory: "mcp",
          explicitMcp: server && toolParts.length > 0
            ? { server, tool: toolParts.join(".") }
            : undefined
        }));
      }
      continue;
    }

    if (recordType === "event_msg" && payloadType === "user_message") {
      const raw = getString(payload.message) ?? getString(payload.text) ?? "";
      const marker = getImageMarker(payload);
      const prompt = cleanPromptPreview(stripCodexPreamble(raw));
      const label = [marker, prompt].filter(Boolean).join(" ");
      if (!label) continue;
      events.push({
        kind: "prompt",
        timestamp,
        ...(contentMode === "preview" ? { text: label } : {})
      });
      continue;
    }

    if (recordType !== "event_msg" || payloadType !== "token_count") continue;
    const usage = asRecord(asRecord(payload.info).last_token_usage);
    if (Object.keys(usage).length === 0) continue;
    const cacheRead = numberValue(usage.cached_input_tokens);
    const tokens = makeTokens({
      input: Math.max(0, numberValue(usage.input_tokens) - cacheRead),
      output: usage.output_tokens,
      cacheRead,
      reasoning: usage.reasoning_output_tokens
    });

    if (tokens.total === 0) {
      pendingActions = [];
      continue;
    }

    events.push({
      kind: "turn",
      timestamp,
      tokens,
      tools: unique(pendingActions.map((action) => action.name)),
      actions: uniqueActions(pendingActions)
    });
    pendingActions = [];
  }

  return events;
}

export function parseWorkBuddyTranscript(
  text: string,
  contentMode: HistoryContentMode,
  commandCapture: CommandCaptureMode = "metadata"
): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  const pendingTools: string[] = [];
  const pendingActions: TranscriptAction[] = [];
  const seenCallIds = new Set<string>();
  const records = parseJsonLines(text);
  const results = indexWorkBuddyResults(records);

  for (const record of records) {
    const timestamp = isoTimestamp(record.timestamp);

    if (record.type === "message" && record.role === "user") {
      const prompt = getWorkBuddyPrompt(record.content);
      if (prompt) {
        events.push({
          kind: "prompt",
          timestamp,
          ...(contentMode === "preview" ? { text: prompt } : {})
        });
      }
    }

    if (record.type === "function_call") {
      const callId = getString(record.callId);
      const name = getString(record.name);
      if (name && (!callId || !seenCallIds.has(callId))) {
        pendingTools.push(name);
        const result = callId ? results.get(callId) : undefined;
        pendingActions.push(createTranscriptAction({
          callId,
          toolName: name,
          argumentsValue: record.arguments ?? record.input ?? record.tool_input,
          timestamp,
          commandCapture,
          result
        }));
      }
      if (callId) seenCallIds.add(callId);
    }

    const usage = asRecord(asRecord(record.message).usage);
    if (Object.keys(usage).length === 0) continue;

    const cacheRead = numberValue(usage.cache_read_input_tokens);
    const tokens = makeTokens({
      input: Math.max(0, numberValue(usage.input_tokens) - cacheRead),
      output: usage.output_tokens,
      cacheRead,
      cacheWrite: usage.cache_creation_input_tokens,
      reasoning: usage.reasoning_tokens
    });
    if (tokens.total === 0) continue;

    events.push({
      kind: "turn",
      timestamp,
      tokens,
      tools: unique(pendingTools),
      actions: uniqueActions(pendingActions)
    });
    pendingTools.length = 0;
    pendingActions.length = 0;
  }

  return events;
}

export function parseTranscriptAiTitle(text: string) {
  for (const record of parseJsonLines(text)) {
    if (record.type !== "ai-title") continue;
    const title = cleanPromptPreview(record.aiTitle);
    if (title) return title;
  }

  return "";
}

export function resolveTranscriptTitle(options: {
  client: string;
  sessionId: string;
  nativeTitle?: string;
  aiTitle?: string;
  promptTitle?: string;
}) {
  for (const candidate of [options.nativeTitle, options.promptTitle, options.aiTitle]) {
    const title = cleanPromptPreview(candidate);
    if (title) return title;
  }

  return transcriptPlaceholder(options.client, options.sessionId);
}

export function transcriptPlaceholder(client: string, sessionId: string) {
  return `${client === "claude" ? "claude-code" : client}:${sessionId}`;
}

function getClaudePrompt(content: unknown) {
  if (typeof content === "string") {
    const text = cleanPromptPreview(content);
    return { valid: Boolean(text) && !isSyntheticClaudePrompt(text), text };
  }

  if (!Array.isArray(content)) return { valid: false, text: "" };
  if (content.some((part) => asRecord(part).type === "tool_result")) {
    return { valid: false, text: "" };
  }

  const texts = content
    .map(asRecord)
    .filter((part) => part.type === "text")
    .map((part) => getString(part.text) ?? "");
  if (texts.some(isSyntheticClaudePrompt)) return { valid: false, text: "" };
  const text = cleanPromptPreview(texts.join(" "));
  if (text) return { valid: true, text };
  return content.some((part) => asRecord(part).type === "image")
    ? { valid: true, text: "[image]" }
    : { valid: false, text: "" };
}

function getWorkBuddyPrompt(content: unknown) {
  const raw = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
      .map(asRecord)
      .filter((part) => part.type === "input_text" || part.type === "text")
      .map((part) => getString(part.text) ?? "")
      .join(" ")
      : "";
  const normalized = raw.toLowerCase();
  const openMarker = "<user_query>";
  const closeMarker = "</user_query>";
  const queryStart = normalized.lastIndexOf(openMarker);
  const queryEnd = queryStart >= 0
    ? normalized.indexOf(closeMarker, queryStart + openMarker.length)
    : -1;
  const embeddedQuery = queryStart >= 0
    ? raw.slice(queryStart + openMarker.length, queryEnd >= 0 ? queryEnd : undefined)
    : "";
  if (embeddedQuery) return cleanPromptPreview(embeddedQuery);
  if (/<system-reminder\b/i.test(raw)) return "";
  return cleanPromptPreview(raw);
}

function isSyntheticClaudePrompt(value: string) {
  const text = value.trim();
  return (
    /^\[Request interrupted/.test(text) ||
    /^Base directory for this skill:/.test(text) ||
    /^<\/?(command-name|command-message|command-args|local-command-stdout|local-command-caveat|bash-input|bash-stdout|bash-stderr|system-reminder)\b/.test(text)
  );
}

function getClaudeActions(
  content: unknown,
  timestamp: string,
  results: Map<string, IndexedToolResult>,
  commandCapture: CommandCaptureMode
) {
  if (!Array.isArray(content)) return [];
  return content
    .map(asRecord)
    .filter((part) => part.type === "tool_use")
    .map((part) => {
      const callId = getString(part.id);
      const result = callId ? results.get(callId) : undefined;
      return createTranscriptAction({
        callId,
        toolName: getString(part.name),
        argumentsValue: part.input,
        timestamp,
        commandCapture,
        result
      });
    })
    .filter((action) => action.name !== "unknown_tool");
}

type IndexedToolResult = { timestamp: string; status: "success" | "error" };

function indexClaudeToolResults(records: Record<string, unknown>[]) {
  const results = new Map<string, IndexedToolResult>();
  for (const record of records) {
    const timestamp = getString(record.timestamp) ?? "";
    const message = asRecord(record.message);
    if (!Array.isArray(message.content)) continue;
    for (const value of message.content) {
      const part = asRecord(value);
      if (part.type !== "tool_result") continue;
      const callId = getString(part.tool_use_id) ?? getString(part.toolUseId);
      if (callId) {
        results.set(callId, { timestamp, status: part.is_error === true ? "error" : "success" });
      }
    }
  }
  return results;
}

function indexWorkBuddyResults(records: Record<string, unknown>[]) {
  const results = new Map<string, IndexedToolResult>();
  for (const record of records) {
    if (record.type !== "function_call_result") continue;
    const callId = getString(record.callId);
    if (!callId) continue;
    const status = getString(record.status)?.toLowerCase();
    results.set(callId, {
      timestamp: isoTimestamp(record.timestamp),
      status: status === "error" || status === "failed" || status === "cancelled" ? "error" : "success"
    });
  }
  return results;
}

function createTranscriptAction(input: {
  callId?: string;
  toolName?: string;
  argumentsValue?: unknown;
  timestamp: string;
  commandCapture: CommandCaptureMode;
  result?: IndexedToolResult;
  resultObserved?: boolean;
  explicitCategory?: ActionCategory;
  explicitMcp?: { server: string; tool: string };
}): TranscriptAction {
  const argumentsRecord = parseArgumentsRecord(input.argumentsValue);
  const skillName = /^(slashcommand|skill)$/i.test(input.toolName ?? "")
    ? getString(argumentsRecord.skill) ?? getString(argumentsRecord.skill_name) ?? getString(argumentsRecord.name)
    : undefined;
  const classified = classifyAction({
    toolName: input.toolName,
    argumentKeys: Object.keys(argumentsRecord),
    skillName
  });
  const category = input.explicitCategory ?? classified.category;
  const started = new Date(input.timestamp).getTime();
  const ended = new Date(input.result?.timestamp ?? "").getTime();
  const command = category === "command" && input.commandCapture === "full"
    ? getCommandValue(argumentsRecord)
    : undefined;

  return {
    ...(input.callId ? { callId: input.callId } : {}),
    name: input.toolName ?? "unknown_tool",
    category,
    toolName: classified.toolName,
    toolKind: category === "mcp" ? "mcp" : category === "command" ? "command" : "tool",
    mcpServer: input.explicitMcp?.server ?? classified.mcpServer,
    mcpTool: input.explicitMcp?.tool ?? classified.mcpTool,
    skillName: classified.skillName,
    status: input.result?.status ?? "success",
    timestamp: input.timestamp,
    ...(Number.isFinite(started) && Number.isFinite(ended) && ended >= started
      ? { durationMs: ended - started }
      : {}),
    resultObserved: input.resultObserved === true || input.result !== undefined,
    ...(command ? { command } : {})
  };
}

function parseArgumentsRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asRecord(value);
}

function getCommandValue(value: Record<string, unknown>) {
  return getString(value.command) ?? getString(value.cmd) ?? getString(value.script) ?? getString(value.shell_command);
}

function stripCodexPreamble(value: string) {
  const marker = "## My request for Codex:";
  const index = value.indexOf(marker);
  return index >= 0 ? value.slice(index + marker.length) : value;
}

function getImageMarker(payload: Record<string, unknown>) {
  const count = getArrayLength(payload.images) + getArrayLength(payload.local_images);
  return count > 1 ? `[${count} images]` : count === 1 ? "[image]" : "";
}

function getToolName(payload: Record<string, unknown>) {
  return getString(payload.name) ?? getString(payload.tool_name) ?? getString(payload.tool);
}

function makeTokens(values: {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  reasoning?: unknown;
}): TranscriptTokens {
  const input = numberValue(values.input);
  const output = numberValue(values.output);
  const cacheRead = numberValue(values.cacheRead);
  const cacheWrite = numberValue(values.cacheWrite);
  const reasoning = numberValue(values.reasoning);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: input + output + cacheRead + cacheWrite
  };
}

function parseJsonLines(text: string) {
  const records: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(asRecord(JSON.parse(line)));
    } catch {
      // Ignore a single malformed transcript line.
    }
  }
  return records;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueActions(values: TranscriptAction[]) {
  const seen = new Set<string>();
  return values.filter((action) => {
    const key = action.callId ?? `${action.category}\0${action.name}\0${action.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isoTimestamp(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric < 100_000_000_000 ? numeric * 1000 : numeric).toISOString();
  }

  const text = getString(value) ?? "";
  return Number.isFinite(new Date(text).getTime()) ? new Date(text).toISOString() : "";
}

function getArrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
