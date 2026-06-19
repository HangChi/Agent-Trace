import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installHooks } from "./hooks.js";

const previousCodexHome = process.env.CODEX_HOME;
const codexHome = mkdtempSync(join(tmpdir(), "tooltrace-cli-smoke-"));

try {
  process.env.CODEX_HOME = codexHome;

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

  if (!commandWindows.includes("curl.exe") || !commandWindows.includes("-o NUL")) {
    throw new Error("Expected Windows Codex hook command to use curl.exe and NUL output.");
  }

  if (!command.includes("surface=cli") || !command.includes("surface_source=tooltrace-cli")) {
    throw new Error("Expected default Codex hook command to include CLI surface hints.");
  }

  if (process.platform === "win32" && (!command.includes("curl.exe") || !command.includes("-o NUL"))) {
    throw new Error("Expected primary Codex hook command to be Windows-safe on Windows.");
  }

  if (!config.includes("surface=cli") || !config.includes("surface_source=tooltrace-cli")) {
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
    !desktopCommand.includes("surface_source=tooltrace-desktop")
  ) {
    throw new Error("Expected Codex desktop hook command to include desktop surface hints.");
  }

  if (
    !desktopConfig.includes("surface=desktop") ||
    !desktopConfig.includes("surface_source=tooltrace-desktop")
  ) {
    throw new Error("Expected Codex OTel endpoint to include desktop surface hints.");
  }

  console.log("ToolTrace CLI smoke test passed.");
} finally {
  if (previousCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = previousCodexHome;
  }

  rmSync(codexHome, { recursive: true, force: true });
}
