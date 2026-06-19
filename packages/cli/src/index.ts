#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";

import {
  installHooks,
  uninstallHooks,
  type CodexSurface,
  type HookScope,
  type HookTarget,
  type RedactionLevel
} from "./hooks.js";

const command = process.argv[2];

if (!command || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "dev") {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printDevHelp();
    process.exit(0);
  }

  await runDev();
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

  console.log(`Installed ToolTrace tracing hooks for ${result.target} (${scope} scope).`);
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
    console.log(`No ToolTrace tracing hooks found for ${target}.`);
    console.log(`Config: ${result.path}`);
    return;
  }

  console.log(`Removed ${result.removed} ToolTrace tracing hook entries for ${target}.`);
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

async function runDev() {
  const serverPort = process.env.TOOLTRACE_SERVER_PORT ?? "4319";
  const webPort = process.env.TOOLTRACE_WEB_PORT ?? "3000";
  const serverUrl = `http://localhost:${serverPort}`;
  const children: ChildProcess[] = [];

  console.log("Starting ToolTrace local dashboard...");
  console.log(`Collector: ${serverUrl}`);
  console.log(`Dashboard: http://localhost:${webPort}`);

  await runPnpm(["--filter", "@tooltrace/server", "db:init"], {
    TOOLTRACE_DB_PATH: process.env.TOOLTRACE_DB_PATH
  });

  children.push(
    spawnPnpm(["--filter", "@tooltrace/server", "dev"], {
      PORT: serverPort,
      TOOLTRACE_DB_PATH: process.env.TOOLTRACE_DB_PATH
    })
  );

  children.push(
    spawnPnpm(["--filter", "@tooltrace/web", "dev"], {
      PORT: webPort,
      TOOLTRACE_API_URL: serverUrl
    })
  );

  const stop = () => {
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
              reject(new Error(`ToolTrace child process exited with code ${code}`));
            }
          });
        })
    )
  );
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
    cwd: process.cwd(),
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

function printHelp() {
  console.log(`ToolTrace CLI

Usage:
  tooltrace dev
  tooltrace install <target> [options]
  tooltrace uninstall <target>

Commands:
  dev        Start the local collector and dashboard
  install    Install global agent tracing hooks
  uninstall  Remove ToolTrace-managed tracing hooks

Targets:
  codex      Codex (~/.codex/hooks.json)
  claude-code  Claude Code (~/.claude/settings.json)
`);
}

function printInstallHelp() {
  console.log(`tooltrace install <target> [options]

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
  TOOLTRACE_COLLECTOR_URL   Default collector base URL

A timestamped .tooltrace-backup file is created before the config is changed.
Re-running install is safe; it replaces only the ToolTrace-managed entries.
For Codex, install also configures JSON OTel logs for token usage; restart Codex
after install so the new telemetry setting is loaded. Codex Desktop and CLI share
the same Codex config, so the last codex install surface is the one that will be
reported until you reinstall with another --surface value.
`);
}

function printUninstallHelp() {
  console.log(`tooltrace uninstall <target>

Targets:
  codex                  Codex (~/.codex/hooks.json)
  claude-code            Claude Code (~/.claude/settings.json)

Removes only the ToolTrace-managed hook entries. User-defined hooks and other
config keys are left untouched. A timestamped .tooltrace-backup file is created
before the config is changed.
`);
}

function printDevHelp() {
  console.log(`tooltrace dev

Starts:
  collector   http://localhost:4319
  dashboard   http://localhost:3000

Environment:
  TOOLTRACE_DB_PATH       SQLite database path
  TOOLTRACE_SERVER_PORT   Collector port, default 4319
  TOOLTRACE_WEB_PORT      Dashboard port, default 3000
`);
}
