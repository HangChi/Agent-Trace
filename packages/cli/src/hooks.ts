import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type HookTarget = "codex" | "claude-code";

export type RedactionLevel = "metadata";

export type HookScope = "user";

export type CodexSurface = "cli" | "desktop";

export interface InstallOptions {
  collectorUrl?: string;
  redaction?: RedactionLevel;
  scope?: HookScope;
  surface?: CodexSurface;
}

export interface InstallResult {
  target: HookTarget;
  path: string;
  backupPath?: string;
  collectorUrl: string;
  redaction: RedactionLevel;
  surface?: CodexSurface;
  events: string[];
  codexOtel?: {
    path: string;
    backupPath?: string;
    endpoint: string;
    changed: boolean;
  };
}

export interface UninstallResult {
  target: HookTarget;
  path: string;
  backupPath?: string;
  removed: number;
  changed: boolean;
}

export function uninstallHooks(target: HookTarget): UninstallResult {
  const path = resolveSettingsPath(target);

  if (!existsSync(path)) {
    return { target, path, removed: 0, changed: false };
  }

  const config = readJsonObject(path);
  const hooks = asObject(config.hooks);

  if (!hooks) {
    return { target, path, removed: 0, changed: false };
  }

  const removed = removeManagedEntries(hooks);

  if (removed === 0) {
    return { target, path, removed: 0, changed: false };
  }

  dropEmptyEventArrays(hooks);

  if (Object.keys(hooks).length === 0) {
    delete config.hooks;
  } else {
    config.hooks = hooks;
  }

  const backupPath = backupIfExists(path);
  writeJsonObject(path, config);

  return { target, path, backupPath, removed, changed: true };
}

// Marks the matcher groups that ToolTrace owns so that repeated installs and
// uninstalls only ever touch our own entries, never the user's custom hooks.
const MANAGED_MARKER = "tooltraceManaged";

const DEFAULT_COLLECTOR_URL = "http://localhost:4319";

interface HookEvent {
  event: string;
  matcher?: string;
}

// Lifecycle, prompt, tool, skill, MCP, and token-bearing events that map onto
// the collector's normalizer. Tool matchers also catch MCP tool names such as
// mcp__github__search.
const HOOK_EVENTS: HookEvent[] = [
  { event: "SessionStart" },
  { event: "Setup" },
  { event: "InstructionsLoaded" },
  { event: "UserPromptSubmit" },
  { event: "UserPromptExpansion" },
  { event: "PreToolUse", matcher: "*" },
  { event: "PermissionRequest", matcher: "*" },
  { event: "PermissionDenied", matcher: "*" },
  { event: "PostToolUse", matcher: "*" },
  { event: "PostToolUseFailure", matcher: "*" },
  { event: "PostToolBatch" },
  { event: "Notification" },
  { event: "SubagentStart" },
  { event: "SubagentStop" },
  { event: "TaskCreated" },
  { event: "TaskCompleted" },
  { event: "Stop" },
  { event: "StopFailure" },
  { event: "TeammateIdle" },
  { event: "ConfigChange" },
  { event: "CwdChanged" },
  { event: "WorktreeCreate" },
  { event: "WorktreeRemove" },
  { event: "PreCompact" },
  { event: "PostCompact" },
  { event: "Elicitation" },
  { event: "ElicitationResult" },
  { event: "SessionEnd" }
];

const INTEGRATION_PATHS: Record<HookTarget, string> = {
  codex: "/integrations/codex/hook",
  "claude-code": "/integrations/claude-code/hook"
};

export function resolveSettingsPath(target: HookTarget): string {
  if (target === "codex") {
    const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");

    return join(home, "hooks.json");
  }

  if (target === "claude-code") {
    const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

    return join(dir, "settings.json");
  }

  throw new Error(`Unsupported hook target: ${target}`);
}

export function installHooks(target: HookTarget, options: InstallOptions = {}): InstallResult {
  const collectorUrl = normalizeCollectorUrl(
    options.collectorUrl ?? process.env.TOOLTRACE_COLLECTOR_URL ?? DEFAULT_COLLECTOR_URL
  );
  const redaction = options.redaction ?? "metadata";
  const surface = target === "codex" ? normalizeCodexSurface(options.surface) : undefined;
  const path = resolveSettingsPath(target);
  const config = readJsonObject(path);
  const hooks = asObject(config.hooks) ?? {};

  // Drop any previously managed entries so re-running install is idempotent and
  // picks up changed collector URLs or redaction levels.
  removeManagedEntries(hooks);
  dropEmptyEventArrays(hooks);

  const handler = buildHandler(target, collectorUrl, INTEGRATION_PATHS[target], redaction, surface);

  for (const { event, matcher } of HOOK_EVENTS) {
    const group = asArray(hooks[event]) ?? [];
    group.push(buildManagedGroup(matcher, handler));
    hooks[event] = group;
  }

  config.hooks = hooks;

  const backupPath = backupIfExists(path);
  writeJsonObject(path, config);
  const codexOtel = target === "codex" ? installCodexOtelConfig(collectorUrl, surface ?? "cli") : undefined;

  return {
    target,
    path,
    backupPath,
    collectorUrl,
    redaction,
    surface,
    events: HOOK_EVENTS.map((entry) => entry.event),
    codexOtel
  };
}

function installCodexOtelConfig(collectorUrl: string, surface: CodexSurface) {
  const path = resolveCodexConfigPath();
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const endpoint = appendQuery(`${collectorUrl}/integrations/codex/otel/v1/logs`, {
    surface,
    surface_source: `tooltrace-${surface}`
  });
  const next = upsertCodexOtelBlock(current, endpoint);

  if (next === current) {
    return {
      path,
      endpoint,
      changed: false
    };
  }

  const backupPath = backupIfExists(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, "utf8");

  return {
    path,
    backupPath,
    endpoint,
    changed: true
  };
}

function resolveCodexConfigPath() {
  const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");

  return join(home, "config.toml");
}

function upsertCodexOtelBlock(content: string, endpoint: string) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const logUserPromptLine = "log_user_prompt = false";
  const exporterLine = `exporter = { otlp-http = { endpoint = "${escapeTomlString(endpoint)}", protocol = "json" } }`;
  const desiredLines = [logUserPromptLine, exporterLine];
  const tableStart = lines.findIndex((line) => /^\s*\[otel\]\s*(?:#.*)?$/.test(line));

  if (tableStart === -1) {
    const trimmed = normalized.endsWith("\n") || normalized.length === 0 ? normalized : `${normalized}\n`;
    const separator = trimmed.length === 0 || trimmed.endsWith("\n\n") ? "" : "\n";

    return `${trimmed}${separator}[otel]\n${desiredLines.join("\n")}\n`.replace(/\n/g, newline);
  }

  let tableEnd = lines.length;

  for (let index = tableStart + 1; index < lines.length; index += 1) {
    if (/^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(lines[index] ?? "")) {
      tableEnd = index;
      break;
    }
  }

  const before = lines.slice(0, tableStart + 1);
  const table = lines.slice(tableStart + 1, tableEnd);
  const after = lines.slice(tableEnd);
  const updatedTable = upsertTomlKey(
    upsertTomlKey(table, "log_user_prompt", logUserPromptLine),
    "exporter",
    exporterLine
  );

  return [...before, ...updatedTable, ...after].join("\n").replace(/\n/g, newline);
}

function upsertTomlKey(lines: string[], key: string, desiredLine: string) {
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  const index = lines.findIndex((line) => keyPattern.test(line));

  if (index === -1) {
    const next = [...lines];
    const insertIndex = findTomlTableAppendIndex(next);
    next.splice(insertIndex, 0, desiredLine);

    return next;
  }

  const next = [...lines];
  next[index] = desiredLine;

  return next;
}

function findTomlTableAppendIndex(lines: string[]) {
  let index = lines.length;

  while (index > 0 && lines[index - 1]?.trim() === "") {
    index -= 1;
  }

  return index;
}

function escapeTomlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildHandler(
  target: HookTarget,
  collectorUrl: string,
  integrationPath: string,
  redaction: RedactionLevel,
  surface: CodexSurface | undefined
) {
  const surfaceParams =
    target === "codex"
      ? {
          surface: surface ?? "cli",
          surface_source: `tooltrace-${surface ?? "cli"}`
        }
      : {
          surface: "cli",
          surface_source: `tooltrace-${target}`
        };
  const url = appendQuery(`${collectorUrl}${integrationPath}`, {
    redaction,
    ...surfaceParams
  });

  if (target === "claude-code") {
    return {
      type: "http",
      url,
      timeout: 5
    };
  }

  const posixCommand = `curl -sS -m 5 -o /dev/null -X POST "${url}" -H "Content-Type: application/json" --data-binary "@-"`;
  const windowsCommand = `curl.exe -sS -m 5 -o NUL -X POST "${url}" -H "Content-Type: application/json" --data-binary "@-"`;

  return {
    type: "command",
    command: process.platform === "win32" ? windowsCommand : posixCommand,
    commandWindows: windowsCommand,
    timeout: 5
  };
}

function appendQuery(url: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();

  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function buildManagedGroup(
  matcher: string | undefined,
  handler: Record<string, unknown>
) {
  const group: Record<string, unknown> = {};

  if (matcher !== undefined) {
    group.matcher = matcher;
  }

  group.hooks = [handler];
  group[MANAGED_MARKER] = true;

  return group;
}

function removeManagedEntries(hooks: Record<string, unknown>): number {
  let removed = 0;

  for (const key of Object.keys(hooks)) {
    const group = asArray(hooks[key]);

    if (!group) {
      continue;
    }

    const filtered = group.filter((entry) => !isManagedEntry(entry));
    removed += group.length - filtered.length;
    hooks[key] = filtered;
  }

  return removed;
}

function dropEmptyEventArrays(hooks: Record<string, unknown>) {
  for (const key of Object.keys(hooks)) {
    const group = asArray(hooks[key]);

    if (group && group.length === 0) {
      delete hooks[key];
    }
  }
}

function isManagedEntry(entry: unknown): boolean {
  return isObject(entry) && entry[MANAGED_MARKER] === true;
}

function backupIfExists(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.tooltrace-backup.${stamp}`;
  copyFileSync(path, backupPath);

  return backupPath;
}

function normalizeCollectorUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeCodexSurface(value: CodexSurface | undefined): CodexSurface {
  return value ?? "cli";
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }

  const raw = readFileSync(path, "utf8").trim();

  if (raw === "") {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Could not parse ${path} as JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!isObject(parsed)) {
    throw new Error(`Expected a JSON object at ${path}`);
  }

  return parsed;
}

function writeJsonObject(path: string, value: Record<string, unknown>) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
