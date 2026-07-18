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
  const [trendResult, usageResult] = await Promise.all([
    getRunTrends(locale),
    getUsageSummary(locale)
  ]);
  const availableMonths = getAvailableTokenTraceMonths(trendResult.trends.points);
  const selectedMonth = resolveTokenTraceMonth(params.month, availableMonths);
  const currentPath = tokenTraceHref(locale, view, selectedMonth);
  const text = copy[locale].tokenTrace;

  return (
    <main id="main-content" className="min-h-dvh bg-background text-foreground">
      <AutoRefresh collectorUrl={collectorUrl} />
      <ConsoleHeader locale={locale} path={currentPath} />

      <section className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6 2xl:px-10">
        <div className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_5px_14px_color-mix(in_srgb,var(--primary)_22%,transparent)]">
                <Coins className="size-3.5" aria-hidden />
              </span>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                {text.eyebrow}
              </p>
            </div>
            <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-4">
              <h1 className="shrink-0 text-[28px] font-semibold leading-none tracking-[-0.03em] text-foreground">
                {text.title}
              </h1>
              <p className="max-w-3xl text-sm leading-5 text-muted-foreground">
                {text.subtitle}
              </p>
            </div>
          </div>

          <nav
            className="grid shrink-0 grid-cols-2 rounded-lg border border-border bg-surface-muted p-1"
            aria-label={locale === "zh" ? "Token-Trace 视图" : "Token-Trace views"}
          >
            <ViewLink
              active={view === "overview"}
              href={tokenTraceHref(locale, "overview")}
              icon={TrendingUp}
              label={text.overview}
            />
            <ViewLink
              active={view === "calendar"}
              href={tokenTraceHref(locale, "calendar", selectedMonth)}
              icon={CalendarDays}
              label={text.calendar}
            />
          </nav>
        </div>

        {view === "overview" ? (
          <TokenTraceOverview
            trendResult={trendResult}
            usageResult={usageResult}
            locale={locale}
          />
        ) : (
          <TokenTraceCalendar
            result={trendResult}
            month={selectedMonth}
            availableMonths={availableMonths}
            locale={locale}
          />
        )}
      </section>
    </main>
  );
}

function ViewLink({
  active,
  href,
  icon: Icon,
  label
}: {
  active: boolean;
  href: ReturnType<typeof localizedHref>;
  icon: typeof TrendingUp;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-surface-raised text-primary shadow-[var(--shadow-control)]"
          : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </Link>
  );
}

function TokenTraceOverview({
  trendResult,
  usageResult,
  locale
}: {
  trendResult: TrendResult;
  usageResult: UsageResult;
  locale: Locale;
}) {
  const text = copy[locale].tokenTrace;

  return (
    <div className="mt-5 space-y-4">
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

      <TokenUsageStatistics result={trendResult} locale={locale} />
      <UsageLedger
        summary={usageResult.summary}
        error={usageResult.error}
        locale={locale}
      />
    </div>
  );
}

function TokenUsageStatistics({ result, locale }: { result: TrendResult; locale: Locale }) {
  const text = copy[locale].tokenTrace;
  const points = result.trends.points;
  const weeklyPoints = aggregateTokenTracePoints(points, "week");
  const monthlyPoints = aggregateTokenTracePoints(points, "month");
  const maxTokens = Math.max(1, ...points.map((point) => point.totalTokens));
  const hasData = points.some((point) => point.runCount > 0 || point.totalTokens > 0);
  const totalTokens = points.reduce((total, point) => total + point.totalTokens, 0);
  const activeDays = points.filter((point) => point.totalTokens > 0).length;
  const peakPoint = points.reduce<DashboardRunTrendPoint | undefined>(
    (peak, point) => !peak || point.totalTokens > peak.totalTokens ? point : peak,
    undefined
  );
  const chartPoints = points.map((point, index) => {
    const x = points.length > 1 ? 20 + index * (1080 / (points.length - 1)) : 560;
    const y = 16 + (1 - point.totalTokens / maxTokens) * 126;

    return { ...point, x, y };
  });
  const labelPoints = points.filter((_, index) => index % 14 === 0 || index === points.length - 1);
  const linePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = chartPoints.length > 0
    ? `M ${chartPoints[0]?.x} 148 ${chartPoints.map((point) => `L ${point.x} ${point.y}`).join(" ")} L ${chartPoints.at(-1)?.x} 148 Z`
    : "";

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden py-0">
        <SectionHeader
          icon={TrendingUp}
          title={text.recentTrend}
          help={text.recentTrendHelp}
          aside={text.utcWindow}
        />

        {result.error ? (
          <InlineError message={result.error} />
        ) : !hasData ? (
          <EmptyPanel message={text.noTrendData} />
        ) : (
          <div className="grid lg:grid-cols-[230px_minmax(0,1fr)]">
            <aside className="border-b border-border/70 bg-surface-muted/35 px-5 py-5 lg:border-b-0 lg:border-r">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {text.totalTokens}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground tabular-nums">
                {formatCompactNumber(totalTokens, locale)}
              </p>
              <div className="mt-5 space-y-3 border-t border-border/70 pt-4 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{text.activeDays}</span>
                  <span className="font-semibold tabular-nums">{activeDays} / {points.length}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{text.dailyAverage}</span>
                  <span className="font-semibold tabular-nums">
                    {formatCompactNumber(totalTokens / Math.max(1, points.length), locale)}
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
              <div className="min-w-[900px]">
                <svg
                  viewBox="0 0 1120 154"
                  className="h-44 w-full"
                  role="img"
                  aria-label={text.recentTrend}
                  preserveAspectRatio="none"
                >
                <defs>
                  <linearGradient id="token-trace-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.015" />
                  </linearGradient>
                  <linearGradient id="token-trace-line" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--primary)" />
                    <stop offset="100%" stopColor="var(--trace)" />
                  </linearGradient>
                </defs>
                {[22, 64, 106, 148].map((y) => (
                  <line
                    key={y}
                    x1="20"
                    x2="1100"
                    y1={y}
                    y2={y}
                    stroke="var(--border)"
                    strokeDasharray="3 6"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                <path d={areaPath} fill="url(#token-trace-area)" />
                <polyline
                  points={linePoints}
                  fill="none"
                  stroke="url(#token-trace-line)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {chartPoints.filter((_, index) => index % 7 === 0 || index === chartPoints.length - 1).map((point) => (
                  <circle
                    key={point.date}
                    cx={point.x}
                    cy={point.y}
                    r="3.5"
                    fill="var(--surface-raised)"
                    stroke="var(--primary)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{`${point.date} · ${formatInteger(point.totalTokens, locale)} ${text.tokens}`}</title>
                  </circle>
                ))}
                </svg>
                <ol
                  className="grid border-t border-border/70 pt-2"
                  style={{ gridTemplateColumns: `repeat(${labelPoints.length}, minmax(0, 1fr))` }}
                >
                {labelPoints.map((point) => (
                  <li key={point.date} className="min-w-0 text-center">
                    <div className="truncate text-[10px] text-muted-foreground tabular-nums">
                      {formatTrendDate(point.date, locale)}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] font-semibold text-foreground tabular-nums">
                      {formatCompactNumber(point.totalTokens, locale)}
                    </div>
                  </li>
                ))}
                </ol>
              </div>
            </div>
          </div>
        )}
      </Card>

      {!result.error && hasData ? (
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
  const totalTokens = points.reduce((total, point) => total + point.totalTokens, 0);
  const text = copy[locale].tokenTrace;

  return (
    <Card className="overflow-hidden py-0">
      <SectionHeader
        icon={CalendarDays}
        title={title}
        help={help}
        aside={formatCompactNumber(totalTokens, locale)}
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
              <div className="mb-2 truncate text-center text-[10px] font-semibold text-foreground tabular-nums">
                {formatCompactNumber(point.totalTokens, locale)}
              </div>
              <div className="flex h-36 items-end overflow-hidden rounded-md bg-chart-3/[0.055]">
                <div
                  className="w-full rounded-t-[3px] bg-chart-3/70 transition-colors hover:bg-chart-3/85"
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

function TokenTraceCalendar({
  result,
  month,
  availableMonths,
  locale
}: {
  result: TrendResult;
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

  return (
    <div className="mt-5 space-y-4">
      <TelemetryStrip
        items={[
          {
            label: text.totalTokens,
            value: formatInteger(summary.totalTokens, locale),
            icon: Coins,
            tone: "trace"
          },
          {
            label: text.estimatedCost,
            value: formatUsd(summary.costUsd),
            icon: CircleDollarSign
          },
          {
            label: text.runs,
            value: formatInteger(summary.runCount, locale),
            icon: TrendingUp
          },
          {
            label: text.successRate,
            value: `${summary.successRate}%`,
            icon: CalendarDays
          }
        ]}
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

async function getRunTrends(locale: Locale): Promise<TrendResult> {
  const empty = { days: 90, points: [] } satisfies DashboardRunTrends;

  try {
    const response = await fetch(`${collectorUrl}/analytics/runs/trends?days=90`, {
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
