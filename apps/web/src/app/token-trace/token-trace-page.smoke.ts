import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const dailyChart = readFileSync(new URL("./daily-token-chart.tsx", import.meta.url), "utf8");
const homePage = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const runsPage = readFileSync(new URL("../runs/page.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../../components/console-header.tsx", import.meta.url), "utf8");

for (const marker of [
  "Token-Trace",
  "/analytics/runs/trends?days=90",
  "/usage/summary",
  "TokenTraceOverview",
  "TokenUsageStatistics",
  "weeklyStatistics",
  "monthlyStatistics",
  "TokenTraceCalendar",
  "UsageLedger"
]) {
  if (!page.includes(marker)) {
    throw new Error(`Token-Trace page is missing: ${marker}`);
  }
}

for (const marker of ["/analytics/runs/trends?days=90", "/usage/summary", "TokenTraceOverview", "TokenTraceCalendar", "UsageLedger"]) {
  if (runsPage.includes(marker)) {
    throw new Error(`Runs page still owns Token-Trace content: ${marker}`);
  }
}

for (const forbidden of ["Chart.js", "chart.js", "token-stats.html", "token-calendar.html", "token_stats.py"]) {
  if (page.includes(forbidden)) {
    throw new Error(`Token-Trace must not depend on reference implementation: ${forbidden}`);
  }
}

if (!page.includes("view=overview") || !page.includes("view=calendar")) {
  throw new Error("Token-Trace must expose overview and calendar URL-backed views.");
}

if (!page.includes("<ConsoleHeader locale={locale} path={currentPath}")) {
  throw new Error("Token-Trace must preserve its current query parameters in ConsoleHeader.");
}

for (const marker of ["overflow-x-auto", "min-w-[720px]", "min-w-[820px]", "grid-cols-7"]) {
  if (!page.includes(marker)) {
    throw new Error(`Token-Trace responsive layout is missing: ${marker}`);
  }
}

if (!page.includes("max-w-[1800px]")) {
  throw new Error("Token-Trace content width must align with ConsoleHeader.");
}

const periodChartSource = page.slice(
  page.indexOf("function PeriodBarChart"),
  page.indexOf("function TokenTraceCalendar")
);
if (periodChartSource.includes("aside=")) {
  throw new Error("Weekly and monthly charts must not show a duplicated 90-day total badge.");
}

for (const marker of ['"use client"', "onPointerMove", "onKeyDown", "aria-live", "DailyTokenChart"]) {
  if (!dailyChart.includes(marker) && !page.includes(marker)) {
    throw new Error(`Daily token chart interaction is missing: ${marker}`);
  }
}

if (dailyChart.includes("index % 7")) {
  throw new Error("Daily token chart must not render decorative weekly marker circles.");
}

const homeEntry = header.indexOf('localizedHref("/runs", locale)');
const tokenTraceEntry = header.indexOf('localizedHref("/token-trace", locale)');
const analyticsEntry = header.indexOf('localizedHref("/analytics", locale)');

if (homeEntry === -1 || tokenTraceEntry <= homeEntry || analyticsEntry <= tokenTraceEntry) {
  throw new Error("Console header must place Home and Token-Trace together on the left.");
}

if (header.includes("collectorUrl") || header.includes("Server")) {
  throw new Error("Console header must not expose the Collector status control.");
}

if (!homePage.includes('redirect("/runs")')) {
  throw new Error("The default route must continue to open the Home runs page.");
}

console.log("Agent-Trace Token-Trace page smoke test passed.");
