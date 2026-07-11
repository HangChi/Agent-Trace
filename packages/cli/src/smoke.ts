import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { findUncoveredCodexHistories } from "./codex-history.js";
import { installHooks } from "./hooks.js";
import {
  collectUsageClientDiagnostics,
  collectUsageOnce,
  isUsageScannerEnabled,
  resolveTokscaleCommand,
  syncUsageClients
} from "./usage.js";

const previousCodexHome = process.env.CODEX_HOME;
const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
const codexHome = mkdtempSync(join(tmpdir(), "agent-trace-cli-smoke-"));
const claudeConfigDir = mkdtempSync(join(tmpdir(), "agent-trace-cli-smoke-claude-"));

try {
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

  if (
    !isUsageScannerEnabled(undefined) ||
    !isUsageScannerEnabled("true") ||
    isUsageScannerEnabled("0") ||
    isUsageScannerEnabled("false") ||
    isUsageScannerEnabled("off")
  ) {
    throw new Error("Expected local usage scanning to default on with explicit disable values.");
  }

  const tokscaleInvocation = resolveTokscaleCommand();

  if (
    tokscaleInvocation.executable !== process.execPath ||
    !tokscaleInvocation.args.some((arg) => arg.endsWith("tokscale\\bin.js") || arg.endsWith("tokscale/bin.js"))
  ) {
    throw new Error("Expected bundled tokscale to run through the current Node runtime instead of a Windows CMD shim.");
  }

  installHooks("codex", {
    collectorUrl: "http://localhost:4319",
    redaction: "metadata"
  });

  const hooks = JSON.parse(readFileSync(join(codexHome, "hooks.json"), "utf8")) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: string; commandWindows?: string }> }>>;
  };
  const command = hooks.hooks?.SessionStart?.[0]?.hooks?.[0]?.command;
  const commandWindows = hooks.hooks?.SessionStart?.[0]?.hooks?.[0]?.commandWindows;
  const config = readFileSync(join(codexHome, "config.toml"), "utf8");

  if (!command?.includes('--data-binary "@-"')) {
    throw new Error("Expected primary Codex hook command to quote curl stdin marker.");
  }

  if (!commandWindows?.includes('--data-binary "@-"')) {
    throw new Error("Expected Windows Codex hook command to quote curl stdin marker.");
  }

  if (!command.includes("||") || !commandWindows.includes("|| exit /b 0")) {
    throw new Error("Expected Codex hook command to ignore collector delivery failures.");
  }

  if (!commandWindows.includes("curl.exe") || !commandWindows.includes("-o NUL")) {
    throw new Error("Expected Windows Codex hook command to use curl.exe and NUL output.");
  }

  if (!command.includes("surface=cli") || !command.includes("surface_source=agent-trace-cli")) {
    throw new Error("Expected default Codex hook command to include CLI surface hints.");
  }

  if (process.platform === "win32" && (!command.includes("curl.exe") || !command.includes("-o NUL"))) {
    throw new Error("Expected primary Codex hook command to be Windows-safe on Windows.");
  }

  if (!config.includes("surface=cli") || !config.includes("surface_source=agent-trace-cli")) {
    throw new Error("Expected Codex OTel endpoint to include CLI surface hints.");
  }

  installHooks("codex", {
    collectorUrl: "http://localhost:4319",
    redaction: "metadata",
    surface: "desktop"
  });

  const desktopHooks = JSON.parse(readFileSync(join(codexHome, "hooks.json"), "utf8")) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: string; commandWindows?: string }> }>>;
  };
  const desktopCommand = desktopHooks.hooks?.SessionStart?.[0]?.hooks?.[0]?.command;
  const desktopConfig = readFileSync(join(codexHome, "config.toml"), "utf8");

  if (
    !desktopCommand?.includes("surface=desktop") ||
    !desktopCommand.includes("surface_source=agent-trace-desktop")
  ) {
    throw new Error("Expected Codex desktop hook command to include desktop surface hints.");
  }

  if (
    !desktopConfig.includes("surface=desktop") ||
    !desktopConfig.includes("surface_source=agent-trace-desktop")
  ) {
    throw new Error("Expected Codex OTel endpoint to include desktop surface hints.");
  }

  installHooks("claude-code", {
    collectorUrl: "http://localhost:4319",
    redaction: "metadata"
  });

  const claudeSettings = JSON.parse(readFileSync(join(claudeConfigDir, "settings.json"), "utf8")) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ type?: string; command?: string; url?: string }> }>>;
  };
  const claudeHandler = claudeSettings.hooks?.UserPromptSubmit?.[0]?.hooks?.[0];
  const claudeCommand = claudeHandler?.command;

  if (claudeHandler?.type !== "command" || claudeHandler.url !== undefined) {
    throw new Error("Expected Claude Code hook to use a non-blocking command handler.");
  }

  if (!claudeCommand?.includes("/integrations/claude-code/hook")) {
    throw new Error("Expected Claude Code hook command to post to the Claude Code integration.");
  }

  if (!claudeCommand.includes("||")) {
    throw new Error("Expected Claude Code hook command to ignore collector delivery failures.");
  }

  if (process.platform === "win32" && (!claudeCommand.includes("curl.exe") || !claudeCommand.includes("-o NUL"))) {
    throw new Error("Expected Claude Code hook command to be Windows-safe on Windows.");
  }

  const postedUsageScans: Array<{ path: string; body: Record<string, unknown> }> = [];
  const usageHome = join(codexHome, "usage-home");
  let observedUsageHome: string | undefined;
  let observedDefaultClients: string | undefined;

  await collectUsageOnce({
    collectorUrl: "http://localhost:4319",
    clients: "codex,claude",
    home: usageHome,
    runTokscale: async (_clients, _timeoutMs, home) => {
      observedUsageHome = home;
      return {
        rows: [
          {
            client: "codex",
            sessionId: "codex_usage_smoke",
            model: "gpt-5.4",
            provider: "openai",
            input: 100,
            output: 20,
            cacheRead: 10,
            cacheWrite: 5,
            reasoning: 7,
            costUsd: 0.0025,
            messageCount: 2,
            prompt: "must not be forwarded"
          },
          {
            client: "claude",
            session_id: "claude_usage_smoke",
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            input_tokens: 300,
            output_tokens: 40,
            cache_read_tokens: 50,
            cache_write_tokens: 10,
            reasoning_tokens: 3,
            total_tokens: 400,
            cost_usd: 0.01
          }
        ]
      };
    },
    postJson: async (path, body) => {
      postedUsageScans.push({ path, body: body as Record<string, unknown> });
    }
  });

  const usageScan = postedUsageScans[0];
  const usageRows = usageScan?.body.rows;
  const serializedUsageScan = JSON.stringify(usageScan);

  if (usageScan?.path !== "/integrations/usage-scan") {
    throw new Error("Expected usage scanner to post to the usage-scan integration.");
  }

  if (observedUsageHome !== usageHome) {
    throw new Error("Expected usage scanner to pass the configured home directory to tokscale.");
  }

  if (!Array.isArray(usageRows) || usageRows.length !== 2) {
    throw new Error("Expected usage scanner to post normalized usage rows.");
  }

  if (
    usageRows[0]?.totalTokens !== 135 ||
    usageRows[0]?.cacheReadTokens !== 10 ||
    usageRows[0]?.cacheWriteTokens !== 5 ||
    usageRows[0]?.reasoningTokens !== 7 ||
    usageRows[0]?.costUsd !== 0.0025
  ) {
    throw new Error("Expected scanner totals to exclude reasoning already contained in output.");
  }

  if (serializedUsageScan.includes("must not be forwarded")) {
    throw new Error("Expected usage scanner to omit raw prompt-like fields.");
  }

  await collectUsageOnce({
    collectorUrl: "http://localhost:4319",
    home: join(codexHome, "empty-usage-home"),
    runTokscale: async (clients) => {
      observedDefaultClients = clients;
      return { entries: [] };
    },
    postJson: async () => {}
  });

  if (observedDefaultClients !== undefined) {
    throw new Error("Expected the default usage scan to include every tokscale client without a filter.");
  }

  const activeDuplicate = join(
    usageHome,
    ".codex",
    "sessions",
    "2026",
    "07",
    "10",
    "rollout-2026-07-10T10-00-00-active-duplicate.jsonl"
  );
  const archivedDuplicate = join(
    usageHome,
    ".codex",
    "archived_sessions",
    "rollout-2026-07-10T10-01-00-archived-duplicate.jsonl"
  );
  const uniqueArchive = join(
    usageHome,
    ".codex",
    "archived_sessions",
    "rollout-2026-07-10T11-00-00-unique-archive.jsonl"
  );

  writeCodexUsageFixture(activeDuplicate, "active-duplicate", "2026-07-10T02:00:00.000Z", 135);
  writeCodexUsageFixture(archivedDuplicate, "archived-duplicate", "2026-07-10T02:00:00.000Z", 135);
  writeCodexUsageFixture(uniqueArchive, "unique-archive", "2026-07-10T03:00:00.000Z", 246);

  const reconciliation = await findUncoveredCodexHistories(usageHome, [
    "rollout-2026-07-10T10-00-00-active-duplicate"
  ]);

  if (reconciliation.files.length !== 1 || reconciliation.files[0] !== uniqueArchive) {
    throw new Error("Expected Codex history reconciliation to deduplicate active/archive copies and keep unique archives.");
  }

  const supplementHome = join(codexHome, "supplement-home");
  const supplementArchive = join(
    supplementHome,
    ".codex",
    "archived_sessions",
    "rollout-2026-07-10T12-00-00-supplement-only.jsonl"
  );
  const supplementPosts: Array<Record<string, unknown>> = [];
  const supplementScanHomes: Array<string | undefined> = [];
  writeCodexUsageFixture(supplementArchive, "supplement-only", "2026-07-10T04:00:00.000Z", 357);

  await collectUsageOnce({
    clients: "codex",
    home: supplementHome,
    runTokscale: async (_clients, _timeoutMs, scanHome) => {
      supplementScanHomes.push(scanHome);

      return scanHome === supplementHome
        ? { entries: [] }
        : {
            entries: [
              {
                client: "codex",
                sessionId: "rollout-2026-07-10T12-00-00-supplement-only",
                model: "gpt-5.5",
                provider: "openai",
                input: 300,
                output: 35,
                cacheRead: 22,
                reasoning: 7,
                cost: 0.001
              }
            ]
          };
    },
    postJson: async (_path, body) => {
      supplementPosts.push(body as Record<string, unknown>);
    }
  });

  const supplementedRows = supplementPosts[0]?.rows;

  if (
    supplementScanHomes.length !== 2 ||
    supplementScanHomes[0] !== supplementHome ||
    supplementScanHomes[1] === supplementHome ||
    !Array.isArray(supplementedRows) ||
    supplementedRows.length !== 1 ||
    supplementedRows[0]?.totalTokens !== 357
  ) {
    throw new Error("Expected unique archived Codex history to be rescanned through an isolated tokscale home.");
  }

  const diagnostics = await collectUsageClientDiagnostics({
    home: usageHome,
    runTokscaleClients: async () => ({
      clients: [
        {
          client: "codex",
          sessionsPath: join(usageHome, ".codex", "sessions"),
          sessionsPathExists: true,
          messageCount: 4
        },
        {
          client: "cursor",
          sessionsPath: join(usageHome, ".config", "tokscale", "cursor-cache"),
          sessionsPathExists: false,
          messageCount: 0
        }
      ]
    })
  });
  const cursorDiagnostic = diagnostics.find((diagnostic) => diagnostic.client === "cursor");

  if (
    cursorDiagnostic?.status !== "needs_sync" ||
    cursorDiagnostic.pathExists !== false ||
    !cursorDiagnostic.actionHint?.includes("tokscale cursor login") ||
    !cursorDiagnostic.actionHint.includes("tokscale cursor sync")
  ) {
    throw new Error("Expected usage client diagnostics to explain missing Cursor sync cache.");
  }

  const syncCalls: string[][] = [];
  const syncResults = await syncUsageClients({
    clients: "cursor,antigravity,trae",
    home: usageHome,
    runTokscaleCommand: async (args) => {
      syncCalls.push(args);
      return args[0] === "antigravity" ? { code: 0, stdout: "synced" } : { code: 1, stderr: "not logged in" };
    }
  });

  if (
    !syncCalls.some((call) => call[0] === "cursor" && call[1] === "status") ||
    !syncCalls.some((call) => call[0] === "antigravity" && call[1] === "sync") ||
    !syncCalls.some((call) => call[0] === "trae" && call[1] === "status") ||
    syncCalls.some((call) => call.includes("login"))
  ) {
    throw new Error("Expected usage sync to call status/sync commands without invoking login.");
  }

  if (!syncResults.some((result) => result.client === "cursor" && result.status === "needs_login")) {
    throw new Error("Expected Cursor sync to report a login hint when status fails.");
  }

  console.log("Agent-Trace CLI smoke test passed.");
} finally {
  if (previousCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = previousCodexHome;
  }

  if (previousClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  }

  rmSync(codexHome, { recursive: true, force: true });
  rmSync(claudeConfigDir, { recursive: true, force: true });
}

function writeCodexUsageFixture(
  path: string,
  sessionId: string,
  timestamp: string,
  totalTokens: number
) {
  mkdirSync(dirname(path), { recursive: true });
  const inputTokens = totalTokens - 35;
  const events = [
    {
      timestamp,
      type: "session_meta",
      payload: { id: sessionId }
    },
    {
      timestamp,
      type: "turn_context",
      payload: { model: "gpt-5.5" }
    },
    {
      timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: inputTokens,
            cached_input_tokens: 10,
            output_tokens: 35,
            reasoning_output_tokens: 7,
            total_tokens: totalTokens
          },
          last_token_usage: {
            input_tokens: inputTokens,
            cached_input_tokens: 10,
            output_tokens: 35,
            reasoning_output_tokens: 7,
            total_tokens: totalTokens
          }
        }
      }
    }
  ];

  writeFileSync(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
}
