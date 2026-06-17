import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type HookTarget = "codex" | "claude-code";

export type RedactionLevel = "metadata";

export type HookScope = "user";

export interface InstallOptions {
  collectorUrl?: string;
  redaction?: RedactionLevel;
  scope?: HookScope;
}

export interface InstallResult {
  target: HookTarget;
  path: string;
  backupPath?: string;
  collectorUrl: string;
  redaction: RedactionLevel;
  events: string[];
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

// Lifecycle, prompt, and tool events that map onto the collector's normalizer.
const HOOK_EVENTS: HookEvent[] = [
  { event: "SessionStart" },
  { event: "UserPromptSubmit" },
  { event: "PreToolUse", matcher: "*" },
  { event: "PostToolUse", matcher: "*" },
  { event: "Stop" },
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
  const path = resolveSettingsPath(target);
  const config = readJsonObject(path);
  const hooks = asObject(config.hooks) ?? {};

  // Drop any previously managed entries so re-running install is idempotent and
  // picks up changed collector URLs or redaction levels.
  removeManagedEntries(hooks);
  dropEmptyEventArrays(hooks);

  const command = buildCommand(collectorUrl, INTEGRATION_PATHS[target], redaction);

  for (const { event, matcher } of HOOK_EVENTS) {
    const group = asArray(hooks[event]) ?? [];
    group.push(buildManagedGroup(matcher, command));
    hooks[event] = group;
  }

  config.hooks = hooks;

  const backupPath = backupIfExists(path);
  writeJsonObject(path, config);

  return {
    target,
    path,
    backupPath,
    collectorUrl,
    redaction,
    events: HOOK_EVENTS.map((entry) => entry.event)
  };
}

function buildCommand(collectorUrl: string, integrationPath: string, redaction: RedactionLevel) {
  const url = `${collectorUrl}${integrationPath}?redaction=${redaction}`;

  return {
    command: `curl -sS -m 5 -X POST "${url}" -H "Content-Type: application/json" --data-binary @-`,
    commandWindows: `curl.exe -sS -m 5 -X POST "${url}" -H "Content-Type: application/json" --data-binary '@-'`
  };
}

function buildManagedGroup(
  matcher: string | undefined,
  commands: { command: string; commandWindows: string }
) {
  const group: Record<string, unknown> = {};

  if (matcher !== undefined) {
    group.matcher = matcher;
  }

  group.hooks = [{ type: "command", command: commands.command, commandWindows: commands.commandWindows }];
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
