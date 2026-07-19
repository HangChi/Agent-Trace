import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("./dashboard-app.tsx", import.meta.url), "utf8");
const tokenTrace = await readFile(new URL("./token-trace-view.tsx", import.meta.url), "utf8");
const requiredViews = [
  "DashboardApp",
  "DashboardShell",
  "RunsView",
  "RunDetailView",
  "RunCompareView",
  "TokenTraceView",
  "AnalyticsView",
  "EvaluationsView",
  "SandboxView",
  "MaintenanceView"
];

for (const view of requiredViews) {
  assert.match(index, new RegExp(`export .*${view}`), `missing shared export: ${view}`);
}

for (const endpoint of [
  "/analytics/budgets",
  "/evaluations/results",
  "/sandbox/replays/",
  "/maintenance/prune",
  "/organization"
]) {
  assert.match(dashboard, new RegExp(endpoint.replace("/", "\\/")), `missing shared workflow: ${endpoint}`);
}

for (const marker of ["mcpCount", "skillCount", "追踪内容", "删除 Run", "添加用例", "执行清理"]) {
  assert.ok(dashboard.includes(marker), `missing shared UI marker: ${marker}`);
}

assert.ok(
  dashboard.includes('key={connected ? "connected" : "connecting"}'),
  "Dashboard pages must reload after the desktop Collector becomes reachable."
);

for (const marker of [
  "view=overview&period=",
  "view=calendar&month=",
  "aggregateTokenTracePoints",
  "buildTokenTraceCalendar",
  "item.provider",
  "costUsd",
  "Promise.allSettled"
]) {
  assert.ok(tokenTrace.includes(marker), `missing Token-Trace behavior: ${marker}`);
}

console.log(`Shared dashboard contract OK (${requiredViews.length} exports and full workflows).`);
