import { readFileSync } from "node:fs";

import type { DashboardTraceEvent, DashboardTraceInsight } from "@agent-trace/schema";

import { formatTraceInsightEvidence, formatTraceInsightTitle } from "../../../lib/i18n.js";
import { buildTraceForest, type TraceTreeNode } from "./trace-tree.js";

const nested = buildTraceForest([
  event("child", "2026-01-01T00:00:02.000Z", "parent"),
  event("grandchild", "2026-01-01T00:00:03.000Z", "child"),
  event("parent", "2026-01-01T00:00:01.000Z")
]);

expectShape(nested, [{ id: "parent", children: [{ id: "child", children: [{ id: "grandchild" }] }] }]);

const orphan = buildTraceForest([
  event("orphan", "2026-01-01T00:00:02.000Z", "missing"),
  event("root", "2026-01-01T00:00:01.000Z")
]);

expectIds(orphan, ["root", "orphan"], "missing parents become roots");

const cycles = buildTraceForest([
  event("two-a", "2026-01-01T00:00:03.000Z", "two-b"),
  event("two-b", "2026-01-01T00:00:02.000Z", "two-a"),
  event("self", "2026-01-01T00:00:01.000Z", "self"),
  event("cycle-child", "2026-01-01T00:00:04.000Z", "two-a")
]);

expectIds(cycles, ["self", "two-b", "two-a"], "each cycle member becomes a chronological root");
expectIds(cycles[2]?.children ?? [], ["cycle-child"], "non-cycle children stay attached to cycle roots");

const ordered = buildTraceForest([
  event("invalid-first", "invalid-first"),
  event("same-first", "2026-01-01T00:00:01.000Z"),
  event("late", "2026-01-01T00:00:02.000Z"),
  event("same-second", "2026-01-01T00:00:01.000Z"),
  event("invalid-second", "invalid-second"),
  event("child-second", "2026-01-01T00:00:04.000Z", "same-first"),
  event("child-first", "2026-01-01T00:00:03.000Z", "same-first"),
  event("child-same-first", "2026-01-01T00:00:05.000Z", "same-first"),
  event("child-same-second", "2026-01-01T00:00:05.000Z", "same-first")
]);

expectIds(
  ordered,
  ["same-first", "same-second", "late", "invalid-first", "invalid-second"],
  "roots are chronological with stable ties and invalid timestamps"
);
expectIds(
  ordered[0]?.children ?? [],
  ["child-first", "child-second", "child-same-first", "child-same-second"],
  "children are chronological with stable ties"
);

const allEvents = [
  event("a", "2026-01-01T00:00:01.000Z", "b"),
  event("b", "2026-01-01T00:00:02.000Z", "a"),
  event("c", "2026-01-01T00:00:03.000Z", "a"),
  event("d", "2026-01-01T00:00:04.000Z", "missing"),
  event("e", "invalid", "d")
];
const flattened = flatten(buildTraceForest(allEvents));

expectIds(flattened, ["a", "c", "b", "d", "e"], "forest traversal contains every event once");
if (new Set(flattened.map((node) => node.event)).size !== allEvents.length) {
  throw new Error("Expected every input event object to appear exactly once.");
}

const localizedInsights: Array<{
  insight: DashboardTraceInsight;
  en: [string, string];
  zh: [string, string];
}> = [
  {
    insight: insight("repeated_action", { actionName: "read_file", count: 3 }),
    en: ["Repeated action", "read_file repeated 3 times."],
    zh: ["重复操作", "read_file 连续执行了 3 次。"]
  },
  {
    insight: insight("retry_loop", { actionName: "pnpm test", attempts: 3, failedAttempts: 2 }),
    en: ["Retry loop", "pnpm test took 3 attempts, including 2 failed attempts."],
    zh: ["重试循环", "pnpm test 共尝试 3 次，其中失败 2 次。"]
  },
  {
    insight: insight("slow_step", { durationMs: 10_000, thresholdMs: 10_000 }),
    en: ["Slow step", "Duration 10,000 ms reached the 10,000 ms threshold."],
    zh: ["慢步骤", "耗时 10,000 毫秒，达到 10,000 毫秒阈值。"]
  },
  {
    insight: insight("token_hotspot", { eventTokens: 1_000, runTokens: 2_000, share: 0.5 }),
    en: ["Token hotspot", "1,000 of 2,000 run tokens (50%)."],
    zh: ["Token 热点", "使用 1,000 / 2,000 个运行 Token（50%）。"]
  },
  {
    insight: insight("failure_cascade", { errorCount: 3 }),
    en: ["Failure cascade", "3 related errors were detected."],
    zh: ["失败级联", "检测到 3 个关联错误。"]
  }
];

for (const { insight, en, zh } of localizedInsights) {
  expectValue(formatTraceInsightTitle(insight.kind, "en"), en[0], `${insight.kind} English title`);
  expectValue(formatTraceInsightEvidence(insight, "en"), en[1], `${insight.kind} English evidence`);
  expectValue(formatTraceInsightTitle(insight.kind, "zh"), zh[0], `${insight.kind} Chinese title`);
  expectValue(formatTraceInsightEvidence(insight, "zh"), zh[1], `${insight.kind} Chinese evidence`);
}

const detailPageSource = readFileSync(
  new URL("../../../../../../packages/dashboard-ui/src/dashboard-app.tsx", import.meta.url),
  "utf8",
);
if (
  !detailPageSource.includes('client.get<{ insights: DashboardTraceInsight[] }>(`/runs/${encodeURIComponent(id)}/insights`)') ||
  !detailPageSource.includes(".catch(() => ({ insights: [] }))")
) {
  throw new Error("Expected the dedicated insight read model to fall back safely.");
}

console.log("Agent-Trace trace tree smoke test passed.");

function event(id: string, timestamp: string, parentId?: string): DashboardTraceEvent {
  return {
    id,
    runId: "run",
    parentId,
    type: "tool_call",
    name: id,
    status: "success",
    timestamp
  };
}

function insight(
  kind: DashboardTraceInsight["kind"],
  evidence: DashboardTraceInsight["evidence"]
): DashboardTraceInsight {
  return {
    kind,
    severity: kind === "failure_cascade" ? "error" : kind === "token_hotspot" ? "info" : "warning",
    eventIds: [kind],
    title: "API title must not be parsed",
    evidence
  };
}

function expectValue(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    throw new Error(`Expected ${label}: ${expected}; got ${actual}.`);
  }
}

function flatten(nodes: TraceTreeNode[]): TraceTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function expectIds(nodes: TraceTreeNode[], expected: string[], label: string) {
  const actual = nodes.map((node) => node.event.id);

  if (actual.join(",") !== expected.join(",")) {
    throw new Error(`Expected ${label}: ${expected.join(",")}; got ${actual.join(",")}.`);
  }
}

function expectShape(
  nodes: TraceTreeNode[],
  expected: Array<{ id: string; children?: Array<{ id: string; children?: Array<{ id: string }> }> }>
) {
  const actual = nodes.map(toShape);

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected nested tree ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function toShape(node: TraceTreeNode): { id: string; children?: ReturnType<typeof toShape>[] } {
  return {
    id: node.event.id,
    ...(node.children.length > 0 ? { children: node.children.map(toShape) } : {})
  };
}
