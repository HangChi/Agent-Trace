import { strict as assert } from "node:assert";

import { localizedHref } from "./i18n.js";

assert.equal(localizedHref("/runs?page=3&lang=en&runs=all", "zh"), "/runs?page=3&runs=all");
assert.equal(localizedHref("/runs?page=3&runs=all", "en"), "/runs?page=3&runs=all&lang=en");
assert.equal(localizedHref("/runs?lang=en", "en"), "/runs?lang=en");
assert.equal(localizedHref("/runs/trace-id", "zh"), "/runs/trace-id");

console.log("Agent-Trace i18n smoke test passed.");
