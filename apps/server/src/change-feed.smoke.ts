import assert from "node:assert/strict";

import { getCurrentRevision, publishChange, subscribeToChanges } from "./change-feed.js";

const received: Array<ReturnType<typeof publishChange>> = [];
const initialRevision = getCurrentRevision();
const unsubscribe = subscribeToChanges((event) => received.push(event));
const event = publishChange("run");
unsubscribe();
publishChange("event");

assert.equal(event.revision, initialRevision + 1);
assert.equal(received.length, 1);
assert.equal(received[0]?.kind, "run");
assert.match(received[0]?.at ?? "", /^\d{4}-\d{2}-\d{2}T/);

console.log("Agent-Trace change feed smoke test passed.");
