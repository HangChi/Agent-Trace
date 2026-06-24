import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
const supportedTargets = new Set(["dir", "nsis"]);

if (!supportedTargets.has(target)) {
  throw new Error("Usage: node scripts/package-win.mjs <dir|nsis>");
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");

await runPnpm(["run", "prepare:icon"], desktopRoot);
await runPnpm(["run", "prepare:resources"], desktopRoot);
await runCommand(
  process.execPath,
  [getElectronBuilderCli(), "--win", target, "--publish", "never"],
  desktopRoot,
  {
    ELECTRON_BUILDER_DISABLE_DEPS_STATUS_CHECK: "true"
  }
);

function runPnpm(args, cwd) {
  const pnpm = resolvePnpmCommand();

  return runCommand(pnpm.command, [...pnpm.args, ...args], cwd);
}

function runCommand(command, args, cwd, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      shell: process.platform === "win32" && command.endsWith(".cmd"),
      stdio: "inherit"
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });

    child.once("error", reject);
  });
}

function getElectronBuilderCli() {
  const command = resolve(desktopRoot, "node_modules/electron-builder/out/cli/cli.js");

  if (!existsSync(command)) {
    throw new Error(`electron-builder was not found at ${command}. Run pnpm install first.`);
  }

  return command;
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
