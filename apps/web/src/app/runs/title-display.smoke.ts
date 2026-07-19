import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /className="block truncate text-\[15px\]/,
  "Web Run titles should use a single-line ellipsis treatment."
);

console.log("Agent-Trace Run title display smoke test passed.");
