import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const resourcesNodeDir = resolve(desktopRoot, "resources/node");
const resourcesServerRootDir = resolve(desktopRoot, "resources/server");
const resourcesServerAppDir = resolve(resourcesServerRootDir, "app");
const resourcesWebRootDir = resolve(desktopRoot, "resources/web");
const resourcesWebAppDir = resolve(resourcesWebRootDir, "app");
const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild) {
  await runPnpm(["--filter", "@agent-trace/schema", "build"], workspaceRoot);
  await runPnpm(["--filter", "@agent-trace/server", "build"], workspaceRoot);
  await runPnpm(["--filter", "@agent-trace/web", "build"], workspaceRoot);
}

const standaloneDir = resolve(workspaceRoot, "apps/web/.next/standalone");
const staticDir = resolve(workspaceRoot, "apps/web/.next/static");
const publicDir = resolve(workspaceRoot, "apps/web/public");
const nodeExecutableName = process.platform === "win32" ? "node.exe" : "node";

if (!existsSync(standaloneDir)) {
  throw new Error("Next standalone output was not found. Run pnpm --filter @agent-trace/web build first.");
}

if (!existsSync(staticDir)) {
  throw new Error("Next static output was not found. Run pnpm --filter @agent-trace/web build first.");
}

rmSync(resourcesNodeDir, { recursive: true, force: true });
rmSync(resourcesServerRootDir, { recursive: true, force: true });
rmSync(resourcesWebRootDir, { recursive: true, force: true });
mkdirSync(resourcesNodeDir, { recursive: true });
mkdirSync(resourcesWebAppDir, { recursive: true });

copyFileSync(process.execPath, resolve(resourcesNodeDir, nodeExecutableName));
await runPnpm(
  ["--filter", "@agent-trace/server", "deploy", "--prod", "--legacy", resourcesServerAppDir],
  workspaceRoot
);

cpSync(standaloneDir, resourcesWebAppDir, { recursive: true });
cpSync(staticDir, resolve(resourcesWebAppDir, "apps/web/.next/static"), { recursive: true });
copyPnpmHoistedDependencies(resolve(resourcesWebAppDir, "node_modules"));

if (existsSync(publicDir)) {
  cpSync(publicDir, resolve(resourcesWebAppDir, "apps/web/public"), { recursive: true });
}

function copyPnpmHoistedDependencies(nodeModulesDir) {
  const hoistedDir = resolve(nodeModulesDir, ".pnpm/node_modules");

  if (!existsSync(hoistedDir)) {
    return;
  }

  for (const entry of readdirSync(hoistedDir)) {
    cpSync(resolve(hoistedDir, entry), resolve(nodeModulesDir, entry), {
      recursive: true,
      dereference: true,
      force: true
    });
  }
}

function runPnpm(args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const pnpm = resolvePnpmCommand();
    const child = spawn(pnpm.command, [...pnpm.args, ...args], {
      cwd,
      env: process.env,
      shell: process.platform === "win32" && pnpm.args.length === 0,
      stdio: "inherit"
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`pnpm ${args.join(" ")} exited with code ${code}`));
    });

    child.once("error", reject);
  });
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
