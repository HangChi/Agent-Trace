#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  installHooks,
  uninstallHooks,
  type CodexSurface,
  type HookScope,
  type HookTarget,
  type RedactionLevel
} from "./hooks.js";
import {
  collectUsageClientDiagnostics,
  collectUsageOnce,
  isUsageScannerEnabled,
  syncUsageClients,
  watchUsage
} from "./usage.js";

const command = process.argv[2];
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

if (!command || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "dev") {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printDevHelp();
    process.exit(0);
  }

  await runDev(process.argv.slice(3));
  process.exit(0);
}

if (command === "usage") {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsageHelp();
    process.exit(0);
  }

  await runUsage(process.argv.slice(3));
  process.exit(0);
}

if (command === "install") {
  runInstall(process.argv.slice(3));
  process.exit(0);
}

if (command === "uninstall") {
  runUninstall(process.argv.slice(3));
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
printHelp();
process.exit(1);

function runInstall(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printInstallHelp();
    return;
  }

  const { positionals, flags } = parseFlags(argv);
  const target = parseTarget(positionals[0]);
  const scope = parseScope(flags.scope);
  const redaction = parseRedaction(flags.redaction);
  const surface = parseSurface(target, flags.surface);
  const collectorUrl = flags["collector-url"];

  const result = installHooks(target, { scope, redaction, collectorUrl, surface });

  console.log(`Installed Agent-Trace tracing hooks for ${result.target} (${scope} scope).`);
  console.log(`Config: ${result.path}`);
  console.log(`Collector: ${result.collectorUrl}`);
  console.log(`Redaction: ${result.redaction}`);
  if (result.surface) {
    console.log(`Surface: ${result.surface}`);
  }
  console.log(`Events: ${result.events.join(", ")}`);

  if (result.backupPath) {
    console.log(`Backup: ${result.backupPath}`);
  }

  if (result.codexOtel) {
    console.log(
      `Codex OTel: ${result.codexOtel.path} (${result.codexOtel.changed ? "updated" : "already configured"})`
    );
    console.log(`Codex OTel endpoint: ${result.codexOtel.endpoint}`);
    console.log("Restart Codex after install so token telemetry settings are loaded.");

    if (result.codexOtel.backupPath) {
      console.log(`Codex config backup: ${result.codexOtel.backupPath}`);
    }
  }
}

function runUninstall(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUninstallHelp();
    return;
  }

  const { positionals } = parseFlags(argv);
  const target = parseTarget(positionals[0]);

  const result = uninstallHooks(target);

  if (!result.changed) {
    console.log(`No Agent-Trace tracing hooks found for ${target}.`);
    console.log(`Config: ${result.path}`);
    return;
  }

  console.log(`Removed ${result.removed} Agent-Trace tracing hook entries for ${target}.`);
  console.log(`Config: ${result.path}`);

  if (result.backupPath) {
    console.log(`Backup: ${result.backupPath}`);
  }
}

function parseTarget(value: string | undefined): HookTarget {
  if (value === "codex" || value === "claude-code") {
    return value;
  }

  console.error(`Unknown install target: ${value ?? "(missing)"}`);
  printInstallHelp();
  process.exit(1);
}

function parseScope(value: string | undefined): HookScope {
  if (value === undefined || value === "user") {
    return "user";
  }

  console.error(`Unsupported scope: ${value}. Only "user" is supported.`);
  process.exit(1);
}

function parseRedaction(value: string | undefined): RedactionLevel {
  if (value === undefined || value === "metadata") {
    return "metadata";
  }

  console.error(`Unsupported redaction level: ${value}. Only "metadata" is supported.`);
  process.exit(1);
}

function parseSurface(target: HookTarget, value: string | undefined): CodexSurface | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (target !== "codex") {
    console.error("--surface is only supported for the codex target.");
    process.exit(1);
  }

  if (value === "cli" || value === "desktop") {
    return value;
  }

  console.error(`Unsupported surface: ${value}. Use "cli" or "desktop".`);
  process.exit(1);
}

function parseFlags(argv: string[]) {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === undefined) {
      continue;
    }

    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");

      if (equals !== -1) {
        flags[arg.slice(2, equals)] = arg.slice(equals + 1);
        continue;
      }

      const next = argv[index + 1];

      if (next !== undefined && !next.startsWith("--")) {
        flags[arg.slice(2)] = next;
        index += 1;
      } else {
        flags[arg.slice(2)] = "true";
      }

      continue;
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}

async function runDev(argv: string[] = []) {
  const { flags } = parseFlags(argv);
  const serverPort = getEnv("AGENT_TRACE_SERVER_PORT", "TOOLTRACE_SERVER_PORT") ?? "4319";
  const webPort = getEnv("AGENT_TRACE_WEB_PORT", "TOOLTRACE_WEB_PORT") ?? "3000";
  const databasePath = getEnv("AGENT_TRACE_DB_PATH", "TOOLTRACE_DB_PATH");
  const serverUrl = `http://localhost:${serverPort}`;
  const usageScan = isUsageScannerEnabled(
    flags["usage-scan"] ?? process.env.AGENT_TRACE_USAGE_SCAN
  );
  const usageSync = flags["usage-sync"] === "true" || flags.sync === "true";
  const usageClients = flags["usage-clients"] ?? process.env.AGENT_TRACE_USAGE_CLIENTS;
  const usageHome = flags["usage-home"] ?? flags.home ?? process.env.AGENT_TRACE_USAGE_HOME;
  const usageIntervalMs = parsePositiveNumber(flags["usage-interval-ms"]) ?? 15_000;
  const children: ChildProcess[] = [];

  console.log("Starting Agent-Trace local dashboard...");
  console.log(`Collector: ${serverUrl}`);
  console.log(`Dashboard: http://localhost:${webPort}`);

  await runPnpm(["--filter", "@agent-trace/server", "db:init"], {
    AGENT_TRACE_DB_PATH: databasePath
  });

  children.push(
    spawnPnpm(["--filter", "@agent-trace/server", "dev"], {
      PORT: serverPort,
      AGENT_TRACE_DB_PATH: databasePath
    })
  );

  children.push(
    spawnPnpm(["--filter", "@agent-trace/web", "dev"], {
      PORT: webPort,
      AGENT_TRACE_API_URL: serverUrl,
      TOOLTRACE_API_URL: serverUrl
    })
  );

  const usageAbortController = new AbortController();

  if (usageScan) {
    console.log(
      `Usage scan: enabled (${usageClients ?? "all tokscale clients"}, every ${usageIntervalMs}ms${usageSync ? ", sync first" : ""})`
    );
    void watchUsage({
      collectorUrl: serverUrl,
      clients: usageClients,
      home: usageHome,
      sync: usageSync,
      intervalMs: usageIntervalMs,
      signal: usageAbortController.signal
    });
  }

  const stop = () => {
    usageAbortController.abort();
    for (const child of children) {
      child.kill();
    }
  };

  process.once("SIGINT", () => {
    stop();
    process.exit(130);
  });

  process.once("SIGTERM", () => {
    stop();
    process.exit(143);
  });

  await Promise.race(
    children.map(
      (child) =>
        new Promise<void>((resolve, reject) => {
          child.once("exit", (code) => {
            if (code === 0 || code === null) {
              resolve();
            } else {
              reject(new Error(`Agent-Trace child process exited with code ${code}`));
            }
          });
        })
    )
  );
}

async function runUsage(argv: string[]) {
  const { flags, positionals } = parseFlags(argv);
  const collectorUrl =
    flags["collector-url"] ??
    process.env.AGENT_TRACE_COLLECTOR_URL ??
    process.env.AGENT_TRACE_ENDPOINT ??
    process.env.TOOLTRACE_COLLECTOR_URL ??
    process.env.TOOLTRACE_ENDPOINT;
  const clients = flags.clients ?? flags["usage-clients"] ?? process.env.AGENT_TRACE_USAGE_CLIENTS;
  const home = flags.home ?? flags["usage-home"] ?? process.env.AGENT_TRACE_USAGE_HOME;
  const intervalMs = parsePositiveNumber(flags["interval-ms"]) ?? 15_000;
  const commandTimeoutMs = parsePositiveNumber(flags["timeout-ms"]);
  const sync = flags.sync === "true" || flags["usage-sync"] === "true";

  if (positionals[0] === "clients") {
    const diagnostics = await collectUsageClientDiagnostics({
      home,
      commandTimeoutMs
    });

    if (flags.json === "true") {
      console.log(JSON.stringify({ diagnostics }, null, 2));
    } else {
      printUsageDiagnostics(diagnostics);
    }
    return;
  }

  if (positionals[0] === "sync") {
    const diagnostics = await syncUsageClients({
      clients,
      home,
      commandTimeoutMs
    });

    if (flags.json === "true") {
      console.log(JSON.stringify({ diagnostics }, null, 2));
    } else {
      printUsageDiagnostics(diagnostics);
    }
    return;
  }

  if (flags.watch === "true") {
    const abortController = new AbortController();
    process.once("SIGINT", () => {
      abortController.abort();
      process.exit(130);
    });
    process.once("SIGTERM", () => {
      abortController.abort();
      process.exit(143);
    });

    await watchUsage({
      collectorUrl,
      clients,
      home,
      sync,
      intervalMs,
      commandTimeoutMs,
      signal: abortController.signal
    });
    return;
  }

  const result = await collectUsageOnce({
    collectorUrl,
    clients,
    home,
    sync,
    commandTimeoutMs
  });

  console.log(`Posted ${result.rows} usage rows to Agent-Trace.`);
  if (result.diagnostics > 0) {
    console.log(`Included ${result.diagnostics} scanner diagnostics.`);
  }
}

function runPnpm(args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnPnpm(args, env);

    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pnpm ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

function spawnPnpm(args: string[], env: NodeJS.ProcessEnv = {}) {
  const pnpm = resolvePnpmCommand();
  const child = spawn(pnpm.command, [...pnpm.args, ...args], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      ...withoutUndefined(env)
    },
    shell: process.platform === "win32" && pnpm.args.length === 0,
    stdio: "inherit"
  });

  child.once("error", (error) => {
    console.error(error.message);
  });

  return child;
}

function resolvePnpmCommand() {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath?.toLowerCase().includes("pnpm")) {
    return {
      command: process.execPath,
      args: [npmExecPath]
    };
  }

  return {
    command: "pnpm",
    args: []
  };
}

function withoutUndefined(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

function getEnv(primary: string, legacy: string) {
  return process.env[primary] ?? process.env[legacy];
}

function parsePositiveNumber(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function printUsageDiagnostics(
  diagnostics: Array<{
    client: string;
    status: string;
    messageCount?: number;
    path?: string;
    pathExists?: boolean;
    warning?: string;
    actionHint?: string;
  }>
) {
  if (diagnostics.length === 0) {
    console.log("No usage client diagnostics returned.");
    return;
  }

  for (const diagnostic of diagnostics) {
    const count = diagnostic.messageCount !== undefined
      ? ` messages=${diagnostic.messageCount.toLocaleString()}`
      : "";
    const path = diagnostic.path
      ? ` path=${diagnostic.path}${diagnostic.pathExists === false ? " (missing)" : ""}`
      : "";

    console.log(`${diagnostic.client}: ${diagnostic.status}${count}${path}`);

    if (diagnostic.warning) {
      console.log(`  warning: ${diagnostic.warning}`);
    }

    if (diagnostic.actionHint) {
      console.log(`  action: ${diagnostic.actionHint}`);
    }
  }
}

function printHelp() {
  console.log(`Agent-Trace CLI

Usage:
  agent-trace dev
  agent-trace usage [--once|--watch] [options]
  agent-trace usage clients --home <path> [--json]
  agent-trace usage sync --clients <clients> --home <path>
  agent-trace install <target> [options]
  agent-trace uninstall <target>

Commands:
  dev        Start the local collector and dashboard
  usage      Scan local agent usage with tokscale and post summary rows
  install    Install global agent tracing hooks
  uninstall  Remove Agent-Trace-managed tracing hooks

Targets:
  codex      Codex (~/.codex/hooks.json)
  claude-code  Claude Code (~/.claude/settings.json)
`);
}

function printInstallHelp() {
  console.log(`agent-trace install <target> [options]

Targets:
  codex                  Codex (~/.codex/hooks.json)
  claude-code            Claude Code (~/.claude/settings.json)

Options:
  --scope <scope>        Config scope, default user (only user is supported)
  --redaction <level>    Redaction level, default metadata
  --surface <surface>    Codex surface hint: cli or desktop, default cli
  --collector-url <url>  Collector base URL, default http://localhost:4319

Environment:
  CODEX_HOME                Codex config directory override
  CLAUDE_CONFIG_DIR         Claude Code config directory override
  AGENT_TRACE_COLLECTOR_URL   Default collector base URL
  TOOLTRACE_COLLECTOR_URL     Legacy collector base URL

A timestamped .agent-trace-backup file is created before the config is changed.
Re-running install is safe; it replaces only the Agent-Trace-managed entries.
For Codex, install also configures JSON OTel logs for token usage; restart Codex
after install so the new telemetry setting is loaded. Codex Desktop and CLI share
the same Codex config, so the last codex install surface is the one that will be
reported until you reinstall with another --surface value.
`);
}

function printUninstallHelp() {
  console.log(`agent-trace uninstall <target>

Targets:
  codex                  Codex (~/.codex/hooks.json)
  claude-code            Claude Code (~/.claude/settings.json)

Removes only the Agent-Trace-managed hook entries. User-defined hooks and other
config keys are left untouched. A timestamped .agent-trace-backup file is created
before the config is changed.
`);
}

function printDevHelp() {
  console.log(`agent-trace dev

Starts:
  collector   http://localhost:4319
  dashboard   http://localhost:3000

Environment:
  AGENT_TRACE_DB_PATH       SQLite database path
  AGENT_TRACE_SERVER_PORT   Collector port, default 4319
  AGENT_TRACE_WEB_PORT      Dashboard port, default 3000
  AGENT_TRACE_USAGE_CLIENTS Usage scanner clients
  AGENT_TRACE_USAGE_HOME    Local home directory for tokscale
  TOOLTRACE_*               Legacy environment variable names are still accepted

Options:
  --usage-scan <boolean>       Local tokscale scanner, default enabled; false disables it
  --usage-sync                 Run supported tokscale sync commands before scanner cycles
  --usage-clients <clients>    Clients to scan, default all tokscale clients
  --usage-home <path>          Local home directory passed to tokscale
  --usage-interval-ms <ms>     Scanner interval, default 15000
`);
}

function printUsageHelp() {
  console.log(`agent-trace usage [options]
agent-trace usage clients --home <path> [--json]
agent-trace usage sync --clients <clients> --home <path>

Scans local AI coding agent usage with tokscale and posts token/cost summaries to
the local collector. Raw prompts, responses, and files are not sent.

Options:
  --once                    Run one scan, default behavior
  --watch                   Keep scanning on an interval
  --sync                    Run supported tokscale sync commands before scanning
  --json                    Print JSON for clients/sync subcommands
  --interval-ms <ms>        Watch interval, default 15000
  --clients <clients>       Client list, default all tokscale clients
  --home <path>             Local home directory passed to tokscale
  --collector-url <url>     Collector base URL, default http://localhost:4319
  --timeout-ms <ms>         tokscale command timeout, default 60000

Environment:
  AGENT_TRACE_TOKSCALE_BIN    tokscale executable override
  AGENT_TRACE_USAGE_CLIENTS   Default client list
  AGENT_TRACE_USAGE_HOME      Local home directory for tokscale
`);
}
