import type {
  DashboardRunTrendPoint,
  DashboardRunTrends,
  DashboardUsageSummary
} from "@agent-trace/schema";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Coins,
  Cpu,
  TrendingUp,
  Users
} from "lucide-react";
import Link from "next/link";

import { ConsoleHeader } from "~/components";
import { TelemetryStrip } from "~/components/telemetry-strip";
import { Card } from "~/components/ui/card";
import { copy, localizedHref, parseLocale, type Locale } from "~/lib/i18n";
import { cn } from "~/lib/utils";
import { AutoRefresh } from "../runs/run-controls";
import { DailyTokenChart } from "./daily-token-chart";
import {
  aggregateTokenTracePoints,
  buildTokenTraceCalendar,
  getAvailableTokenTraceMonths,
  getTokenHeatLevel,
  parseTokenTraceView,
  resolveTokenTraceMonth,
  summarizeTokenTraceMonth,
  type TokenTraceAggregatePoint,
  type TokenTraceView
} from "./token-trace";

export const dynamic = "force-dynamic";

const collectorUrl =
  process.env.AGENT_TRACE_API_URL ??
  process.env.TOOLTRACE_API_URL ??
  "http://localhost:4319";

type TokenTraceSearchParams = {
  lang?: string | string[];
  view?: string | string[];
  month?: string | string[];
};

export default async function TokenTracePage({
  searchParams
}: {
  searchParams: Promise<TokenTraceSearchParams>;
}) {
  const params = await searchParams;
  const locale = parseLocale(params.lang);
  const view = parseTokenTraceView(params.view);
  const [trendResult, usageResult, dailyUsageResult] = await Promise.all([
    getRunTrends(locale, view === "overview" ? 365 : 90),
    getUsageSummary(locale),
    view === "overview" ? getDailyUsage(locale) : Promise.resolve({ points: [] })
  ]);
  const availableMonths = getAvailableTokenTraceMonths(trendResult.trends.points);
  const selectedMonth = resolveTokenTraceMonth(params.month, availableMonths);
  const monthlyUsageResult = view === "calendar"
    ? await getMonthlyUsageSummary(locale, selectedMonth)
    : undefined;
  const currentPath = tokenTraceHref(locale, view, selectedMonth);
  const text = copy[locale].tokenTrace;

  return (
    <main id="main-content" className="min-h-dvh bg-background text-foreground">
      <AutoRefresh collectorUrl={collectorUrl} />
      <ConsoleHeader locale={locale} path={currentPath} />

      <section className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6 2xl:px-10">
        {view === "overview" ? (
          <TokenTraceOverview
            trendResult={trendResult}
            usageResult={usageResult}
            dailyUsageResult={dailyUsageResult}
            locale={locale}
          />
        ) : (
          <TokenTraceCalendar
            result={trendResult}
            usageResult={monthlyUsageResult}
            month={selectedMonth}
            availableMonths={availableMonths}
            locale={locale}
          />
        )}
      </section>
    </main>
  );
}

function TokenTraceOverview({
  trendResult,
  usageResult,
  dailyUsageResult,
  locale
}: {
  trendResult: TrendResult;
  usageResult: UsageResult;
  dailyUsageResult: DailyUsageResult;
  locale: Locale;
}) {
  const text = copy[locale].tokenTrace;

  return (
    <div className="space-y-4">
      <TelemetryStrip
        items={[
          {
            label: text.totalTokens,
            value: formatInteger(usageResult.summary.totalTokens, locale),
            icon: Coins,
            tone: "trace"
          },
          {
            label: text.estimatedCost,
            value: formatUsd(usageResult.summary.costUsd),
            icon: CircleDollarSign
          },
          {
            label: text.clients,
            value: usageResult.summary.clients.length,
            icon: Users
          },
          {
            label: text.models,
            value: usageResult.summary.models.length,
            icon: Cpu
          }
        ]}
      />

      <TokenUsageStatistics
        result={trendResult}
        activityPoints={mergeActivityPoints(trendResult.trends.points, dailyUsageResult.points)}
        locale={locale}
      />
      <UsageLedger
        summary={usageResult.summary}
        error={usageResult.error}
        locale={locale}
      />
    </div>
  );
}

function TokenActivityBoard({
  points,
  locale
}: {
  points: DashboardRunTrendPoint[];
  locale: Locale;
}) {
  const text = copy[locale].tokenTrace;
  const latestPoint = points.at(-1);
  const currentYear = latestPoint?.date.slice(0, 4);
  const activityPoints = currentYear
    ? points.filter((point) => point.date.startsWith(`${currentYear}-`))
    : points;
  const maxTokens = Math.max(0, ...activityPoints.map((point) => point.totalTokens));
  const totalTokens = activityPoints.reduce((total, point) => total + point.totalTokens, 0);
  const activeDays = activityPoints.filter(
    (point) => point.runCount > 0 || point.totalTokens > 0
  ).length;
  const firstPoint = activityPoints[0];
  const lastPoint = activityPoints.at(-1);
  const leadingDays = firstPoint
    ? (new Date(`${firstPoint.date}T00:00:00Z`).getUTCDay() + 6) % 7
    : 0;
  const cells: Array<DashboardRunTrendPoint | undefined> = activityPoints.length > 0
    ? [...Array.from({ length: leadingDays }, () => undefined), ...activityPoints]
    : Array.from({ length: 35 }, () => undefined);
  const windowLabel = firstPoint && lastPoint
    ? `UTC · ${formatTrendDate(firstPoint.date, locale)} – ${formatTrendDate(lastPoint.date, locale)} · M`
    : "UTC · M";

  return (
    <Card className="h-full overflow-hidden py-0">
      <div className="flex h-full min-h-[286px] flex-col px-5 py-5">
        <div>
          <div className="flex items-center gap-2 text-foreground">
            <CalendarDays className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">{text.activity}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {windowLabel}
          </p>
        </div>

        <div className="my-auto min-w-0 overflow-x-auto py-5">
            <ol
              className="mx-auto grid w-max grid-flow-col grid-rows-7 gap-1"
              aria-label={text.activity}
            >
              {cells.map((point, index) => {
                if (!point) {
                  return (
                    <li
                      key={`activity-empty-${index}`}
                      className="size-3 rounded-[2px] bg-transparent sm:size-3.5 2xl:size-4"
                      aria-hidden
                    />
                  );
                }

                const level = getTokenHeatLevel(point.totalTokens, maxTokens);
                const description = `${formatTrendDate(point.date, locale)} · ${formatTokenMillions(point.totalTokens, locale)}M ${text.tokens}`;

                return (
                  <li
                    key={point.date}
                    className={cn(
                      "size-3 rounded-[2px] hover:ring-1 hover:ring-primary sm:size-3.5 2xl:size-4",
                      activityHeatClassName(level)
                    )}
                    title={description}
                    aria-label={description}
                  />
                );
              })}
            </ol>
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-border/70 pt-4">
          <div>
            <p className="text-lg font-semibold tracking-[-0.02em] text-foreground tabular-nums">
              {formatTokenMillions(totalTokens, locale)}M
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {text.activitySummary
                .replace("{count}", formatInteger(activeDays, locale))
                .replace("{days}", formatInteger(activityPoints.length, locale))}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground tabular-nums">
            <span>0M</span>
            {[1, 2, 3, 4].map((level) => (
              <span
                key={level}
                className={cn("size-2 rounded-[1px]", activityHeatClassName(level))}
                aria-hidden
              />
            ))}
            <span>{formatTokenMillions(maxTokens, locale)}M</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function TokenUsageStatistics({
  result,
  activityPoints,
  locale
}: {
  result: TrendResult;
  activityPoints: DashboardRunTrendPoint[];
  locale: Locale;
}) {
  const text = copy[locale].tokenTrace;
  const yearPoints = result.trends.points;
  const recentPoints = yearPoints.slice(-90);
  const currentMonth = yearPoints.at(-1)?.date.slice(0, 7);
  const points = currentMonth
    ? yearPoints.filter((point) => point.date.startsWith(currentMonth))
    : [];
  const weeklyPoints = aggregateTokenTracePoints(recentPoints, "week");
  const monthlyPoints = aggregateTokenTracePoints(recentPoints, "month");
  const hasData = points.some((point) => point.runCount > 0 || point.totalTokens > 0);
  const hasRecentData = recentPoints.some((point) => point.runCount > 0 || point.totalTokens > 0);
  const totalTokens = points.reduce((total, point) => total + point.totalTokens, 0);
  const activeDays = points.filter(
    (point) => point.runCount > 0 || point.totalTokens > 0
  ).length;
  const peakPoint = points.reduce<DashboardRunTrendPoint | undefined>(
    (peak, point) => !peak || point.totalTokens > peak.totalTokens ? point : peak,
    undefined
  );
  const labelPoints = points.filter((_, index) => index % 5 === 0 || index === points.length - 1);

  return (
    <div className="space-y-4">
      <div className={cn(
        "grid gap-4",
        !result.error && "xl:grid-cols-2"
      )}>
        {!result.error ? <TokenActivityBoard points={activityPoints} locale={locale} /> : null}

        <Card className="overflow-hidden py-0">
          <SectionHeader
            icon={TrendingUp}
            title={text.recentTrend}
            help={text.recentTrendHelp}
            aside={text.currentMonthWindow}
          />

          {result.error ? (
            <InlineError message={result.error} />
          ) : !hasData ? (
            <EmptyPanel message={text.noTrendData} />
          ) : (
            <div className="grid 2xl:grid-cols-[160px_minmax(0,1fr)]">
              <aside className="border-b border-border/70 bg-surface-muted/35 px-5 py-5 2xl:border-b-0 2xl:border-r">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {text.totalTokens}
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground tabular-nums">
                  {formatTokenMillions(totalTokens, locale)}M
                </p>
                <div className="mt-5 space-y-3 border-t border-border/70 pt-4 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{text.activeDays}</span>
                    <span className="font-semibold tabular-nums">{activeDays} / {points.length}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{text.dailyAverage}</span>
                    <span className="font-semibold tabular-nums">
                      {formatTokenMillions(totalTokens / Math.max(1, points.length), locale)}M
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{text.peakDay}</span>
                    <span className="font-semibold tabular-nums">
                      {peakPoint ? formatTrendDate(peakPoint.date, locale) : "—"}
                    </span>
                  </div>
                </div>
              </aside>

              <div className="overflow-x-auto px-4 pb-3 pt-4 sm:px-5">
                <div className="min-w-[620px]">
                  <DailyTokenChart
                    points={points}
                    locale={locale}
                    label={text.recentTrend}
                    tooltipLabel={text.dailyTokenUsage}
                  />
                  <ol
                    className="grid border-t border-border/70 pt-2"
                    style={{ gridTemplateColumns: `repeat(${labelPoints.length}, minmax(0, 1fr))` }}
                  >
                    {labelPoints.map((point) => (
                      <li key={point.date} className="min-w-0 text-center">
                        <div className="truncate text-[10px] text-muted-foreground tabular-nums">
                          {formatTrendDate(point.date, locale)}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {!result.error && hasRecentData ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <PeriodBarChart
            title={text.weeklyStatistics}
            help={text.weeklyStatisticsHelp}
            points={weeklyPoints}
            period="week"
            locale={locale}
          />
          <PeriodBarChart
            title={text.monthlyStatistics}
            help={text.monthlyStatisticsHelp}
            points={monthlyPoints}
            period="month"
            locale={locale}
          />
        </div>
      ) : null}
    </div>
  );
}

function PeriodBarChart({
  title,
  help,
  points,
  period,
  locale
}: {
  title: string;
  help: string;
  points: TokenTraceAggregatePoint[];
  period: "week" | "month";
  locale: Locale;
}) {
  const maxTokens = Math.max(1, ...points.map((point) => point.totalTokens));
  const text = copy[locale].tokenTrace;

  return (
    <Card className="overflow-hidden py-0">
      <SectionHeader
        icon={CalendarDays}
        title={title}
        help={help}
      />
      <div className="overflow-x-auto px-4 pb-4 pt-5 sm:px-5">
        <ol
          className={cn(
            "grid h-52 items-end gap-2",
            period === "week" ? "min-w-[720px]" : "min-w-[420px]"
          )}
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
          aria-label={title}
        >
          {points.map((point) => (
            <li key={point.key} className="flex h-full min-w-0 flex-col justify-end">
              <div className="mb-2.5 truncate text-center text-[10px] font-semibold text-foreground tabular-nums">
                {formatCompactNumber(point.totalTokens, locale)}
              </div>
              <div className="relative flex h-36 items-end justify-center border-b border-border/90">
                <div className="pointer-events-none absolute inset-0 grid grid-rows-4" aria-hidden>
                  {[0, 1, 2, 3].map((line) => (
                    <span key={line} className="border-t border-dashed border-border/50" />
                  ))}
                </div>
                <div
                  className={cn(
                    "relative z-[1] w-[62%] max-w-[92px] rounded-t-md",
                    "bg-gradient-to-t from-primary/95 to-primary/62",
                    "shadow-[0_8px_18px_color-mix(in_srgb,var(--primary)_10%,transparent)]",
                    "transition-[filter,opacity] duration-200 hover:brightness-110"
                  )}
                  style={{ height: `${point.totalTokens > 0 ? Math.max(3, point.totalTokens / maxTokens * 100) : 0}%` }}
                  title={`${formatAggregateLabel(point.key, period, locale)} · ${formatInteger(point.totalTokens, locale)} ${text.tokens} · ${point.runCount} Run · ${formatUsd(point.costUsd)}`}
                />
              </div>
              <div className="mt-2 truncate text-center text-[10px] text-muted-foreground tabular-nums">
                {formatAggregateLabel(point.key, period, locale)}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

function MonthlyUsageStrip({
  totalTokens,
  activeDays,
  daysInMonth,
  sessionCount,
  callCount,
  locale
}: {
  totalTokens: number;
  activeDays: number;
  daysInMonth: number;
  sessionCount: number;
  callCount: number;
  locale: Locale;
}) {
  const text = copy[locale].tokenTrace;
  const items = [
    {
      label: text.monthlyTotal,
      value: formatCompactNumber(totalTokens, locale),
      accent: true
    },
    {
      label: text.dailyConsumption,
      value: formatCompactNumber(totalTokens / Math.max(1, activeDays), locale)
    },
    {
      label: text.activeDays,
      value: formatInteger(activeDays, locale),
      detail: `/ ${formatInteger(daysInMonth, locale)}`
    },
    {
      label: text.sessionDays,
      value: formatInteger(sessionCount, locale)
    },
    {
      label: text.calls,
      value: formatInteger(callCount, locale)
    }
  ];

  return (
    <Card className="overflow-hidden py-0">
      <section className="grid grid-cols-2 md:grid-cols-5" aria-label={text.monthSummary}>
        {items.map((item, index) => (
          <div
            key={item.label}
            className={cn(
              "min-w-0 px-5 py-4",
              index > 0 && "md:border-l md:border-border/70",
              index % 2 === 1 && "max-md:border-l max-md:border-border/70",
              index >= 2 && "max-md:border-t max-md:border-border/70"
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {item.label}
            </p>
            <p
              className={cn(
                "mt-2 truncate text-xl font-semibold tracking-[-0.025em] text-foreground tabular-nums",
                item.accent && "text-primary"
              )}
            >
              {item.value}
              {item.detail ? (
                <span className="ml-1 text-xs font-medium text-muted-foreground">
                  {item.detail}
                </span>
              ) : null}
            </p>
          </div>
        ))}
      </section>
    </Card>
  );
}

const modelUsageColors = [
  "#5271ff",
  "#20a58f",
  "#8b6bd6",
  "#df8a52",
  "#d45f7a",
  "#568bb3"
];

function ModelUsageDistribution({
  models,
  totalTokens,
  error,
  locale
}: {
  models: DashboardMonthlyUsageSummary["models"];
  totalTokens: number;
  error?: string;
  locale: Locale;
}) {
  const text = copy[locale].tokenTrace;
  const sortedModels = [...models]
    .filter((model) => model.totalTokens > 0)
    .sort((left, right) => right.totalTokens - left.totalTokens);
  const modelTotal = sortedModels.reduce((total, model) => total + model.totalTokens, 0);
  const gradient = buildModelUsageGradient(sortedModels);

  return (
    <Card className="overflow-hidden py-0">
      <SectionHeader
        icon={Cpu}
        title={text.modelUsageDistribution}
        help={text.modelUsageDistributionHelp}
      />

      {error ? <InlineError message={error} /> : null}

      {sortedModels.length === 0 ? (
        <EmptyPanel message={text.noModelUsage} />
      ) : (
        <div className="grid gap-6 px-5 py-5 lg:grid-cols-[190px_minmax(0,1fr)] lg:items-center">
          <div className="flex justify-center">
            <div
              className="relative size-40 rounded-full"
              style={{ background: gradient }}
              role="img"
              aria-label={text.modelUsageDistribution}
            >
              <div className="absolute inset-7 flex flex-col items-center justify-center rounded-full border border-border/70 bg-surface-raised shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_35%,transparent)]">
                <span className="text-xl font-semibold tracking-[-0.025em] text-foreground tabular-nums">
                  {formatCompactNumber(modelTotal || totalTokens, locale)}
                </span>
                <span className="mt-1 text-[10px] text-muted-foreground">
                  {text.thisMonthTotal}
                </span>
              </div>
            </div>
          </div>

          <ol className="grid gap-2 sm:grid-cols-2">
            {sortedModels.map((model, index) => {
              const percentage = modelTotal > 0 ? model.totalTokens / modelTotal * 100 : 0;

              return (
                <li
                  key={`${model.provider ?? ""}-${model.model}`}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-surface-muted/25 px-4 py-3"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: modelUsageColors[index % modelUsageColors.length] }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-foreground">
                      {model.model}
                    </div>
                    {model.provider ? (
                      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {model.provider}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <span className="text-xs font-semibold text-foreground">
                      {formatCompactNumber(model.totalTokens, locale)}
                    </span>
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {percentage.toFixed(1)}%
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Card>
  );
}

function TokenTraceCalendar({
  result,
  usageResult,
  month,
  availableMonths,
  locale
}: {
  result: TrendResult;
  usageResult?: MonthlyUsageResult;
  month: string;
  availableMonths: string[];
  locale: Locale;
}) {
  const text = copy[locale].tokenTrace;
  const summary = summarizeTokenTraceMonth(month, result.trends.points);
  const cells = buildTokenTraceCalendar(month, result.trends.points);
  const monthPoints = result.trends.points.filter((point) => point.date.startsWith(`${month}-`));
  const maxTokens = Math.max(0, ...monthPoints.map((point) => point.totalTokens));
  const monthIndex = availableMonths.indexOf(month);
  const previousMonth = monthIndex > 0 ? availableMonths[monthIndex - 1] : undefined;
  const nextMonth = monthIndex >= 0 && monthIndex < availableMonths.length - 1
    ? availableMonths[monthIndex + 1]
    : undefined;
  const latestMonth = availableMonths.at(-1);
  const daysInMonth = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)
  ).getUTCDate();
  const usageSummary = usageResult?.summary;
  const hasMonthlyUsage = Boolean(usageSummary && usageSummary.totalTokens > 0);
  const activeDays = hasMonthlyUsage
    ? usageSummary?.activeDays ?? 0
    : monthPoints.filter((point) => point.runCount > 0 || point.totalTokens > 0).length;
  const monthlyTokens = hasMonthlyUsage ? usageSummary?.totalTokens ?? 0 : summary.totalTokens;
  const sessionCount = hasMonthlyUsage ? usageSummary?.sessionCount ?? 0 : summary.runCount;
  const callCount = hasMonthlyUsage ? usageSummary?.callCount ?? 0 : 0;

  return (
    <div className="space-y-4">
      <MonthlyUsageStrip
        activeDays={activeDays}
        callCount={callCount}
        daysInMonth={daysInMonth}
        locale={locale}
        sessionCount={sessionCount}
        totalTokens={monthlyTokens}
      />

      <Card className="overflow-hidden py-0">
        <div className="flex flex-col gap-4 border-b border-border/70 bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">
                {formatMonthLabel(month, locale)}
              </h2>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{text.monthSummaryHelp}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em]">{text.utcWindow}</span>
              <span className="inline-flex items-center gap-1.5" aria-label={text.tokenHeat}>
                {[1, 2, 3, 4].map((level) => (
                  <span key={level} className={cn("size-2 rounded-[2px]", heatLegendClassName(level))} />
                ))}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5" aria-label={text.calendar}>
            <MonthControl
              href={previousMonth ? tokenTraceHref(locale, "calendar", previousMonth) : undefined}
              label={text.previousMonth}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </MonthControl>
            <MonthControl
              href={latestMonth ? tokenTraceHref(locale, "calendar", latestMonth) : undefined}
              label={text.latestMonth}
            >
              {text.latestMonth}
            </MonthControl>
            <MonthControl
              href={nextMonth ? tokenTraceHref(locale, "calendar", nextMonth) : undefined}
              label={text.nextMonth}
            >
              <ChevronRight className="size-4" aria-hidden />
            </MonthControl>
          </div>
        </div>

        {result.error ? (
          <InlineError message={result.error} />
        ) : (
          <div className="overflow-x-auto p-3 sm:p-4">
            <div className="min-w-[820px] overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-7 border-b border-border bg-surface-muted/70" role="row">
                {text.weekdays.map((weekday) => (
                  <div
                    key={weekday}
                    className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                    role="columnheader"
                  >
                    {weekday}
                  </div>
                ))}
              </div>
              <ol className="grid grid-cols-7 gap-px bg-border" aria-label={formatMonthLabel(month, locale)}>
                {cells.map((cell) => {
                  const point = cell.inMonth ? cell.point : undefined;
                  const hasActivity = Boolean(
                    point && (point.runCount > 0 || point.totalTokens > 0 || point.costUsd > 0)
                  );
                  const successRate = point && point.runCount > 0
                    ? Math.round(point.successfulRunCount / point.runCount * 100)
                    : 0;
                  const heatLevel = point ? getTokenHeatLevel(point.totalTokens, maxTokens) : 0;

                  return (
                    <li
                      key={cell.date}
                      className={cn(
                        "flex min-h-28 flex-col p-3",
                        cell.inMonth
                          ? heatClassName(heatLevel)
                          : "bg-surface-muted/65 text-muted-foreground/35"
                      )}
                      title={cell.inMonth ? cell.date : undefined}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <time
                          dateTime={cell.date}
                          className={cn(
                            "text-[11px] font-semibold tabular-nums",
                            cell.inMonth ? "text-foreground" : "text-muted-foreground/45"
                          )}
                        >
                          {cell.day}
                        </time>
                        {point?.failedRunCount ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-medium text-status-error tabular-nums">
                            <span className="size-1 rounded-full bg-status-error" aria-hidden />
                            {point.failedRunCount}
                          </span>
                        ) : null}
                      </div>

                      {cell.inMonth ? (
                        hasActivity && point ? (
                          <div className="mt-auto pt-5">
                            <div className="truncate text-[17px] font-semibold tracking-[-0.025em] text-foreground tabular-nums">
                              {formatCompactNumber(point.totalTokens, locale)}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[9px] text-muted-foreground tabular-nums">
                              <span>{point.runCount} Run</span>
                              <span>{successRate}%</span>
                              <span>{formatUsd(point.costUsd)}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="sr-only">{text.noMonthActivity}</span>
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}
      </Card>

      <ModelUsageDistribution
        error={usageResult?.error}
        locale={locale}
        models={usageSummary?.models ?? []}
        totalTokens={monthlyTokens}
      />
    </div>
  );
}

function MonthControl({
  href,
  label,
  children
}: {
  href?: ReturnType<typeof localizedHref>;
  label: string;
  children: React.ReactNode;
}) {
  const className = cn(
    "inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-[var(--shadow-control)] outline-none transition-colors",
    href
      ? "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      : "cursor-not-allowed text-muted-foreground/35"
  );

  if (!href) {
    return (
      <span className={className} aria-label={label} aria-disabled="true">
        {children}
      </span>
    );
  }

  return (
    <Link href={href} className={className} aria-label={label}>
      {children}
    </Link>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  help,
  aside
}: {
  icon: typeof TrendingUp;
  title: string;
  help: string;
  aside?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 bg-surface-raised px-4 py-3.5 sm:px-5">
      <div>
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      </div>
      {aside ? (
        <span className="rounded-md border border-border/80 bg-surface-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {aside}
        </span>
      ) : null}
    </div>
  );
}

function UsageLedger({
  summary,
  error,
  locale
}: {
  summary: DashboardUsageSummary;
  error?: string;
  locale: Locale;
}) {
  const text = copy[locale].runs;
  const clients = [...summary.clients].sort((a, b) => b.totalTokens - a.totalTokens);
  const models = [...summary.models].sort((a, b) => b.totalTokens - a.totalTokens);

  return (
    <Card className="overflow-hidden py-0">
      <div className="flex flex-col gap-3 border-b border-border/70 bg-surface-raised px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <Coins className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">{text.usageTitle}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{text.usageHelp}</p>
        </div>
        <div className="flex items-baseline gap-4 tabular-nums">
          <div className="text-right">
            <div className="text-lg font-semibold text-foreground">
              {formatInteger(summary.totalTokens, locale)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tokens</div>
          </div>
          <div className="border-l border-border/80 pl-4 text-right">
            <div className="text-lg font-semibold text-foreground">{formatUsd(summary.costUsd)}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {text.usageEstimatedCost}
            </div>
          </div>
        </div>
      </div>

      {error ? <InlineError message={error} /> : null}

      <div className="grid divide-y divide-border/70 md:grid-cols-2 md:divide-x md:divide-y-0">
        <UsageRankList
          title={text.usageClients}
          empty={text.usageEmpty}
          locale={locale}
          items={clients.map((item) => ({
            label: item.client,
            tokens: item.totalTokens,
            costUsd: item.costUsd
          }))}
        />
        <UsageRankList
          title={text.usageModels}
          empty={text.usageEmpty}
          locale={locale}
          items={models.map((item) => ({
            label: item.model,
            detail: item.provider,
            tokens: item.totalTokens,
            costUsd: item.costUsd
          }))}
        />
      </div>
    </Card>
  );
}

function UsageRankList({
  title,
  empty,
  items,
  locale
}: {
  title: string;
  empty: string;
  items: Array<{ label: string; detail?: string; tokens: number; costUsd: number }>;
  locale: Locale;
}) {
  const maxTokens = Math.max(1, ...items.map((item) => item.tokens));

  return (
    <section className="min-w-0 px-4 py-4 sm:px-5" aria-label={title}>
      <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-2 max-h-72 divide-y divide-border/70 overflow-auto">
          {items.map((item, index) => (
            <li
              key={`${item.label}-${item.detail ?? ""}`}
              className="relative grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden py-3"
            >
              <span
                className="absolute inset-y-1 left-0 rounded-r bg-primary/[0.045]"
                style={{ width: `${Math.max(1.5, item.tokens / maxTokens * 100)}%` }}
                aria-hidden
              />
              <span className="relative font-mono text-[10px] text-muted-foreground tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="relative min-w-0">
                <div className="truncate font-mono text-xs font-semibold text-foreground" title={item.label}>
                  {item.label}
                </div>
                {item.detail ? (
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.detail}</div>
                ) : null}
              </div>
              <div className="relative shrink-0 text-right text-xs tabular-nums">
                <div className="font-semibold text-foreground">{formatInteger(item.tokens, locale)}</div>
                <div className="text-[10px] text-muted-foreground">{formatUsd(item.costUsd)}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function InlineError({ message }: { message: string }) {
  return <div className="px-5 py-4 text-sm text-destructive">{message}</div>;
}

function EmptyPanel({ message }: { message: string }) {
  return <div className="px-5 py-10 text-center text-sm text-muted-foreground">{message}</div>;
}

type TrendResult = { trends: DashboardRunTrends; error?: string };
type UsageResult = { summary: DashboardUsageSummary; error?: string };
type DashboardMonthlyUsageSummary = DashboardUsageSummary & {
  month: string;
  activeDays: number;
  sessionCount: number;
  callCount: number;
};
type MonthlyUsageResult = { summary: DashboardMonthlyUsageSummary; error?: string };
type DailyUsageResult = {
  points: Array<{ date: string; totalTokens: number; messageCount: number }>;
};

async function getUsageSummary(locale: Locale): Promise<UsageResult> {
  const emptySummary: DashboardUsageSummary = {
    totalTokens: 0,
    costUsd: 0,
    clients: [],
    models: []
  };

  try {
    const response = await fetch(`${collectorUrl}/usage/summary`, { cache: "no-store" });

    if (!response.ok) {
      return {
        summary: emptySummary,
        error: locale === "zh"
          ? `用量汇总返回 ${response.status}`
          : `Usage summary returned ${response.status}`
      };
    }

    return { summary: (await response.json()) as DashboardUsageSummary };
  } catch (error) {
    return {
      summary: emptySummary,
      error: error instanceof Error ? error.message : copy[locale].runs.usageUnavailable
    };
  }
}

async function getMonthlyUsageSummary(
  locale: Locale,
  month: string
): Promise<MonthlyUsageResult> {
  const emptySummary: DashboardMonthlyUsageSummary = {
    month,
    totalTokens: 0,
    costUsd: 0,
    activeDays: 0,
    sessionCount: 0,
    callCount: 0,
    clients: [],
    models: []
  };

  try {
    const response = await fetch(
      `${collectorUrl}/usage/monthly?month=${encodeURIComponent(month)}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      return {
        summary: emptySummary,
        error: locale === "zh"
          ? `月度用量返回 ${response.status}`
          : `Monthly usage returned ${response.status}`
      };
    }

    return { summary: (await response.json()) as DashboardMonthlyUsageSummary };
  } catch (error) {
    return {
      summary: emptySummary,
      error: error instanceof Error ? error.message : copy[locale].runs.usageUnavailable
    };
  }
}

async function getDailyUsage(locale: Locale): Promise<DailyUsageResult> {
  try {
    const response = await fetch(`${collectorUrl}/usage/daily`, { cache: "no-store" });
    if (!response.ok) return { points: [] };
    return { points: await response.json() as DailyUsageResult["points"] };
  } catch {
    void locale;
    return { points: [] };
  }
}

async function getRunTrends(locale: Locale, days: 90 | 365): Promise<TrendResult> {
  const empty = { days, points: [] } satisfies DashboardRunTrends;

  try {
    const response = await fetch(`${collectorUrl}/analytics/runs/trends?days=${days}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        trends: empty,
        error: locale === "zh"
          ? `趋势分析返回 ${response.status}`
          : `Trend analysis returned ${response.status}`
      };
    }

    return { trends: (await response.json()) as DashboardRunTrends };
  } catch (error) {
    return {
      trends: empty,
      error: error instanceof Error ? error.message : copy[locale].tokenTrace.trendUnavailable
    };
  }
}

function tokenTraceHref(locale: Locale, view: TokenTraceView, month?: string) {
  const path = view === "overview"
    ? "/token-trace?view=overview"
    : `/token-trace?view=calendar&month=${encodeURIComponent(month ?? "")}`;

  return localizedHref(path, locale);
}

function heatClassName(level: number) {
  return [
    "bg-surface-raised",
    "bg-primary/[0.045]",
    "bg-primary/[0.085]",
    "bg-primary/[0.14]",
    "bg-primary/[0.22]"
  ][level];
}

function heatLegendClassName(level: number) {
  return [
    "bg-border",
    "bg-primary/20",
    "bg-primary/35",
    "bg-primary/55",
    "bg-primary/80"
  ][level];
}

function mergeActivityPoints(
  trendPoints: DashboardRunTrendPoint[],
  dailyPoints: DailyUsageResult["points"]
) {
  const dailyByDate = new Map(dailyPoints.map((point) => [point.date, point]));
  return trendPoints.map((point) => {
    const daily = dailyByDate.get(point.date);
    return daily
      ? { ...point, totalTokens: daily.totalTokens, runCount: daily.messageCount }
      : point;
  });
}

function activityHeatClassName(level: number) {
  return [
    "bg-border/55",
    "bg-sky-200/70 dark:bg-sky-950",
    "bg-sky-300/80 dark:bg-sky-800",
    "bg-sky-500/80 dark:bg-sky-600",
    "bg-sky-700 dark:bg-sky-400"
  ][level];
}

function buildModelUsageGradient(models: DashboardMonthlyUsageSummary["models"]) {
  const totalTokens = models.reduce((total, model) => total + model.totalTokens, 0);
  if (totalTokens <= 0) return "var(--border)";

  let offset = 0;
  const stops = models.flatMap((model, index) => {
    const start = offset;
    offset += totalTokens > 0 ? model.totalTokens / totalTokens * 100 : 0;
    const color = modelUsageColors[index % modelUsageColors.length] ?? "#5271ff";

    return [`${color} ${start}%`, `${color} ${offset}%`];
  });

  return `conic-gradient(${stops.join(", ")})`;
}

function formatTokenMillions(value: number, locale: Locale) {
  const millions = value / 1_000_000;

  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: millions < 10 && millions > 0 ? 1 : 0
  }).format(millions);
}

function formatInteger(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 0
  }).format(value);
}

function formatCompactNumber(value: number, locale: Locale) {
  if (locale === "zh") {
    if (value >= 100_000_000) {
      return `${formatCompactUnit(value / 100_000_000, value >= 1_000_000_000 ? 1 : 2)}亿`;
    }

    if (value >= 10_000) {
      const scaled = value / 10_000;
      return `${formatCompactUnit(scaled, scaled >= 1_000 ? 0 : 1)}万`;
    }

    return formatInteger(value, locale);
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatCompactUnit(value: number, maximumFractionDigits: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(value);
}

function formatUsd(value: number) {
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function formatMonthLabel(month: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    timeZone: "UTC"
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function formatTrendDate(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatAggregateLabel(key: string, period: "week" | "month", locale: Locale) {
  if (period === "month") {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "short",
      timeZone: "UTC"
    }).format(new Date(`${key}-01T00:00:00Z`));
  }

  const start = new Date(`${key}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const formatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC"
  });

  return `${formatter.format(start)}–${formatter.format(end)}`;
}
