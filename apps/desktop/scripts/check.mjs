import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const files = [
  "main.cjs",
  "scripts/generate-icon.mjs",
  "scripts/prepare-dist.mjs",
  "scripts/package-win.mjs"
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", resolve(desktopRoot, file)], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const mainSource = readFileSync(resolve(desktopRoot, "main.cjs"), "utf8");
const prepareSource = readFileSync(resolve(desktopRoot, "scripts/prepare-dist.mjs"), "utf8");

for (const required of [
  "startUsageScannerService",
  "AGENT_TRACE_USAGE_SCAN",
  'app.getPath("home")',
  '"--watch"',
  '"--interval-ms"',
  '"15000"'
]) {
  if (!mainSource.includes(required)) {
    throw new Error(`Desktop usage scanner is missing required source marker: ${required}`);
  }
}

if (!prepareSource.includes('"cli.tgz"')) {
  throw new Error("Desktop resources must package the CLI usage scanner as cli.tgz.");
}

for (const required of [
  "getDevelopmentCliInvocation",
  'require.resolve("tsx/cli"',
  'path.join(cliRoot, "src", "index.ts")',
  "ELECTRON_RUN_AS_NODE"
]) {
  if (!mainSource.includes(required)) {
    throw new Error(`Desktop development scanner is missing direct launch marker: ${required}`);
  }
}

if (mainSource.includes('["--filter", "@agent-trace/cli", "exec", "tsx"')) {
  throw new Error("Desktop development scanner must not depend on a package-manager .bin shim.");
}
