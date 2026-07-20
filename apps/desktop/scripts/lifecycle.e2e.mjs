import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import electron from "electron";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const e2eDir = await mkdtemp(join(tmpdir(), "agent-trace-desktop-e2e-"));
const resultPath = join(e2eDir, "lifecycle-result.json");
const child = spawn(electron, [desktopRoot, "--disable-gpu"], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    AGENT_TRACE_DESKTOP_E2E_DIR: e2eDir,
    AGENT_TRACE_USAGE_SCAN: "0",
    AGENT_TRACE_DB_PATH: join(e2eDir, "agent-trace.db")
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

try {
  await waitFor(() => existsSync(resultPath), child, 90_000);
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(result.error, undefined, output || result.error);
  assert.match(result.collectorUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(result.dashboardUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  const exitCode = await waitForExit(child, 20_000);
  assert.equal(exitCode, 0, output);
} finally {
  if (child.exitCode === null) child.kill();
  await rm(e2eDir, { recursive: true, force: true });
}

console.log("Agent-Trace desktop lifecycle E2E passed.");

async function waitFor(predicate, process, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (process.exitCode !== null) throw new Error(`Desktop exited with ${process.exitCode}.\n${output}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out after ${timeoutMs} ms.\n${output}`);
}

function waitForExit(process, timeoutMs) {
  if (process.exitCode !== null) return Promise.resolve(process.exitCode);
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`Desktop did not exit.\n${output}`)), timeoutMs);
    process.once("exit", (code) => {
      clearTimeout(timer);
      resolvePromise(code);
    });
  });
}
