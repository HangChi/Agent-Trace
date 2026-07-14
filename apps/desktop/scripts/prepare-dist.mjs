import { spawn } from "node:child_process";
import { existsSync, readdirSync, realpathSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as tar from "tar";

const require = createRequire(import.meta.url);
const electronVersion = require("electron/package.json").version;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const resourcesArchivesDir = resolve(desktopRoot, "resources/archives");
const resourcesServerRootDir = resolve(desktopRoot, "resources/server");
const resourcesWebRootDir = resolve(desktopRoot, "resources/web");
const stagingDir = resolve(desktopRoot, "resources/staging");
const stagingCliRootDir = resolve(stagingDir, "cli");
const stagingCliAppDir = resolve(stagingCliRootDir, "app");
const stagingServerRootDir = resolve(stagingDir, "server");
const stagingServerAppDir = resolve(stagingServerRootDir, "app");
const stagingWebRootDir = resolve(stagingDir, "web");
const stagingWebAppDir = resolve(stagingWebRootDir, "app");
const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild) {
  await runPnpm(["--filter", "@agent-trace/schema", "build"], workspaceRoot);
  await runPnpm(["--filter", "@agent-trace/cli", "build"], workspaceRoot);
  await runPnpm(["--filter", "@agent-trace/server", "build"], workspaceRoot);
  await runPnpm(["--filter", "@agent-trace/web", "build"], workspaceRoot);
}

const standaloneDir = resolve(workspaceRoot, "apps/web/.next/standalone");
const staticDir = resolve(workspaceRoot, "apps/web/.next/static");
const publicDir = resolve(workspaceRoot, "apps/web/public");

if (!existsSync(standaloneDir)) {
  throw new Error("Next standalone output was not found. Run pnpm --filter @agent-trace/web build first.");
}

if (!existsSync(staticDir)) {
  throw new Error("Next static output was not found. Run pnpm --filter @agent-trace/web build first.");
}

rmSync(resourcesArchivesDir, { recursive: true, force: true });
rmSync(resourcesServerRootDir, { recursive: true, force: true });
rmSync(resourcesWebRootDir, { recursive: true, force: true });
rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(resourcesArchivesDir, { recursive: true });
mkdirSync(stagingWebAppDir, { recursive: true });

await runPnpm(
  ["--filter", "@agent-trace/cli", "deploy", "--prod", "--legacy", stagingCliAppDir],
  workspaceRoot
);
copyPnpmHoistedDependencies(resolve(stagingCliAppDir, "node_modules"), {
  skipEntries: new Set(["@agent-trace"]),
  skipExisting: true
});

await runPnpm(
  ["--filter", "@agent-trace/server", "deploy", "--prod", "--legacy", stagingServerAppDir],
  workspaceRoot
);
copyPnpmHoistedDependencies(resolve(stagingServerAppDir, "node_modules"), {
  skipEntries: new Set(["@agent-trace"]),
  skipExisting: true
});
// The desktop app runs the server with Electron's bundled Node (ELECTRON_RUN_AS_NODE),
// so native modules must match Electron's ABI rather than the system Node ABI. Download
// the matching prebuilt better-sqlite3 binary (no local C++ toolchain required).
await rebuildBetterSqlite3ForElectron(stagingServerAppDir);

cpSync(standaloneDir, stagingWebAppDir, { recursive: true, dereference: true });
cpSync(staticDir, resolve(stagingWebAppDir, "apps/web/.next/static"), { recursive: true });
copyPnpmHoistedDependencies(resolve(stagingWebAppDir, "node_modules"));
removeDuplicateNestedWebNextCopy();

if (existsSync(publicDir)) {
  cpSync(publicDir, resolve(stagingWebAppDir, "apps/web/public"), { recursive: true });
}

createRuntimeArchive(stagingServerRootDir, resolve(resourcesArchivesDir, "server.tgz"));
createRuntimeArchive(stagingWebRootDir, resolve(resourcesArchivesDir, "web.tgz"));
createRuntimeArchive(stagingCliRootDir, resolve(resourcesArchivesDir, "cli.tgz"));
rmSync(stagingDir, { recursive: true, force: true });

function copyPnpmHoistedDependencies(nodeModulesDir, options = {}) {
  const skipEntries = options.skipEntries ?? new Set();
  const skipExisting = options.skipExisting ?? false;
  const hoistedDir = resolve(nodeModulesDir, ".pnpm/node_modules");

  if (!existsSync(hoistedDir)) {
    return;
  }

  for (const entry of readdirSync(hoistedDir)) {
    const targetPath = resolve(nodeModulesDir, entry);

    if (skipEntries.has(entry)) {
      continue;
    }

    if (skipExisting && existsSync(targetPath)) {
      continue;
    }

    cpSync(resolve(hoistedDir, entry), targetPath, {
      recursive: true,
      dereference: true,
      force: true
    });
  }
}

function removeDuplicateNestedWebNextCopy() {
  const nestedNextDir = resolve(stagingWebAppDir, "apps/web/node_modules/next");
  const rootNextDir = resolve(stagingWebAppDir, "node_modules/next");

  if (existsSync(nestedNextDir) && existsSync(rootNextDir)) {
    rmSync(nestedNextDir, { recursive: true, force: true });
  }
}

function createRuntimeArchive(cwd, file) {
  tar.c(
    {
      cwd,
      file,
      filter: shouldIncludeRuntimeArchiveEntry,
      follow: true,
      gzip: true,
      noMtime: true,
      portable: true,
      sync: true
    },
    ["app"]
  );
}

function shouldIncludeRuntimeArchiveEntry(entryPath) {
  const normalizedPath = entryPath.replaceAll("\\", "/");

  if (
    normalizedPath.includes("/node_modules/.pnpm/") ||
    normalizedPath.endsWith("/node_modules/.pnpm")
  ) {
    return false;
  }

  if (shouldExcludeRuntimeDependencyEntry(normalizedPath)) {
    return false;
  }

  return !normalizedPath.endsWith(".map") && !normalizedPath.endsWith(".d.ts");
}

function shouldExcludeRuntimeDependencyEntry(normalizedPath) {
  const jsTiktokenPrefix = "/node_modules/js-tiktoken/";

  if (!normalizedPath.includes(jsTiktokenPrefix)) {
    return false;
  }

  const packagePath = normalizedPath.slice(
    normalizedPath.indexOf(jsTiktokenPrefix) + jsTiktokenPrefix.length
  );
  const unusedRankPrefixes = [
    "dist/ranks/gpt2.",
    "dist/ranks/p50k_base.",
    "dist/ranks/p50k_edit.",
    "dist/ranks/r50k_base."
  ];

  return (
    packagePath === "dist/index.cjs" ||
    packagePath === "dist/index.js" ||
    unusedRankPrefixes.some((prefix) => packagePath.startsWith(prefix))
  );
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

function rebuildBetterSqlite3ForElectron(stagedAppDir) {
  const moduleDir = realpathSync(resolve(stagedAppDir, "node_modules/better-sqlite3"));
  const relativeModuleDir = relative(realpathSync(stagedAppDir), moduleDir);

  if (relativeModuleDir.startsWith("..") || isAbsolute(relativeModuleDir)) {
    throw new Error(`Refusing to rebuild better-sqlite3 outside the staged app: ${moduleDir}.`);
  }

  // pnpm deploy may hard-link package files to the workspace store. Remove the
  // staged native build first so the Electron prebuild gets a new inode instead
  // of overwriting the Node.js ABI binary used by source-mode development.
  rmSync(resolve(moduleDir, "build"), { recursive: true, force: true });
  const prebuildInstallBin = resolve(moduleDir, "../prebuild-install/bin.js");

  if (!existsSync(prebuildInstallBin)) {
    throw new Error(`prebuild-install was not found next to better-sqlite3 at ${prebuildInstallBin}.`);
  }

  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [prebuildInstallBin, "--runtime", "electron", "--target", electronVersion, "--arch", "x64"],
      { cwd: moduleDir, env: process.env, stdio: "inherit" }
    );

    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`prebuild-install for better-sqlite3 (electron ${electronVersion}) exited with code ${code}`));
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
