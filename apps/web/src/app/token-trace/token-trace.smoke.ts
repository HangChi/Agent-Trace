import type { DashboardRunTrendPoint } from "@agent-trace/schema";

import {
  aggregateTokenTracePoints,
  buildTokenTraceCalendar,
  getAvailableTokenTraceMonths,
  getTokenHeatLevel,
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

if (parseTokenTraceView(undefined) !== "overview") {
  throw new Error("The default Token-Trace view must be overview.");
}

if (parseTokenTraceView("calendar") !== "calendar" || parseTokenTraceView("invalid") !== "overview") {
  throw new Error("Token-Trace view parsing must accept calendar and reject invalid values.");
}

const availableMonths = getAvailableTokenTraceMonths([
  point("2024-01-31"),
  point("2024-02-01"),
  point("2024-03-01")
]);

if (availableMonths.join(",") !== "2024-01,2024-02,2024-03") {
  throw new Error(`Unexpected available month list: ${availableMonths.join(",")}`);
}

if (resolveTokenTraceMonth("2024-02", availableMonths) !== "2024-02") {
  throw new Error("A valid available month must be preserved.");
}

if (resolveTokenTraceMonth("2020-13", availableMonths) !== "2024-03") {
  throw new Error("An invalid month must fall back to the latest available month.");
}

if (resolveTokenTraceMonth("2023-12", availableMonths) !== "2024-03") {
  throw new Error("A month outside the 90-day window must fall back to the latest month.");
}

const leapCalendar = buildTokenTraceCalendar("2024-02", [
  point("2024-02-29", { runCount: 2, totalTokens: 120 })
]);

if (leapCalendar.length !== 35 || leapCalendar[0]?.date !== "2024-01-29") {
  throw new Error("February 2024 must use a Monday-first five-week calendar grid.");
}

const leapDay = leapCalendar.find((cell) => cell.date === "2024-02-29");
if (!leapDay?.inMonth || leapDay.point?.totalTokens !== 120) {
  throw new Error("Leap day trend data must be present in the February calendar.");
}

const summary = summarizeTokenTraceMonth("2024-02", [
  point("2024-02-01", {
    runCount: 3,
    successfulRunCount: 2,
    failedRunCount: 1,
    totalTokens: 100,
    costUsd: 0.25
  }),
  point("2024-02-02", {
    runCount: 1,
    successfulRunCount: 1,
    totalTokens: 50,
    costUsd: 0.1
  }),
  point("2024-03-01", { runCount: 9, totalTokens: 999 })
]);

if (
  summary.totalTokens !== 150 ||
  summary.costUsd !== 0.35 ||
  summary.runCount !== 4 ||
  summary.successfulRunCount !== 3 ||
  summary.successRate !== 75
) {
  throw new Error(`Unexpected monthly summary: ${JSON.stringify(summary)}`);
}

const heatLevels = [0, 1, 25, 50, 75, 100].map((value) => getTokenHeatLevel(value, 100));
if (heatLevels.join(",") !== "0,1,1,2,3,4") {
  throw new Error(`Unexpected heat levels: ${heatLevels.join(",")}`);
}

const emptySummary = summarizeTokenTraceMonth("2024-04", []);
if (emptySummary.totalTokens !== 0 || emptySummary.runCount !== 0 || emptySummary.successRate !== 0) {
  throw new Error("An empty month must retain a zero-valued summary.");
}

const aggregateSource = [
  point("2024-01-31", { runCount: 1, successfulRunCount: 1, totalTokens: 10, costUsd: 0.1 }),
  point("2024-02-01", { runCount: 2, successfulRunCount: 1, totalTokens: 20, costUsd: 0.2 }),
  point("2024-02-05", { runCount: 3, successfulRunCount: 2, totalTokens: 30, costUsd: 0.3 })
];
const weekly = aggregateTokenTracePoints(aggregateSource, "week");
const monthly = aggregateTokenTracePoints(aggregateSource, "month");

if (
  weekly.length !== 2 ||
  weekly[0]?.key !== "2024-01-29" ||
  weekly[0]?.totalTokens !== 30 ||
  weekly[1]?.key !== "2024-02-05" ||
  weekly[1]?.runCount !== 3
) {
  throw new Error(`Unexpected weekly aggregation: ${JSON.stringify(weekly)}`);
}

if (
  monthly.length !== 2 ||
  monthly[0]?.key !== "2024-01" ||
  monthly[0]?.totalTokens !== 10 ||
  monthly[1]?.key !== "2024-02" ||
  monthly[1]?.totalTokens !== 50 ||
  monthly[1]?.successfulRunCount !== 3
) {
  throw new Error(`Unexpected monthly aggregation: ${JSON.stringify(monthly)}`);
}

console.log("Agent-Trace Token-Trace pure function smoke test passed.");
