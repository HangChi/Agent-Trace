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

console.log("Agent-Trace scanner status smoke test passed.");
