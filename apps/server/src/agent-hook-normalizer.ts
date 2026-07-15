import { randomUUID } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";

import type {
  CreateRun,
  CreateTraceEvent,
  TokenUsage,
  TraceEventType,
  TraceMetadata,
  TraceStatus,
  UpdateRun
} from "@agent-trace/schema";

import { estimateTextTokenUsage } from "./token-estimator.js";
import { providerTokenAdapter } from "./normalizers/provider-token-adapter.js";

export type AgentHookSource = "codex" | "claude-code";

export type NormalizedTrace = {
  run: CreateRun;
  event: CreateTraceEvent;
  runUpdate?: UpdateRun;
};

export type IngestHints = {
  surface?: string;
  surfaceSource?: string;
};

type TrackingCategory = "command" | "tool" | "mcp" | "skill" | "tokens" | "lifecycle";

const redactionLevel = "metadata";
const maxClaudeTranscriptBytes = 2 * 1024 * 1024;

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

export function normalizeAgentHook(
  source: AgentHookSource,
  payload: unknown,
  hints: IngestHints = {}
): NormalizedTrace {
  const body = asRecord(payload);
  const hookEvent = getString(body, "hook_event_name", "hookEventName", "hookEvent") ?? "unknown";
  const sessionId =
    getString(body, "session_id", "sessionId", "conversation_id", "conversationId") ?? "unknown";
  const turnId = getString(body, "turn_id", "turnId", "prompt_id", "promptId");
  const promptId = getString(body, "prompt_id", "promptId");
  const toolName = getString(body, "tool_name", "toolName");
  const toolUseId = getString(body, "tool_use_id", "toolUseId");
  const claudeTranscript = source === "claude-code" ? readClaudeTranscriptInfo(body) : undefined;
  const model = getHookModel(source, body, claudeTranscript);
  const provider = getHookProvider(source, body, model);
  const permissionMode = getString(body, "permission_mode", "permissionMode");
  const cwd = getString(body, "cwd");
  const command = getCommand(body, toolName);
  const mcpTool = parseMcpTool(toolName);
  const skillName = getSkillName(body, toolName, hookEvent);
  const toolKind = getToolKind(toolName);
  const transcriptTokenUsage =
    source === "claude-code" && shouldUseClaudeTranscriptUsage(hookEvent)
      ? claudeTranscript?.tokenUsage
      : undefined;
  const tokenUsage =
    providerTokenAdapter.extractHookTokenUsage(source, body, hookEvent, toolName, { model, provider }) ??
    transcriptTokenUsage ??
    estimateHookTokenUsage(source, body, hookEvent, model);
  const category = getTrackingCategory({
    hookEvent,
    toolName,
    toolKind,
    command,
    mcpTool,
    skillName,
    tokenUsage
  });
  const isKnownHookEvent = knownHookEventSet.has(hookEvent);
  const status = isKnownHookEvent ? getHookStatus(hookEvent) : "error";
  const eventType = isKnownHookEvent ? getHookEventType(hookEvent, tokenUsage) : "error";
  const surface = getHookSurface(source, body, hints);
  const metadata = compactMetadata({
    agent: source,
    surface: surface?.value,
    surfaceSource: surface?.source,
    sessionId,
    turnId,
    promptId,
    toolUseId,
    hookEvent,
    permissionMode,
    cwd,
    redactionLevel,
    provider,
    model,
    category,
    command,
    toolName,
    toolKind,
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
  const eventTimestamp = new Date().toISOString();
  const event: CreateTraceEvent = {
    id: createId("evt"),
    runId: run.id,
    type: eventType,
    name: getHookEventName(hookEvent, toolName, metadata),
    status,
    timestamp: eventTimestamp,
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
  const runUpdate = getRunUpdate(hookEvent, eventTimestamp);

  return {
    run,
    event,
    runUpdate
  };
}

export function normalizeCodexOtelLogs(payload: unknown, hints: IngestHints = {}): NormalizedTrace[] {
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
        const body = parseJsonString(otelValueToUnknown(record.body));
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
        const provider = getHookProvider("codex", { ...attributes, ...bodyRecord }, model) ?? "openai";
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
        const toolKind = getToolKind(toolName);
        const tokenUsage = providerTokenAdapter.extractTokenUsage(
          "codex",
          {
            ...attributes,
            ...bodyRecord,
            body
          },
          { model, provider }
        );
        const status = getOtelStatus(attributes, bodyRecord);
        const category = getTrackingCategory({
          hookEvent: eventName,
          toolName,
          toolKind,
          command,
          mcpTool,
          skillName,
          tokenUsage
        });
        const surface = getOtelSurface(attributes, bodyRecord, hints);
        const metadata = compactMetadata({
          agent: "codex",
          surface: surface?.value,
          surfaceSource: surface?.source,
          provider,
          sessionId,
          redactionLevel,
          model,
          hookEvent: eventName,
          category,
          command,
          toolName,
          toolKind,
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
        const eventTimestamp = getOtelTimestamp(record);
        const event: CreateTraceEvent = {
          id: createId("evt"),
          runId: run.id,
          type: traceEventType,
          name: getOtelDisplayName(eventName, toolName, command, tokenUsage),
          status,
          timestamp: eventTimestamp,
          durationMs: getNonnegativeNumber(attributes, "duration_ms", "durationMs", "duration"),
          input: getOtelRedactedPayload(bodyRecord, command),
          output: tokenUsage === undefined ? undefined : { tokenUsage },
          error: status === "error" ? { message: eventName } : undefined,
          metadata
        };

        traces.push({
          run,
          event,
          runUpdate: getOtelRunUpdate(eventName, bodyRecord, tokenUsage, eventTimestamp)
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

function getRunUpdate(hookEvent: string, eventTimestamp: string): UpdateRun | undefined {
  if (hookEvent === "SessionEnd" || hookEvent === "Stop") {
    return {
      status: "success",
      endedAt: eventTimestamp
    };
  }

  if (hookEvent === "StopFailure") {
    return {
      status: "error",
      endedAt: eventTimestamp,
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
  tokenUsage: TokenUsage | undefined,
  eventTimestamp: string
): UpdateRun | undefined {
  if (eventName.includes("turn.failed") || getString(body, "type") === "turn.failed") {
    return {
      status: "error",
      endedAt: eventTimestamp,
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
      endedAt: eventTimestamp
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
  toolKind: string | undefined;
  command: string | undefined;
  mcpTool: ReturnType<typeof parseMcpTool>;
  skillName: string | undefined;
  tokenUsage: TokenUsage | undefined;
}): TrackingCategory {
  if (input.command !== undefined || input.toolKind === "command") {
    return "command";
  }

  if (input.mcpTool !== undefined) {
    return "mcp";
  }

  if (input.skillName !== undefined) {
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

function getSkillName(
  body: Record<string, unknown>,
  toolName: string | undefined,
  hookEvent: string | undefined
) {
  const toolInput = asRecord(getValue(body, "tool_input", "toolInput"));
  const direct =
    getString(body, "skill_name", "skillName", "skill", "command_name", "commandName") ??
    getString(
      toolInput,
      "skill",
      "skill_name",
      "skillName",
      "command_name",
      "commandName"
    );

  if (direct !== undefined) {
    return direct;
  }

  if (isSkillTool(toolName)) {
    return (
      getString(toolInput, "name", "command", "id") ??
      getString(body, "name", "command", "id")
    );
  }

  if (hookEvent === "UserPromptExpansion") {
    return getString(toolInput, "name", "id") ?? getString(body, "name", "id");
  }

  return undefined;
}

function isSkillTool(toolName: string | undefined) {
  return toolName === "Skill" || toolName === "SlashCommand";
}

function getHookModel(
  source: AgentHookSource,
  body: Record<string, unknown>,
  claudeTranscript: ClaudeTranscriptInfo | undefined
) {
  return (
    getString(body, "model", "model_id", "modelId") ??
    getNestedString(body, ["message", "model"]) ??
    getNestedString(body, ["message", "model_id"]) ??
    getNestedString(body, ["response", "model"]) ??
    getNestedString(body, ["result", "model"]) ??
    (source === "claude-code" ? claudeTranscript?.model : undefined)
  );
}

type ClaudeTranscriptInfo = {
  model?: string;
  tokenUsage?: TokenUsage;
};

function readClaudeTranscriptInfo(body: Record<string, unknown>): ClaudeTranscriptInfo | undefined {
  const transcriptPath = getString(body, "transcript_path", "transcriptPath");

  if (!transcriptPath) {
    return undefined;
  }

  try {
    const windowedContent = readTextFileTail(transcriptPath, maxClaudeTranscriptBytes);
    const lines = windowedContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
    let model: string | undefined;
    let tokenUsage: TokenUsage | undefined;

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const record = asRecord(parseJsonString(lines[index]));
      model ??= getClaudeTranscriptModel(record);
      tokenUsage ??= getClaudeTranscriptTokenUsage(record, model);

      if (model !== undefined && tokenUsage !== undefined) {
        return { model, tokenUsage };
      }
    }

    if (model !== undefined || tokenUsage !== undefined) {
      return { model, tokenUsage };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function shouldUseClaudeTranscriptUsage(hookEvent: string) {
  return hookEvent === "Stop";
}

function readTextFileTail(path: string, maxBytes: number) {
  const stat = statSync(path);
  const length = Math.min(stat.size, maxBytes);

  if (length === 0) {
    return "";
  }

  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");

  try {
    readSync(fd, buffer, 0, length, stat.size - length);
  } finally {
    closeSync(fd);
  }

  return buffer.toString("utf8");
}

function getClaudeTranscriptModel(record: Record<string, unknown>) {
  const message = asRecord(record.message);
  const response = asRecord(record.response);
  const result = asRecord(record.result);

  return (
    getString(record, "model", "model_id", "modelId") ??
    getString(message, "model", "model_id", "modelId") ??
    getString(response, "model", "model_id", "modelId") ??
    getString(result, "model", "model_id", "modelId")
  );
}

function getHookProvider(
  source: AgentHookSource,
  body: Record<string, unknown>,
  model: string | undefined
) {
  const explicit = getString(
    body,
    "provider",
    "llm_provider",
    "llmProvider",
    "model_provider",
    "modelProvider",
    "gen_ai.system",
    "gen_ai.provider.name"
  );

  return (
    providerTokenAdapter.normalizeProviderName(explicit) ??
    providerTokenAdapter.inferProviderFromModel(model) ??
    (source === "claude-code" && model ? "anthropic" : undefined)
  );
}

function getClaudeTranscriptTokenUsage(
  record: Record<string, unknown>,
  model: string | undefined
): TokenUsage | undefined {
  const message = asRecord(record.message);
  const response = asRecord(record.response);
  const result = asRecord(record.result);
  const usage =
    getFirstNonEmptyRecord(
      getValue(message, "usage", "usage_metadata", "usageMetadata", "token_usage", "tokenUsage"),
      getValue(response, "usage", "usage_metadata", "usageMetadata", "token_usage", "tokenUsage"),
      getValue(result, "usage", "usage_metadata", "usageMetadata", "token_usage", "tokenUsage"),
      getValue(record, "usage", "usage_metadata", "usageMetadata", "token_usage", "tokenUsage")
    );

  if (usage === undefined) {
    return undefined;
  }

  const usageModel =
    model ??
    getClaudeTranscriptModel(record) ??
    getString(usage, "model", "model_id", "modelId");
  const provider =
    providerTokenAdapter.normalizeProviderName(getString(
      usage,
      "provider",
      "llm_provider",
      "llmProvider",
      "model_provider",
      "modelProvider",
      "gen_ai.system",
      "gen_ai.provider.name"
    )) ??
    providerTokenAdapter.inferProviderFromModel(usageModel);
  const tokenUsage = providerTokenAdapter.extractTokenUsage("claude-code", usage, {
    model: usageModel,
    provider
  });

  return tokenUsage === undefined
    ? undefined
    : { ...tokenUsage, source: "claude-code-transcript" };
}

function estimateHookTokenUsage(
  source: AgentHookSource,
  body: Record<string, unknown>,
  hookEvent: string,
  model: string | undefined
): TokenUsage | undefined {
  if (hookEvent === "UserPromptSubmit") {
    const prompt = getString(body, "prompt");

    return prompt === undefined
      ? undefined
      : estimateTextTokenUsage({
          text: prompt,
          direction: "input",
          model,
          source
        });
  }

  if (hookEvent === "Stop" || (source === "codex" && hookEvent === "StopFailure")) {
    const lastAssistantMessage = getString(body, "last_assistant_message", "lastAssistantMessage");

    return lastAssistantMessage === undefined
      ? undefined
      : estimateTextTokenUsage({
          text: lastAssistantMessage,
          direction: "output",
          model,
          source
        });
  }

  return undefined;
}

function getDurationMs(body: Record<string, unknown>, tokenUsage: TokenUsage | undefined) {
  return (
    getNonnegativeNumber(body, "duration_ms", "durationMs") ??
    (tokenUsage ? getNonnegativeNumber(asRecord(getValue(body, "tool_response", "toolResponse")), "totalDurationMs") : undefined)
  );
}

function getHookSurface(source: AgentHookSource, body: Record<string, unknown>, hints: IngestHints) {
  const explicit = getString(body, "surface", "client", "client_name", "clientName");

  if (explicit) {
    return {
      value: normalizeSurfaceName(explicit),
      source: "explicit"
    };
  }

  return getHintSurface(hints) ?? getDefaultSurface(source);
}

function getOtelSurface(
  attributes: Record<string, unknown>,
  body: Record<string, unknown>,
  hints: IngestHints
) {
  const explicit = getFirstString(
    attributes,
    body,
    "surface",
    "client",
    "client.name",
    "client_name",
    "clientName",
    "codex.surface",
    "codex.client",
    "codex.client_name",
    "app.surface",
    "app.client"
  );

  if (explicit) {
    return {
      value: normalizeSurfaceName(explicit),
      source: "explicit"
    };
  }

  return getHintSurface(hints);
}

function getHintSurface(hints: IngestHints) {
  if (!hints.surface) {
    return undefined;
  }

  return {
    value: normalizeSurfaceName(hints.surface),
    source: hints.surfaceSource ?? "collector-hint"
  };
}

function getDefaultSurface(source: AgentHookSource) {
  if (source === "claude-code") {
    return {
      value: "cli",
      source: "default"
    };
  }

  return undefined;
}

function normalizeSurfaceName(value: string) {
  const normalized = value.trim().toLowerCase();

  if (["desktop", "codex-desktop", "codex_desktop", "app"].includes(normalized)) {
    return "desktop";
  }

  if (["cli", "terminal", "shell", "codex-cli", "codex_cli", "local"].includes(normalized)) {
    return "cli";
  }

  if (["web", "browser"].includes(normalized)) {
    return "web";
  }

  return value;
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

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
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
  const timestamp = getValue(
    record,
    "timeUnixNano",
    "observedTimeUnixNano",
    "time_unix_nano",
    "observed_time_unix_nano",
    "timeUnixMilliseconds",
    "timeUnixMillis",
    "timestamp",
    "time"
  );
  const ms = parseTimestampMs(timestamp);

  return new Date(ms ?? Date.now()).toISOString();
}

function parseTimestampMs(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (/^\d+$/.test(trimmed)) {
      return normalizeNumericTimestampMs(trimmed);
    }

    const ms = new Date(trimmed).getTime();

    return isReasonableTimestampMs(ms) ? ms : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeNumericTimestampMs(value);
  }

  return undefined;
}

function normalizeNumericTimestampMs(value: string | number) {
  if (typeof value === "string") {
    const digits = BigInt(value);

    if (digits <= 0n) {
      return undefined;
    }

    if (digits >= 100_000_000_000_000_000n) {
      return Number(digits / 1_000_000n);
    }

    if (digits >= 100_000_000_000_000n) {
      return Number(digits / 1_000n);
    }

    if (digits >= 100_000_000_000n) {
      return Number(digits);
    }

    if (digits >= 1_000_000_000n) {
      return Number(digits * 1_000n);
    }

    return undefined;
  }

  if (value >= 100_000_000_000_000_000) {
    return Math.floor(value / 1_000_000);
  }

  if (value >= 100_000_000_000_000) {
    return Math.floor(value / 1_000);
  }

  if (value >= 100_000_000_000) {
    return Math.floor(value);
  }

  if (value >= 1_000_000_000) {
    return Math.floor(value * 1_000);
  }

  return undefined;
}

function isReasonableTimestampMs(value: number) {
  return Number.isFinite(value) && value >= 946_684_800_000;
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

function getFirstNonEmptyRecord(...values: unknown[]) {
  for (const value of values) {
    const record = asRecord(value);

    if (Object.keys(record).length > 0) {
      return record;
    }
  }

  return undefined;
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

function getNestedString(record: Record<string, unknown>, path: string[]) {
  let current: unknown = record;

  for (const key of path) {
    current = asRecord(current)[key];
  }

  return typeof current === "string" && current.length > 0 ? current : undefined;
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
