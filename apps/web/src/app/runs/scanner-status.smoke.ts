import { readFileSync } from "node:fs";

import { fetchScannerStatus } from "./scanner-status.js";

let requestedUrl = "";
const result = await fetchScannerStatus("http://localhost:4319", async (input) => {
  requestedUrl = String(input);
  return new Response(
    JSON.stringify({
      scannedAt: "2026-07-12T12:00:00.000Z",
      diagnostics: [
        { client: "codex", status: "available", pathExists: true, messageCount: 10 },
        { client: "kiro", status: "missing", pathExists: false }
      ]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});

if (requestedUrl !== "http://localhost:4319/usage/scanner") {
  throw new Error("Expected scanner status to use the dedicated endpoint.");
}

if (
  result.diagnostics.length !== 2 ||
  result.diagnostics[0]?.client !== "kiro" ||
  result.diagnostics[1]?.client !== "codex"
) {
  throw new Error("Expected scanner diagnostics to be normalized and sorted by status.");
}

const runsPageSource = readFileSync(
  new URL("../../../../../packages/dashboard-ui/src/dashboard-app.tsx", import.meta.url),
  "utf8",
);

if (
  !runsPageSource.includes('if (all) query.set("includeUntracked", "true")') ||
  !runsPageSource.includes('tr(locale, "显示全部记录", "Show all")') ||
  !runsPageSource.includes('tr(locale, "隐藏空记录", "Hide empty")') ||
  !runsPageSource.includes("<RunTable") ||
  !runsPageSource.includes("<Pagination")
) {
  throw new Error("Expected the run list to expose visibility and unobscured pagination controls.");
}

console.log("Agent-Trace scanner status smoke test passed.");
