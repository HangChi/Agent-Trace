import { randomUUID } from "node:crypto";

import type {
  CreateRun,
  CreateTraceEvent,
  TokenUsage,
  TraceEventType,
  TraceMetadata,
  TraceStatus,
  UpdateRun
} from "@tooltrace/schema";

import { createEvent, createRun, getRunById, updateRun } from "./storage.js";

export type AgentHookSource = "codex" | "claude-code";

type NormalizedTrace = {
  run: CreateRun;
  event: CreateTraceEvent;
  runUpdate?: UpdateRun;
};

type TrackingCategory = "command" | "tool" | "mcp" | "skill" | "tokens" | "lifecycle";

const redactionLevel = "metadata";

export const knownHookEvents = [
  "SessionStart",
  "Setup",
  "InstructionsLoaded",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "MessageDisplay",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "TeammateIdle",
  "ConfigChange",
  "CwdChanged",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "SessionEnd",
  "Elicitation",
  "ElicitationResult"
] as const;

const knownHookEventSet = new Set<string>(knownHookEvents);
const errorHookEvents = new Set(["PermissionDenied", "PostToolUseFailure", "StopFailure"]);
const runningHookEvents = new Set([
  "SessionStart",
  "Setup",
  "InstructionsLoaded",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreToolUse",
  "PermissionRequest",
  "SubagentStart",
  "TaskCreated",
  "PreCompact",
  "Elicitation",
  "PostToolUseFailure",
  "PermissionDenied"
]);

export async function ingestAgentHook(source: AgentHookSource, payload: unknown) {
  const normalized = normalizeAgentHook(source, payload);
  await persistTrace(normalized);

  return {
    eventId: normalized.event.id,
    runId: normalized.run.id
  };
}

export async function ingestCodexOtelLogs(payload: unknown) {
  const normalized = normalizeCodexOtelLogs(payload);

  for (const trace of normalized) {
    await persistTrace(trace);
  }

  return {
    stored: normalized.length,
    eventIds: normalized.map((trace) => trace.event.id),
    runIds: [...new Set(normalized.map((trace) => trace.run.id))]
  };
}

async function persistTrace(normalized: NormalizedTrace) {
  const existingRun = await getRunById(normalized.run.id);

  if (!existingRun) {
    await createRun(normalized.run);
  }

  await createEvent(normalized.event);

  if (normalized.runUpdate) {
    await updateRun(normalized.run.id, normalized.runUpdate);
  }
}

export function normalizeAgentHook(source: AgentHookSource, payload: unknown): NormalizedTrace {
  const body = asRecord(payload);
  const hookEvent = getString(body, "hook_event_name", "hookEventName", "hookEvent") ?? "unknown";
  const sessionId =
    getString(body, "session_id", "sessionId", "conversation_id", "conversationId") ?? "unknown";
  const turnId = getString(body, "turn_id", "turnId", "prompt_id", "promptId");
  const promptId = getString(body, "prompt_id", "promptId");
  const toolName = getString(body, "tool_name", "toolName");
  const toolUseId = getString(body, "tool_use_id", "toolUseId");
  const model = getString(body, "model");
  const permissionMode = getString(body, "permission_mode", "permissionMode");
  const cwd = getString(body, "cwd");
  const command = getCommand(body, toolName);
  const mcpTool = parseMcpTool(toolName);
  const skillName = getSkillName(body, toolName);
  const tokenUsage = extractTokenUsage(source, body);
  const category = getTrackingCategory({ hookEvent, toolName, command, mcpTool, skillName, tokenUsage });
  const isKnownHookEvent = knownHookEventSet.has(hookEvent);
  const status = isKnownHookEvent ? getHookStatus(hookEvent) : "error";
  const eventType = isKnownHookEvent ? getHookEventType(hookEvent, tokenUsage) : "error";
  const metadata = compactMetadata({
    agent: source,
    surface: getHookSurface(source, body),
    sessionId,
    turnId,
    promptId,
    toolUseId,
    hookEvent,
    permissionMode,
    cwd,
    redactionLevel,
    model,
    category,
    command,
    toolName,
    toolKind: getToolKind(toolName),
    mcpServer: mcpTool?.server,
    mcpTool: mcpTool?.tool,
    skillName,
    tokenUsage,
    source: getString(body, "source"),
    agentId: getString(body, "agent_id", "agentId"),
    agentType: getString(body, "agent_type", "agentType", "subagent_type", "subagentType"),
    toolInputSizeBytes: getJsonSizeBytes(getValue(body, "tool_input", "toolInput")),
    toolResponseSizeBytes: getJsonSizeBytes(getValue(body, "tool_response", "toolResponse")),
    promptLength: getString(body, "prompt")?.length,
    lastAssistantMessageLength: getString(
      body,
      "last_assistant_message",
      "lastAssistantMessage"
    )?.length
  });

  const run: CreateRun = {
    id: createRunId(source, sessionId),
    name: `${source}:${sessionId}`,
    status: "running",
    input: {
      source: "agent-hook",
      redactionLevel
    },
    metadata
  };
  const event: CreateTraceEvent = {
    id: createId("evt"),
    runId: run.id,
    type: eventType,
    name: getHookEventName(hookEvent, toolName, metadata),
    status,
    timestamp: new Date().toISOString(),
    durationMs: getDurationMs(body, tokenUsage),
    input: getRedactedInput(hookEvent, body, command, skillName),
    output: getRedactedOutput(hookEvent, body, tokenUsage),
    error:
      status === "error"
        ? {
            message: isKnownHookEvent
              ? `Agent hook reported ${hookEvent}`
              : "Unknown agent hook payload"
          }
        : undefined,
    metadata
  };
  const runUpdate = getRunUpdate(hookEvent);

  return {
    run,
    event,
    runUpdate
  };
}

export function normalizeCodexOtelLogs(payload: unknown): NormalizedTrace[] {
  const traces: NormalizedTrace[] = [];
  const root = asRecord(payload);
  const resourceLogs = asArray(root.resourceLogs);

  for (const resourceLogValue of resourceLogs ?? []) {
    const resourceLog = asRecord(resourceLogValue);
    const resource = asRecord(resourceLog.resource);
    const resourceAttributes = attributesToObject(resource.attributes);
    const scopeLogs = asArray(resourceLog.scopeLogs);

    for (const scopeLogValue of scopeLogs ?? []) {
      const scopeLog = asRecord(scopeLogValue);
      const logRecords = asArray(scopeLog.logRecords);

      for (const recordValue of logRecords ?? []) {
        const record = asRecord(recordValue);
        const attributes = {
          ...resourceAttributes,
          ...attributesToObject(record.attributes)
        };
        const body = otelValueToUnknown(record.body);
        const bodyRecord = asRecord(body);
        const eventName = getOtelEventName(attributes, bodyRecord, body);
        const sessionId = getFirstString(
          attributes,
          bodyRecord,
          "conversation_id",
          "conversation.id",
          "codex.conversation_id",
          "codex.conversation.id",
          "thread_id",
          "thread.id",
          "session_id",
          "session.id",
          "gen_ai.conversation.id"
        ) ?? "otel";
        const model = getFirstString(
          attributes,
          bodyRecord,
          "model",
          "model_id",
          "gen_ai.request.model",
          "gen_ai.response.model",
          "codex.model"
        );
        const toolName = getFirstString(
          attributes,
          bodyRecord,
          "tool_name",
          "tool.name",
          "gen_ai.tool.name",
          "name"
        );
        const command = getFirstString(
          attributes,
          bodyRecord,
          "command",
          "command.command",
          "shell.command",
          "item.command"
        );
        const mcpTool = parseMcpTool(toolName);
        const skillName = getFirstString(
          attributes,
          bodyRecord,
          "skill_name",
          "skill.name",
          "command_name",
          "command.name"
        );
        const tokenUsage = extractTokenUsage("codex", {
          ...attributes,
          ...bodyRecord,
          body
        });
        const status = getOtelStatus(attributes, bodyRecord);
        const category = getTrackingCategory({
          hookEvent: eventName,
          toolName,
          command,
          mcpTool,
          skillName,
          tokenUsage
        });
        const metadata = compactMetadata({
          agent: "codex",
          surface: "cli",
          provider: "openai",
          sessionId,
          redactionLevel,
          model,
          hookEvent: eventName,
          category,
          command,
          toolName,
          toolKind: getToolKind(toolName),
          mcpServer: mcpTool?.server,
          mcpTool: mcpTool?.tool,
          skillName,
          tokenUsage,
          source: "otel",
          otelSeverity: getString(record, "severityText")
        });

        const run: CreateRun = {
          id: createRunId("codex", sessionId),
          name: `codex:${sessionId}`,
          status: "running",
          input: {
            source: "codex-otel",
            redactionLevel
          },
          metadata
        };
        const traceEventType = getOtelEventType(eventName, tokenUsage);
        const event: CreateTraceEvent = {
          id: createId("evt"),
          runId: run.id,
          type: traceEventType,
          name: getOtelDisplayName(eventName, toolName, command, tokenUsage),
          status,
          timestamp: getOtelTimestamp(record),
          durationMs: getNonnegativeNumber(attributes, "duration_ms", "durationMs", "duration"),
          input: getOtelRedactedPayload(bodyRecord, command),
          output: tokenUsage === undefined ? undefined : { tokenUsage },
          error: status === "error" ? { message: eventName } : undefined,
          metadata
        };

        traces.push({
          run,
          event,
          runUpdate: getOtelRunUpdate(eventName, bodyRecord, tokenUsage)
        });
      }
    }
  }

  return traces;
}

function getHookStatus(hookEvent: string): TraceStatus {
  if (errorHookEvents.has(hookEvent)) {
    return "error";
  }

  if (runningHookEvents.has(hookEvent)) {
    return "running";
  }

  return "success";
}

function getHookEventType(hookEvent: string, tokenUsage: TokenUsage | undefined): TraceEventType {
  if (hookEvent === "SessionStart") {
    return "run_started";
  }

  if (hookEvent === "SessionEnd") {
    return "run_ended";
  }

  if (tokenUsage !== undefined && hookEvent === "Stop") {
    return "llm_call";
  }

  if (
    hookEvent === "PreToolUse" ||
    hookEvent === "PermissionRequest" ||
    hookEvent === "PostToolUse" ||
    hookEvent === "PostToolUseFailure" ||
    hookEvent === "PermissionDenied" ||
    hookEvent === "Elicitation" ||
    hookEvent === "ElicitationResult"
  ) {
    return "tool_call";
  }

  if (hookEvent === "StopFailure" || hookEvent === "unknown" || errorHookEvents.has(hookEvent)) {
    return "error";
  }

  if (
    hookEvent === "PostToolBatch" ||
    hookEvent === "SubagentStop" ||
    hookEvent === "TaskCompleted" ||
    hookEvent === "Stop" ||
    hookEvent === "PostCompact" ||
    hookEvent === "ElicitationResult"
  ) {
    return "step_ended";
  }

  return "step_started";
}

function getHookEventName(
  hookEvent: string,
  toolName: string | undefined,
  metadata: TraceMetadata
) {
  if (typeof metadata.mcpServer === "string" && typeof metadata.mcpTool === "string") {
    return `mcp:${metadata.mcpServer}.${metadata.mcpTool}`;
  }

  if (typeof metadata.command === "string") {
    return toolName ? `${toolName} command` : "command";
  }

  if (typeof metadata.skillName === "string") {
    return `skill:${metadata.skillName}`;
  }

  if (toolName) {
    return toolName;
  }

  if (hookEvent === "UserPromptSubmit") {
    return "user_prompt";
  }

  if (hookEvent === "SubagentStart" || hookEvent === "SubagentStop") {
    const agentType = typeof metadata.agentType === "string" ? metadata.agentType : "unknown";

    return `subagent:${agentType}`;
  }

  if (hookEvent === "SessionStart" || hookEvent === "SessionEnd") {
    return "session";
  }

  if (hookEvent === "Stop" || hookEvent === "StopFailure") {
    return "turn";
  }

  if (!knownHookEventSet.has(hookEvent)) {
    return "unknown_hook_event";
  }

  return hookEvent;
}

function getRunUpdate(hookEvent: string): UpdateRun | undefined {
  if (hookEvent === "SessionEnd" || hookEvent === "Stop") {
    return {
      status: "success",
      endedAt: new Date().toISOString()
    };
  }

  if (hookEvent === "StopFailure") {
    return {
      status: "error",
      endedAt: new Date().toISOString(),
      error: "Agent hook reported StopFailure"
    };
  }

  if (runningHookEvents.has(hookEvent)) {
    return {
      status: "running",
      endedAt: null
    };
  }

  return undefined;
}

function getOtelRunUpdate(
  eventName: string,
  body: Record<string, unknown>,
  tokenUsage: TokenUsage | undefined
): UpdateRun | undefined {
  if (eventName.includes("turn.failed") || getString(body, "type") === "turn.failed") {
    return {
      status: "error",
      endedAt: new Date().toISOString(),
      error: "Codex turn failed"
    };
  }

  if (
    eventName.includes("turn.completed") ||
    getString(body, "type") === "turn.completed" ||
    tokenUsage !== undefined
  ) {
    return {
      status: "success",
      endedAt: new Date().toISOString()
    };
  }

  if (
    eventName.includes("turn.started") ||
    eventName.includes("conversation_starts") ||
    getString(body, "type") === "turn.started"
  ) {
    return {
      status: "running",
      endedAt: null
    };
  }

  return undefined;
}

function getRedactedInput(
  hookEvent: string,
  body: Record<string, unknown>,
  command: string | undefined,
  skillName: string | undefined
) {
  if (hookEvent === "UserPromptSubmit") {
    const prompt = getString(body, "prompt");

    return prompt === undefined
      ? undefined
      : {
          promptLength: prompt.length
        };
  }

  if (command !== undefined) {
    return {
      command
    };
  }

  if (skillName !== undefined) {
    return {
      skillName
    };
  }

  const toolInputSizeBytes = getJsonSizeBytes(getValue(body, "tool_input", "toolInput"));

  if (toolInputSizeBytes !== undefined) {
    return {
      toolInputSizeBytes
    };
  }

  const source = getString(body, "source");

  return source === undefined
    ? undefined
    : {
        source
      };
}

function getRedactedOutput(
  hookEvent: string,
  body: Record<string, unknown>,
  tokenUsage: TokenUsage | undefined
) {
  if (tokenUsage !== undefined) {
    return {
      tokenUsage
    };
  }

  if (hookEvent === "Stop" || hookEvent === "StopFailure") {
    const lastAssistantMessage = getString(body, "last_assistant_message", "lastAssistantMessage");

    return lastAssistantMessage === undefined
      ? undefined
      : {
          lastAssistantMessageLength: lastAssistantMessage.length
        };
  }

  const toolResponseSizeBytes = getJsonSizeBytes(getValue(body, "tool_response", "toolResponse"));

  return toolResponseSizeBytes === undefined
    ? undefined
    : {
        toolResponseSizeBytes
      };
}

function getTrackingCategory(input: {
  hookEvent: string;
  toolName: string | undefined;
  command: string | undefined;
  mcpTool: ReturnType<typeof parseMcpTool>;
  skillName: string | undefined;
  tokenUsage: TokenUsage | undefined;
}): TrackingCategory {
  if (input.command !== undefined) {
    return "command";
  }

  if (input.mcpTool !== undefined) {
    return "mcp";
  }

  if (input.skillName !== undefined || input.hookEvent === "UserPromptExpansion") {
    return "skill";
  }

  if (input.toolName !== undefined) {
    return "tool";
  }

  if (input.tokenUsage !== undefined) {
    return "tokens";
  }

  return "lifecycle";
}

function getCommand(body: Record<string, unknown>, toolName: string | undefined) {
  const toolInput = asRecord(getValue(body, "tool_input", "toolInput"));
  const command =
    getString(toolInput, "command", "cmd", "script", "shell_command") ??
    getString(body, "command", "cmd", "shellCommand");

  if (command === undefined) {
    return undefined;
  }

  if (!toolName) {
    return command;
  }

  return isCommandTool(toolName) ? command : undefined;
}

function isCommandTool(toolName: string) {
  return /^(bash|shell|command|powershell|cmd|terminal)$/i.test(toolName) ||
    toolName.toLowerCase().includes("shell_command") ||
    toolName.toLowerCase().includes("command_execution");
}

function getToolKind(toolName: string | undefined) {
  if (!toolName) {
    return undefined;
  }

  if (isCommandTool(toolName)) {
    return "command";
  }

  if (parseMcpTool(toolName)) {
    return "mcp";
  }

  return "tool";
}

function parseMcpTool(toolName: string | undefined) {
  if (!toolName?.startsWith("mcp__")) {
    return undefined;
  }

  const [, server, ...toolParts] = toolName.split("__");
  const tool = toolParts.join("__");

  if (!server || !tool) {
    return undefined;
  }

  return { server, tool };
}

function getSkillName(body: Record<string, unknown>, toolName: string | undefined) {
  const toolInput = asRecord(getValue(body, "tool_input", "toolInput"));
  const direct =
    getString(body, "skill_name", "skillName", "command_name", "commandName") ??
    getString(toolInput, "skill", "skill_name", "skillName", "command_name", "commandName");

  if (direct !== undefined) {
    return direct;
  }

  if (toolName === "Skill" || toolName === "SlashCommand") {
    return getString(toolInput, "name", "command", "id");
  }

  return undefined;
}

function extractTokenUsage(source: AgentHookSource, value: unknown): TokenUsage | undefined {
  const candidates = getUsageCandidates(value);

  for (const candidate of candidates) {
    const usage = source === "claude-code" ? parseClaudeUsage(candidate) : parseCodexUsage(candidate);

    if (usage !== undefined) {
      return usage;
    }
  }

  return undefined;
}

function getUsageCandidates(value: unknown): Record<string, unknown>[] {
  const root = asRecord(value);
  const candidates = [
    root,
    asRecord(getValue(root, "usage", "token_usage", "tokenUsage")),
    asRecord(getValue(root, "response")),
    asRecord(getValue(asRecord(getValue(root, "response")), "usage", "token_usage", "tokenUsage")),
    asRecord(getValue(root, "tool_response", "toolResponse")),
    asRecord(getValue(asRecord(getValue(root, "tool_response", "toolResponse")), "usage")),
    asRecord(getValue(root, "body")),
    asRecord(getValue(asRecord(getValue(root, "body")), "usage", "token_usage", "tokenUsage"))
  ];

  return candidates.filter((entry) => Object.keys(entry).length > 0);
}

function parseCodexUsage(usage: Record<string, unknown>): TokenUsage | undefined {
  const input =
    getNumber(usage, "input_tokens", "inputTokens", "input", "gen_ai.usage.input_tokens") ?? 0;
  const output =
    getNumber(usage, "output_tokens", "outputTokens", "output", "gen_ai.usage.output_tokens") ?? 0;
  const total =
    getNumber(usage, "total_tokens", "totalTokens", "total", "gen_ai.usage.total_tokens") ??
    input + output;
  const cachedInput =
    getNumber(usage, "cached_input_tokens", "cachedInputTokens", "cachedInput") ??
    getNestedNumber(usage, ["input_tokens_details", "cached_tokens"]) ??
    getNestedNumber(usage, ["inputTokensDetails", "cachedTokens"]);
  const reasoningOutput =
    getNumber(usage, "reasoning_output_tokens", "reasoningOutputTokens", "reasoningOutput") ??
    getNestedNumber(usage, ["output_tokens_details", "reasoning_tokens"]) ??
    getNestedNumber(usage, ["outputTokensDetails", "reasoningTokens"]);

  if (input === 0 && output === 0 && total === 0) {
    return undefined;
  }

  return compactTokenUsage({
    input,
    output,
    total,
    cachedInput,
    reasoningOutput,
    source: "codex"
  });
}

function parseClaudeUsage(usage: Record<string, unknown>): TokenUsage | undefined {
  const nestedUsage = asRecord(getValue(usage, "usage"));
  const anthropicUsage = Object.keys(nestedUsage).length > 0 ? nestedUsage : usage;
  const input =
    getNumber(anthropicUsage, "input_tokens", "inputTokens", "input") ??
    getNumber(usage, "input_tokens", "inputTokens", "input") ??
    0;
  const output =
    getNumber(anthropicUsage, "output_tokens", "outputTokens", "output") ??
    getNumber(usage, "output_tokens", "outputTokens", "output") ??
    0;
  const cacheCreationInput =
    getNumber(anthropicUsage, "cache_creation_input_tokens", "cacheCreationInputTokens") ??
    getNumber(usage, "cache_creation_input_tokens", "cacheCreationInputTokens");
  const cacheReadInput =
    getNumber(anthropicUsage, "cache_read_input_tokens", "cacheReadInputTokens") ??
    getNumber(usage, "cache_read_input_tokens", "cacheReadInputTokens");
  const total =
    getNumber(usage, "totalTokens", "total_tokens", "total") ??
    input + output + (cacheCreationInput ?? 0) + (cacheReadInput ?? 0);

  if (input === 0 && output === 0 && total === 0) {
    return undefined;
  }

  return compactTokenUsage({
    input,
    output,
    total,
    cacheCreationInput,
    cacheReadInput,
    cachedInput: cacheReadInput,
    source: "claude-code"
  });
}

function compactTokenUsage(usage: TokenUsage): TokenUsage {
  return Object.fromEntries(
    Object.entries(usage).filter(([, entry]) => entry !== undefined)
  ) as TokenUsage;
}

function getDurationMs(body: Record<string, unknown>, tokenUsage: TokenUsage | undefined) {
  return (
    getNonnegativeNumber(body, "duration_ms", "durationMs") ??
    (tokenUsage ? getNonnegativeNumber(asRecord(getValue(body, "tool_response", "toolResponse")), "totalDurationMs") : undefined)
  );
}

function getHookSurface(source: AgentHookSource, body: Record<string, unknown>) {
  const explicit = getString(body, "surface", "client", "client_name", "clientName");

  if (explicit) {
    return explicit;
  }

  return source === "codex" ? "desktop" : "cli";
}

function attributesToObject(value: unknown) {
  const attributes = asArray(value);
  const result: Record<string, unknown> = {};

  for (const item of attributes ?? []) {
    const record = asRecord(item);
    const key = getString(record, "key");

    if (!key) {
      continue;
    }

    result[key] = otelValueToUnknown(record.value);
  }

  return result;
}

function otelValueToUnknown(value: unknown): unknown {
  const record = asRecord(value);

  if (Object.keys(record).length === 0) {
    return value;
  }

  if ("stringValue" in record) {
    return record.stringValue;
  }

  if ("intValue" in record) {
    return toNumber(record.intValue);
  }

  if ("doubleValue" in record) {
    return toNumber(record.doubleValue);
  }

  if ("boolValue" in record) {
    return Boolean(record.boolValue);
  }

  if ("arrayValue" in record) {
    return (asArray(asRecord(record.arrayValue).values) ?? []).map(otelValueToUnknown);
  }

  if ("kvlistValue" in record) {
    return attributesToObject(asRecord(record.kvlistValue).values);
  }

  return value;
}

function getOtelEventName(
  attributes: Record<string, unknown>,
  body: Record<string, unknown>,
  rawBody: unknown
) {
  return (
    getString(attributes, "event.name", "name", "log.name") ??
    getString(body, "type", "event", "name") ??
    (typeof rawBody === "string" && rawBody.length > 0 ? rawBody : undefined) ??
    "codex.otel"
  );
}

function getOtelStatus(attributes: Record<string, unknown>, body: Record<string, unknown>): TraceStatus {
  const success = getValue(attributes, "success", "otel.status_code") ?? getValue(body, "success");

  if (success === false || success === "false" || getString(attributes, "error", "exception.message")) {
    return "error";
  }

  const status = getString(attributes, "status", "otel.status_code") ?? getString(body, "status");

  if (status?.toLowerCase() === "error" || status?.toLowerCase() === "failed") {
    return "error";
  }

  if (status?.toLowerCase() === "running" || status?.toLowerCase() === "in_progress") {
    return "running";
  }

  return "success";
}

function getOtelEventType(eventName: string, tokenUsage: TokenUsage | undefined): TraceEventType {
  if (eventName.includes("conversation_starts") || eventName.includes("thread.started")) {
    return "run_started";
  }

  if (eventName.includes("turn.completed") || eventName.includes("turn.failed")) {
    return "step_ended";
  }

  if (eventName.includes("tool") || eventName.includes("item.")) {
    return "tool_call";
  }

  if (tokenUsage !== undefined || eventName.includes("sse_event") || eventName.includes("response.completed")) {
    return "llm_call";
  }

  if (eventName.includes("error")) {
    return "error";
  }

  return "step_started";
}

function getOtelDisplayName(
  eventName: string,
  toolName: string | undefined,
  command: string | undefined,
  tokenUsage: TokenUsage | undefined
) {
  if (command !== undefined) {
    return "command";
  }

  if (toolName !== undefined) {
    const mcp = parseMcpTool(toolName);

    return mcp ? `mcp:${mcp.server}.${mcp.tool}` : toolName;
  }

  if (tokenUsage !== undefined) {
    return "token_usage";
  }

  return eventName;
}

function getOtelTimestamp(record: Record<string, unknown>) {
  const unixNano = getValue(record, "timeUnixNano", "observedTimeUnixNano");

  if (typeof unixNano === "string" && /^\d+$/.test(unixNano)) {
    return new Date(Number(BigInt(unixNano) / 1_000_000n)).toISOString();
  }

  if (typeof unixNano === "number" && Number.isFinite(unixNano)) {
    return new Date(Math.floor(unixNano / 1_000_000)).toISOString();
  }

  return new Date().toISOString();
}

function getOtelRedactedPayload(body: Record<string, unknown>, command: string | undefined) {
  if (command !== undefined) {
    return { command };
  }

  return Object.keys(body).length === 0 ? undefined : { bodySizeBytes: getJsonSizeBytes(body) };
}

function createRunId(source: AgentHookSource, sessionId: string) {
  return `run_${toIdPart(source)}_${toIdPart(sessionId)}`;
}

function createId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function toIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

function getFirstString(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  ...keys: string[]
) {
  return getString(first, ...keys) ?? getString(second, ...keys);
}

function getString(record: Record<string, unknown>, ...keys: string[]) {
  const value = getValue(record, ...keys);

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumber(record: Record<string, unknown>, ...keys: string[]) {
  const value = getValue(record, ...keys);

  return toNumber(value);
}

function getNestedNumber(record: Record<string, unknown>, path: string[]) {
  let current: unknown = record;

  for (const key of path) {
    current = asRecord(current)[key];
  }

  return toNumber(current);
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
    return Math.floor(Number(value));
  }

  return undefined;
}

function getNonnegativeNumber(record: Record<string, unknown>, ...keys: string[]) {
  const value = getValue(record, ...keys);

  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function getValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function getJsonSizeBytes(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}

function compactMetadata(value: TraceMetadata) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as TraceMetadata;
}
