import type { DashboardRunTrendPoint } from "@agent-trace/schema";

export type TokenTraceView = "overview" | "calendar";

export type TokenTraceCalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
  point?: DashboardRunTrendPoint;
};

export type TokenTraceAggregatePeriod = "week" | "month";

export type TokenTraceAggregatePoint = {
  key: string;
  totalTokens: number;
  costUsd: number;
  runCount: number;
  successfulRunCount: number;
  failedRunCount: number;
};

type SearchParamValue = string | string[] | undefined;

export function parseTokenTraceView(value: SearchParamValue): TokenTraceView {
  const raw = Array.isArray(value) ? value[0] : value;

  return raw === "calendar" ? "calendar" : "overview";
}

export function getAvailableTokenTraceMonths(points: DashboardRunTrendPoint[]) {
  return [...new Set(points.map((point) => point.date.slice(0, 7)).filter(isMonthValue))].sort();
}

export function resolveTokenTraceMonth(
  value: SearchParamValue,
  availableMonths: string[],
  fallbackMonth = new Date().toISOString().slice(0, 7)
) {
  const raw = Array.isArray(value) ? value[0] : value;
  const latestMonth = availableMonths.at(-1) ?? fallbackMonth;

  return raw && isMonthValue(raw) && availableMonths.includes(raw) ? raw : latestMonth;
}

export function buildTokenTraceCalendar(
  month: string,
  points: DashboardRunTrendPoint[]
): TokenTraceCalendarCell[] {
  const { year, monthIndex } = parseMonth(month);
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const firstCell = new Date(Date.UTC(year, monthIndex, 1 - mondayOffset));
  const pointByDate = new Map(points.map((point) => [point.date, point]));

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(firstCell);
    date.setUTCDate(firstCell.getUTCDate() + index);
    const dateValue = date.toISOString().slice(0, 10);

    return {
      date: dateValue,
      day: date.getUTCDate(),
      inMonth: date.getUTCFullYear() === year && date.getUTCMonth() === monthIndex,
      point: pointByDate.get(dateValue)
    };
  });
}

export function summarizeTokenTraceMonth(
  month: string,
  points: DashboardRunTrendPoint[]
) {
  const summary = points
    .filter((point) => point.date.startsWith(`${month}-`))
    .reduce(
      (total, point) => ({
        totalTokens: total.totalTokens + point.totalTokens,
        costUsd: total.costUsd + point.costUsd,
        runCount: total.runCount + point.runCount,
        successfulRunCount: total.successfulRunCount + point.successfulRunCount,
        failedRunCount: total.failedRunCount + point.failedRunCount
      }),
      {
        totalTokens: 0,
        costUsd: 0,
        runCount: 0,
        successfulRunCount: 0,
        failedRunCount: 0
      }
    );

  return {
    ...summary,
    successRate: summary.runCount > 0
      ? Math.round(summary.successfulRunCount / summary.runCount * 100)
      : 0
  };
}

export function getTokenHeatLevel(totalTokens: number, maxTokens: number) {
  if (totalTokens <= 0 || maxTokens <= 0) return 0;

  const ratio = totalTokens / maxTokens;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function aggregateTokenTracePoints(
  points: DashboardRunTrendPoint[],
  period: TokenTraceAggregatePeriod
): TokenTraceAggregatePoint[] {
  const aggregates = new Map<string, TokenTraceAggregatePoint>();

  for (const point of points) {
    const key = period === "month" ? point.date.slice(0, 7) : getUtcWeekStart(point.date);
    const aggregate = aggregates.get(key) ?? {
      key,
      totalTokens: 0,
      costUsd: 0,
      runCount: 0,
      successfulRunCount: 0,
      failedRunCount: 0
    };

    aggregate.totalTokens += point.totalTokens;
    aggregate.costUsd += point.costUsd;
    aggregate.runCount += point.runCount;
    aggregate.successfulRunCount += point.successfulRunCount;
    aggregate.failedRunCount += point.failedRunCount;
    aggregates.set(key, aggregate);
  }

  return [...aggregates.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function isMonthValue(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;

  const { year, monthIndex } = parseMonth(value);
  const date = new Date(Date.UTC(year, monthIndex, 1));

  return date.getUTCFullYear() === year && date.getUTCMonth() === monthIndex;
}

function parseMonth(month: string) {
  return {
    year: Number(month.slice(0, 4)),
    monthIndex: Number(month.slice(5, 7)) - 1
  };
}

function getUtcWeekStart(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);

  return date.toISOString().slice(0, 10);
}
