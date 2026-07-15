import assert from "node:assert/strict";

import { traceEventTargetId, traceInsightLocationHref } from "./trace-navigation";

const eventId = "event:a/1";
const targetId = traceEventTargetId(eventId);

assert.match(targetId, /^trace-event-[a-z0-9-]+$/);
assert.notEqual(targetId, traceEventTargetId("event/a:1"));

const timelineHref = new URL(
  traceInsightLocationHref({ runId: "run/1", eventId, locale: "zh", view: "timeline" }),
  "http://agent-trace.local"
);

assert.equal(timelineHref.pathname, "/runs/run%2F1");
assert.equal(timelineHref.searchParams.get("q"), eventId);
assert.equal(timelineHref.searchParams.get("visibility"), "all");
assert.equal(timelineHref.searchParams.get("focus"), eventId);
assert.equal(timelineHref.searchParams.has("view"), false);
assert.equal(timelineHref.searchParams.has("lang"), false);
assert.equal(timelineHref.hash, `#${targetId}`);

const treeHref = new URL(
  traceInsightLocationHref({ runId: "run-1", eventId, locale: "en", view: "tree" }),
  "http://agent-trace.local"
);

assert.equal(treeHref.searchParams.get("view"), "tree");
assert.equal(treeHref.searchParams.get("lang"), "en");

console.log("Agent-Trace diagnostic navigation smoke test passed.");
