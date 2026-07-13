import assert from "node:assert/strict";

import type { DashboardTraceEvent, DashboardTraceInsightKind } from "@agent-trace/schema";

import { analyzeTraceInsights } from "./trace-insights.js";

function event(
  id: string,
  overrides: Partial<DashboardTraceEvent> = {}
): DashboardTraceEvent {
  return {
    id,
    runId: "insight-run",
    type: "tool_call",
    name: id,
    status: "success",
    timestamp: `2026-07-14T00:00:${id.padStart(2, "0")}.000Z`,
    metadata: { category: "tool", toolName: id },
    ...overrides
  };
}

function kinds(events: DashboardTraceEvent[]): DashboardTraceInsightKind[] {
  return analyzeTraceInsights(events).map((insight) => insight.kind);
}

const repeated = [
  event("01", { name: "first", metadata: { category: "tool", toolName: "read_file" } }),
  event("02", { name: "second", metadata: { category: "tool", toolName: "read_file" } }),
  event("03", { name: "third", metadata: { category: "tool", toolName: "read_file" } })
];
assert.deepEqual(analyzeTraceInsights(repeated).filter((item) => item.kind === "repeated_action"), [
  {
    kind: "repeated_action",
    severity: "warning",
    eventIds: ["01", "02", "03"],
    title: "Repeated action",
    evidence: { actionName: "read_file", count: 3 }
  }
]);
assert.ok(!kinds(repeated.slice(0, 2)).includes("repeated_action"));
assert.ok(
  !kinds([
    event("01", { type: "step_started", metadata: { category: "lifecycle" }, name: "same" }),
    event("02", { type: "step_started", metadata: { category: "lifecycle" }, name: "same" }),
    event("03", { type: "step_started", metadata: { category: "lifecycle" }, name: "same" })
  ]).includes("repeated_action")
);

const retry = [
  event("01", { status: "error", metadata: { category: "command", command: "pnpm test" } }),
  event("02", { status: "error", metadata: { category: "command", command: "pnpm test" } }),
  event("03", { status: "success", metadata: { category: "command", command: "pnpm test" } })
];
assert.deepEqual(analyzeTraceInsights(retry).find((item) => item.kind === "retry_loop"), {
  kind: "retry_loop",
  severity: "warning",
  eventIds: ["01", "02", "03"],
  title: "Retry loop",
  evidence: { actionName: "pnpm test", attempts: 3, failedAttempts: 2 }
});
assert.ok(
  !kinds([
    event("01", { status: "error", metadata: { category: "skill", skillName: "verify" } }),
    event("02", { status: "success", metadata: { category: "skill", skillName: "verify" } })
  ]).includes("retry_loop")
);

assert.deepEqual(
  analyzeTraceInsights([
    event("live", {
      status: "error",
      timestamp: "2026-07-14T00:00:01.000Z",
      metadata: { category: "tool", toolName: "read_file", source: "hook" }
    }),
    event("transcript-1", {
      status: "error",
      timestamp: "2026-07-14T00:00:02.000Z",
      durationMs: 10_000,
      metadata: {
        category: "tool",
        toolName: "read_file",
        source: "transcript",
        tokenUsage: { input: 0, output: 2_000, total: 2_000 }
      }
    }),
    event("transcript-2", {
      status: "error",
      timestamp: "2026-07-14T00:00:03.000Z",
      metadata: { category: "tool", toolName: "read_file", source: "transcript" }
    }),
    event("transcript-3", {
      timestamp: "2026-07-14T00:00:04.000Z",
      metadata: { category: "tool", toolName: "read_file", source: "transcript" }
    })
  ]),
  []
);

assert.deepEqual(
  analyzeTraceInsights([event("01", { durationMs: 10_000 })]).find(
    (item) => item.kind === "slow_step"
  ),
  {
    kind: "slow_step",
    severity: "warning",
    eventIds: ["01"],
    title: "Slow step",
    evidence: { durationMs: 10_000, thresholdMs: 10_000 }
  }
);
assert.ok(!kinds([event("01", { durationMs: 9_999 })]).includes("slow_step"));

const tokenBoundary = [
  event("01", {
    metadata: {
      tokenUsage: { input: 500, output: 500, total: 1_000 }
    }
  }),
  event("02", {
    metadata: { tokenUsage: { input: 250, output: 250, total: 500 } }
  }),
  event("03", {
    metadata: { tokenUsage: { input: 250, output: 250, total: 500 } }
  })
];
assert.deepEqual(analyzeTraceInsights(tokenBoundary).filter((item) => item.kind === "token_hotspot"), [
  {
    kind: "token_hotspot",
    severity: "info",
    eventIds: ["01"],
    title: "Token hotspot",
    evidence: { eventTokens: 1_000, runTokens: 2_000, share: 0.5 }
  }
]);
assert.deepEqual(
  analyzeTraceInsights([
    event("session-scan", {
      timestamp: "2026-07-14T00:00:01.000Z",
      metadata: {
        tokenUsage: {
          input: 400,
          output: 600,
          total: 1_000,
          sourceKind: "scan",
          scope: "session"
        }
      }
    }),
    event("per-event", {
      timestamp: "2026-07-14T00:00:02.000Z",
      metadata: {
        tokenUsage: {
          input: 5_000,
          output: 5_000,
          total: 10_000,
          sourceKind: "official",
          scope: "event"
        }
      }
    })
  ]).filter((item) => item.kind === "token_hotspot"),
  [
    {
      kind: "token_hotspot",
      severity: "info",
      eventIds: ["session-scan"],
      title: "Token hotspot",
      evidence: { eventTokens: 1_000, runTokens: 1_000, share: 1 }
    }
  ]
);
assert.deepEqual(
  analyzeTraceInsights([
    event("live-per-event", {
      timestamp: "2026-07-14T00:00:01.000Z",
      metadata: {
        category: "tool",
        toolName: "live_tool",
        source: "hook",
        tokenUsage: {
          input: 5_000,
          output: 5_000,
          total: 10_000,
          sourceKind: "official",
          scope: "event"
        }
      }
    }),
    event("transcript-session-scan", {
      timestamp: "2026-07-14T00:00:02.000Z",
      metadata: {
        source: "transcript",
        tokenUsage: {
          input: 400,
          output: 600,
          total: 1_000,
          sourceKind: "scan",
          scope: "session"
        }
      }
    })
  ]).filter((item) => item.kind === "token_hotspot"),
  []
);
assert.ok(
  !kinds([
    event("01", { metadata: { tokenUsage: { input: 499, output: 500, total: 999 } } }),
    event("02", { metadata: { tokenUsage: { input: 0, output: 1, total: 1 } } })
  ]).includes("token_hotspot")
);
assert.ok(
  !kinds([
    event("01", { metadata: { tokenUsage: { input: 0, output: 1_000, total: 1_000 } } }),
    event("02", { metadata: { tokenUsage: { input: 0, output: 501, total: 501 } } }),
    event("03", { metadata: { tokenUsage: { input: 0, output: 500, total: 500 } } })
  ])
    .filter((kind) => kind === "token_hotspot")
    .some(Boolean)
);

const cascade = [
  event("01", { status: "error" }),
  event("02", { status: "error" }),
  event("03", { status: "error", parentId: "01" }),
  event("04", { status: "error", parentId: "03" })
];
assert.deepEqual(analyzeTraceInsights(cascade).filter((item) => item.kind === "failure_cascade"), [
  {
    kind: "failure_cascade",
    severity: "error",
    eventIds: ["01", "02", "03"],
    title: "Failure cascade",
    evidence: { errorCount: 3 }
  }
]);
assert.ok(!kinds(cascade.slice(0, 2)).includes("failure_cascade"));
assert.deepEqual(
  analyzeTraceInsights([
    event("root", { status: "error", timestamp: "2026-07-14T00:00:02.000Z" }),
    event("before", {
      status: "error",
      parentId: "root",
      timestamp: "2026-07-14T00:00:01.000Z"
    }),
    event("after", { status: "error", timestamp: "2026-07-14T00:00:03.000Z" })
  ]).find((item) => item.kind === "failure_cascade")?.eventIds,
  ["before", "root", "after"]
);
assert.deepEqual(
  analyzeTraceInsights([
    event("01", { status: "error" }),
    event("02", { status: "error" }),
    event("03", { status: "error" })
  ]).find((item) => item.kind === "failure_cascade")?.eventIds,
  ["01", "02", "03"]
);
assert.doesNotThrow(() =>
  analyzeTraceInsights([
    event("01", { status: "error", parentId: "02" }),
    event("02", { status: "error", parentId: "01" }),
    event("03", { status: "success" })
  ])
);

const unsorted = [
  event("late", {
    timestamp: "2026-07-14T00:00:03.000Z",
    durationMs: 10_000,
    metadata: { category: "mcp", mcpServer: "files", mcpTool: "read" }
  }),
  event("tie-first", {
    timestamp: "2026-07-14T00:00:01.000Z",
    metadata: { category: "mcp", mcpServer: "files", mcpTool: "read" }
  }),
  event("tie-second", {
    timestamp: "2026-07-14T00:00:01.000Z",
    metadata: { category: "mcp", mcpServer: "files", mcpTool: "read" }
  }),
  event("invalid-first", {
    timestamp: "invalid-first",
    durationMs: 10_000,
    metadata: { category: "lifecycle" }
  }),
  event("invalid-second", {
    timestamp: "invalid-second",
    durationMs: 10_000,
    metadata: { category: "lifecycle" }
  })
];
const before = structuredClone(unsorted);
assert.deepEqual(
  analyzeTraceInsights(unsorted).find((item) => item.kind === "repeated_action")?.eventIds,
  ["tie-first", "tie-second", "late"]
);
assert.deepEqual(
  analyzeTraceInsights(unsorted)
    .filter((item) => item.kind === "slow_step")
    .map((item) => item.eventIds[0]),
  ["late", "invalid-first", "invalid-second"]
);
assert.deepEqual(unsorted, before);

console.log("Agent-Trace trace insights smoke test passed.");
