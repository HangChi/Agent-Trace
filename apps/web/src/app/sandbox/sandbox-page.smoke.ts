import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const runDetail = readFileSync(new URL("../runs/[id]/page.tsx", import.meta.url), "utf8");

for (const marker of [
  "network: \"disabled\"",
  "toolExecution: \"mock-only\"",
  "filesystem: \"temporary\"",
  "environment: \"sanitized\"",
  "createReplayAction",
  "cancelReplayAction",
  "/runs/compare?ids="
]) {
  if (!page.includes(marker) && !actions.includes(marker)) {
    throw new Error(`Replay sandbox UI is missing: ${marker}`);
  }
}

if (!runDetail.includes("/sandbox?runId=")) {
  throw new Error("Run detail is missing the replay sandbox entry point.");
}

console.log("Agent-Trace replay sandbox page smoke test passed.");
