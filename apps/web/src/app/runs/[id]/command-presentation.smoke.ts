import type { DashboardTraceEvent } from "@agent-trace/schema";

import { getCommandPresentation } from "./command-presentation.js";

const baseEvent = {
  id: "event-command",
  runId: "run-command",
  name: "exec_command",
  type: "tool",
  status: "success",
  timestamp: "2026-08-08T00:00:00.000Z"
} as DashboardTraceEvent;

const stored = getCommandPresentation({
  ...baseEvent,
  input: { command: "echo visible" },
  metadata: { category: "command", toolName: "exec_command" }
});
if (stored.state !== "stored" || stored.command !== "echo visible") {
  throw new Error("Expected stored command text to be explicitly identified.");
}

const omitted = getCommandPresentation({
  ...baseEvent,
  metadata: { category: "command", toolName: "exec_command", commandContent: "omitted" }
});
if (omitted.state !== "omitted" || omitted.toolName !== "exec_command") {
  throw new Error("Expected privacy-omitted command text to be distinguishable from missing data.");
}

const metadataOnly = getCommandPresentation({
  ...baseEvent,
  metadata: { category: "command", toolName: "Bash" }
});
if (metadataOnly.state !== "metadata" || metadataOnly.toolName !== "Bash") {
  throw new Error("Expected legacy metadata-only command events to remain identifiable.");
}

console.log("Agent-Trace command presentation smoke test passed.");
