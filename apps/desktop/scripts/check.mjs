import { spawnSync } from "node:child_process";
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
