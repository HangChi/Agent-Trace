import assert from "node:assert/strict";
import type { DashboardRunTrendPoint } from "@agent-trace/schema";

import {
  aggregateTokenTracePoints,
  buildTokenTraceCalendar,
  getAvailableTokenTraceMonths,
  getTokenHeatLevel,
  parseTokenTracePeriod,
  parseTokenTraceView,
  resolveTokenTraceMonth,
  summarizeTokenTraceMonth
} from "./token-trace";

function point(
  date: string,
  overrides: Partial<DashboardRunTrendPoint> = {}
): DashboardRunTrendPoint {
  return {
    date,
    runCount: 0,
    successfulRunCount: 0,
    failedRunCount: 0,
    averageDurationMs: 0,
    totalTokens: 0,
    costUsd: 0,
    ...overrides
  };
}

assert.equal(parseTokenTraceView(undefined), "overview");
assert.equal(parseTokenTraceView("calendar"), "calendar");
assert.equal(parseTokenTraceView("invalid"), "overview");
assert.equal(parseTokenTracePeriod(undefined), "day");
assert.equal(parseTokenTracePeriod("week"), "week");
assert.equal(parseTokenTracePeriod("month"), "month");
assert.equal(parseTokenTracePeriod("invalid"), "day");

const points = [
  point("2024-01-31", {
    runCount: 1,
    successfulRunCount: 1,
    totalTokens: 10,
    costUsd: 0.1
  }),
  point("2024-02-01", {
    runCount: 2,
    successfulRunCount: 1,
    failedRunCount: 1,
    totalTokens: 20,
    costUsd: 0.2
  }),
  point("2024-02-05", {
    runCount: 3,
    successfulRunCount: 2,
    failedRunCount: 1,
    totalTokens: 30,
    costUsd: 0.3
  })
];

assert.deepEqual(getAvailableTokenTraceMonths(points), ["2024-01", "2024-02"]);
assert.equal(resolveTokenTraceMonth("2024-01", ["2024-01", "2024-02"]), "2024-01");
assert.equal(resolveTokenTraceMonth("2024-13", ["2024-01", "2024-02"]), "2024-02");
assert.equal(resolveTokenTraceMonth("2023-12", ["2024-01", "2024-02"]), "2024-02");

const calendar = buildTokenTraceCalendar("2024-02", points);
assert.equal(calendar.length, 35);
assert.equal(calendar[0]?.date, "2024-01-29");
assert.equal(calendar.find((cell) => cell.date === "2024-02-05")?.point?.totalTokens, 30);

const summary = summarizeTokenTraceMonth("2024-02", points);
assert.equal(summary.totalTokens, 50);
assert.equal(summary.costUsd, 0.5);
assert.equal(summary.runCount, 5);
assert.equal(summary.successfulRunCount, 3);
assert.equal(summary.failedRunCount, 2);
assert.equal(summary.successRate, 60);

assert.deepEqual(
  [0, 1, 25, 50, 75, 100].map((value) => getTokenHeatLevel(value, 100)),
  [0, 1, 1, 2, 3, 4]
);

const weekly = aggregateTokenTracePoints(points, "week");
assert.deepEqual(weekly.map((item) => item.key), ["2024-01-29", "2024-02-05"]);
assert.equal(weekly[0]?.totalTokens, 30);
assert.equal(weekly[1]?.runCount, 3);

const monthly = aggregateTokenTracePoints(points, "month");
assert.deepEqual(monthly.map((item) => item.key), ["2024-01", "2024-02"]);
assert.equal(monthly[1]?.totalTokens, 50);
assert.equal(monthly[1]?.successfulRunCount, 3);

console.log("Shared Token-Trace domain smoke test passed.");
