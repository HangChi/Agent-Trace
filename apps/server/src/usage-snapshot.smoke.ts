import { getStaleUsageScanEventIds } from "./usage-snapshot.js";

const events = [
  {
    id: "evt_scan_keep",
    metadataJson: JSON.stringify({ source: "usage-scan", usageClient: "codex" })
  },
  {
    id: "evt_scan_stale",
    metadataJson: JSON.stringify({ source: "usage-scan", usageClient: "codex" })
  },
  {
    id: "evt_scan_other_client",
    metadataJson: JSON.stringify({ source: "usage-scan", usageClient: "claude" })
  },
  {
    id: "evt_hook",
    metadataJson: JSON.stringify({ source: "agent-hook" })
  },
  {
    id: "evt_malformed",
    metadataJson: "{not-json"
  }
];

const stale = getStaleUsageScanEventIds(events, new Set(["evt_scan_keep"]), true);

if (
  stale.length !== 2 ||
  !stale.includes("evt_scan_stale") ||
  !stale.includes("evt_scan_other_client")
) {
  throw new Error("Expected complete snapshots to select only absent usage-scan events for deletion.");
}

const codexOnlyStale = getStaleUsageScanEventIds(
  events,
  new Set(["evt_scan_keep"]),
  true,
  new Set(["codex"])
);

if (codexOnlyStale.length !== 1 || codexOnlyStale[0] !== "evt_scan_stale") {
  throw new Error("Expected filtered snapshots to preserve scan events from clients outside the filter.");
}

if (getStaleUsageScanEventIds(events, new Set(), false).length !== 0) {
  throw new Error("Expected incomplete snapshots to preserve every prior scan event.");
}

console.log("Agent-Trace usage snapshot smoke test passed.");
