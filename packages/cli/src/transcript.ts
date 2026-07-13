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
  costUsd?: number;
  costEstimated?: boolean;
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
  contentMode: HistoryContentMode
): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  const seenLineIds = new Set<string>();
  const turnsByMessageId = new Map<string, TranscriptEvent>();

  for (const record of parseJsonLines(text)) {
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
    const tools = getClaudeTools(message.content);

    if (messageId && turnsByMessageId.has(messageId)) {
      const existing = turnsByMessageId.get(messageId)!;
      existing.tools = unique([...(existing.tools ?? []), ...tools]);
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
      tools
    };
    if (messageId) turnsByMessageId.set(messageId, event);
    events.push(event);
  }

  return events;
}

export function parseCodexTranscript(
  text: string,
  contentMode: HistoryContentMode
): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  let pendingTools: string[] = [];

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
      if (tool) pendingTools.push(tool);
      continue;
    }

    if (recordType === "event_msg" && payloadType === "mcp_tool_call_end") {
      const tool = getToolName(payload);
      if (tool) pendingTools.push(tool);
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
      pendingTools = [];
      continue;
    }

    events.push({
      kind: "turn",
      timestamp,
      tokens,
      tools: unique(pendingTools)
    });
    pendingTools = [];
  }

  return events;
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

function isSyntheticClaudePrompt(value: string) {
  const text = value.trim();
  return (
    /^\[Request interrupted/.test(text) ||
    /^Base directory for this skill:/.test(text) ||
    /^<\/?(command-name|command-message|command-args|local-command-stdout|local-command-caveat|bash-input|bash-stdout|bash-stderr|system-reminder)\b/.test(text)
  );
}

function getClaudeTools(content: unknown) {
  if (!Array.isArray(content)) return [];
  return unique(
    content
      .map(asRecord)
      .filter((part) => part.type === "tool_use")
      .map((part) => getString(part.name))
      .filter((name): name is string => Boolean(name))
  );
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

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
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
