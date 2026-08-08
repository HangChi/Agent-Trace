import assert from "node:assert/strict";

import { classifyAction, privacySettingsSchema } from "../dist/index.js";

assert.deepEqual(classifyAction({ toolName: "mcp__ardot__batch_edit" }), {
  category: "mcp",
  toolKind: "mcp",
  toolName: "mcp__ardot__batch_edit",
  mcpServer: "ardot",
  mcpTool: "batch_edit"
});
assert.deepEqual(classifyAction({ toolName: "Bash", argumentKeys: ["command"] }), {
  category: "command",
  toolKind: "command",
  toolName: "Bash"
});
assert.deepEqual(classifyAction({ toolName: "Read" }), {
  category: "tool",
  toolKind: "tool",
  toolName: "Read"
});
assert.deepEqual(classifyAction({ toolName: "SlashCommand", skillName: "openai-docs" }), {
  category: "skill",
  toolKind: "tool",
  toolName: "SlashCommand",
  skillName: "openai-docs"
});
assert.equal(
  privacySettingsSchema.parse({ sensitiveKeys: [], replacement: "[REDACTED]" }).commandCapture,
  "metadata"
);

console.log("Agent-Trace action classification smoke test passed.");
