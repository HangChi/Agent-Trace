"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Coins, RefreshCw, TrendingUp } from "lucide-react";
import type {
  DashboardRunTrendPoint,
  DashboardRunTrends,
  DashboardUsageSummary
} from "@agent-trace/schema";
import { useEffect, useMemo, useState } from "react";

import type { DashboardLocale, DashboardNavigate, DashboardRoute } from "./contracts";
import {
  aggregateTokenTracePoints,
  buildTokenTraceCalendar,
  getAvailableTokenTraceMonths,
  getTokenHeatLevel,
  parseTokenTracePeriod,
  parseTokenTraceView,
  resolveTokenTraceMonth,
  summarizeTokenTraceMonth,
  type TokenTraceAggregatePoint,
  type TokenTracePeriod
} from "./token-trace";

type TokenTraceClient = {
  get<T>(path: string): Promise<T>;
};

type TokenTraceViewProps = {
  client: TokenTraceClient;
  locale: DashboardLocale;
  navigate: DashboardNavigate;
  route: DashboardRoute;
};

type TokenTraceState = {
  loading: boolean;
  usage: DashboardUsageSummary;
  trends: DashboardRunTrends;
  usageError?: string;
  trendError?: string;
};

type DisplayTrendPoint = TokenTraceAggregatePoint & { label: string };

const emptyUsage: DashboardUsageSummary = { totalTokens: 0, costUsd: 0, clients: [], models: [] };
const emptyTrends: DashboardRunTrends = { days: 90, points: [] };

export function TokenTraceView({ client, locale, navigate, route }: TokenTraceViewProps) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<TokenTraceState>({
    loading: true,
    usage: emptyUsage,
    trends: emptyTrends
  });

  useEffect(() => {
    let active = true;
    setState((previous) => ({ ...previous, loading: true, usageError: undefined, trendError: undefined }));
    void Promise.allSettled([
      client.get<DashboardUsageSummary>("/usage/summary"),
      client.get<DashboardRunTrends>("/analytics/runs/trends?days=90")
    ]).then(([usageResult, trendResult]) => {
      if (!active) return;
      setState({
        loading: false,
        usage: usageResult.status === "fulfilled" ? usageResult.value : emptyUsage,
        trends: trendResult.status === "fulfilled" ? trendResult.value : emptyTrends,
        usageError: usageResult.status === "rejected" ? errorText(usageResult.reason) : undefined,
        trendError: trendResult.status === "rejected" ? errorText(trendResult.reason) : undefined
      });
    });
    return () => { active = false; };
  }, [client, version]);

  const view = parseTokenTraceView(route.query.get("view") ?? undefined);
  const period = parseTokenTracePeriod(route.query.get("period") ?? undefined);
  const points = useMemo(
    () => [...state.trends.points].sort((left, right) => left.date.localeCompare(right.date)),
    [state.trends.points]
  );

  return (
    <>
      <div className="at-page-head at-token-head">
        <div>
          <p className="at-eyebrow">TOKEN TRACE</p>
          <h1>{text(locale, "本地 Token 用量", "Local token usage")}</h1>
          <p>{text(locale, "按日、周、月观察客户端与模型的 Token 消耗和估算成本。", "Inspect daily, weekly, and monthly token usage and estimated cost.")}</p>
        </div>
        <div className="at-actions">
          <button className={`at-button ${view === "overview" ? "primary" : ""}`} type="button" onClick={() => navigate(overviewPath(period, locale))}>
            <TrendingUp size={15} />{text(locale, "总览", "Overview")}
          </button>
          <button className={`at-button ${view === "calendar" ? "primary" : ""}`} type="button" onClick={() => navigate(calendarPath(resolveTokenTraceMonth(route.query.get("month") ?? undefined, getAvailableTokenTraceMonths(points)), locale))}>
            <CalendarDays size={15} />{text(locale, "月历", "Calendar")}
          </button>
          <button className="at-button" type="button" disabled={state.loading} onClick={() => setVersion((value) => value + 1)}>
            <RefreshCw size={14} />{text(locale, "刷新", "Refresh")}
          </button>
        </div>
      </div>

      <div className="at-stats">
        <Stat label="Token" value={formatInteger(state.usage.totalTokens, locale)} />
        <Stat label={text(locale, "估算成本", "Estimated cost")} value={formatMoney(state.usage.costUsd)} />
        <Stat label={text(locale, "客户端", "Clients")} value={formatInteger(state.usage.clients.length, locale)} />
        <Stat label={text(locale, "模型", "Models")} value={formatInteger(state.usage.models.length, locale)} />
      </div>

      {state.loading ? <TokenState message={text(locale, "正在加载 Token 用量…", "Loading token usage…")} /> : null}
      {!state.loading && view === "overview" ? (
        <OverviewPanel
          locale={locale}
          navigate={navigate}
          period={period}
          points={points}
          error={state.trendError}
        />
      ) : null}
      {!state.loading && view === "calendar" ? (
        <CalendarPanel
          locale={locale}
          navigate={navigate}
          points={points}
          requestedMonth={route.query.get("month") ?? undefined}
          error={state.trendError}
        />
      ) : null}
      {!state.loading ? <UsageLedger locale={locale} usage={state.usage} error={state.usageError} /> : null}
    </>
  );
}

function OverviewPanel({
  locale,
  navigate,
  period,
  points,
  error
}: {
  locale: DashboardLocale;
  navigate: DashboardNavigate;
  period: TokenTracePeriod;
  points: DashboardRunTrendPoint[];
  error?: string;
}) {
  const displayPoints = toDisplayPoints(points, period, locale);
  const maxTokens = Math.max(1, ...displayPoints.map((point) => point.totalTokens));
  return (
    <section className="at-card">
      <div className="at-card-head">
        <div>
          <h2>{text(locale, "近 90 天趋势", "90-day trend")}</h2>
          <p>{text(locale, "柱高表示 Token，用悬停信息查看 Run、成本与成功率。", "Bar height represents Tokens; hover for runs, cost, and success rate.")}</p>
        </div>
        <div className="at-token-tabs" aria-label={text(locale, "趋势周期", "Trend period")}>
          {(["day", "week", "month"] as const).map((value) => (
            <button
              className={`at-button ${period === value ? "primary" : ""}`}
              key={value}
              type="button"
              onClick={() => navigate(overviewPath(value, locale))}
            >
              {periodLabel(value, locale)}
            </button>
          ))}
        </div>
      </div>
      {error ? <InlineError message={error} /> : null}
      {!error && displayPoints.length === 0 ? (
        <TokenState message={text(locale, "近 90 天暂无趋势数据。", "No trend data is available for the last 90 days.")} />
      ) : null}
      {!error && displayPoints.length > 0 ? (
        <div className="at-token-chart-wrap">
          <div className="at-bars at-token-bars">
            {displayPoints.map((point) => {
              const successRate = point.runCount ? Math.round(point.successfulRunCount / point.runCount * 100) : 0;
              return (
                <div
                  className="at-bar"
                  key={point.key}
                  title={`${point.key} · ${formatInteger(point.totalTokens, locale)} Token · ${point.runCount} Run · ${successRate}% · ${formatMoney(point.costUsd)}`}
                >
                  <span className="at-bar-value">{formatCompactNumber(point.totalTokens, locale)}</span>
                  <div style={{ height: `${Math.max(4, point.totalTokens / maxTokens * 152)}px` }} />
                  <small>{point.label}</small>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CalendarPanel({
  locale,
  navigate,
  points,
  requestedMonth,
  error
}: {
  locale: DashboardLocale;
  navigate: DashboardNavigate;
  points: DashboardRunTrendPoint[];
  requestedMonth?: string;
  error?: string;
}) {
  const months = getAvailableTokenTraceMonths(points);
  const month = resolveTokenTraceMonth(requestedMonth, months);
  const monthIndex = months.indexOf(month);
  const previousMonth = monthIndex > 0 ? months[monthIndex - 1] : undefined;
  const nextMonth = monthIndex >= 0 && monthIndex < months.length - 1 ? months[monthIndex + 1] : undefined;
  const latestMonth = months.at(-1);
  const cells = buildTokenTraceCalendar(month, points);
  const summary = summarizeTokenTraceMonth(month, points);
  const maxTokens = Math.max(1, ...cells.filter((cell) => cell.inMonth).map((cell) => cell.point?.totalTokens ?? 0));
  const weekdays = locale === "zh" ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <section className="at-card">
      <div className="at-card-head at-calendar-head">
        <div>
          <h2>{formatMonth(month, locale)}</h2>
          <p>{formatInteger(summary.totalTokens, locale)} Token · {summary.runCount} Run · {summary.successRate}% · {formatMoney(summary.costUsd)}</p>
        </div>
        <div className="at-actions">
          <MonthButton label={text(locale, "上个月", "Previous month")} disabled={!previousMonth} onClick={() => previousMonth && navigate(calendarPath(previousMonth, locale))}><ChevronLeft size={15} /></MonthButton>
          <MonthButton label={text(locale, "最新月", "Latest month")} disabled={!latestMonth || month === latestMonth} onClick={() => latestMonth && navigate(calendarPath(latestMonth, locale))}>{text(locale, "最新月", "Latest")}</MonthButton>
          <MonthButton label={text(locale, "下个月", "Next month")} disabled={!nextMonth} onClick={() => nextMonth && navigate(calendarPath(nextMonth, locale))}><ChevronRight size={15} /></MonthButton>
        </div>
      </div>
      {error ? <InlineError message={error} /> : null}
      {!error && months.length === 0 ? <TokenState message={text(locale, "暂无可显示的月历数据。", "No calendar data is available.")} /> : null}
      {!error && months.length > 0 ? (
        <div className="at-token-calendar-wrap">
          <div className="at-token-calendar">
            {weekdays.map((weekday) => <div className="at-calendar-weekday" key={weekday}>{weekday}</div>)}
            {cells.map((cell) => {
              const point = cell.point;
              const active = cell.inMonth && Boolean(point && (point.totalTokens || point.runCount || point.costUsd));
              const successRate = point?.runCount ? Math.round(point.successfulRunCount / point.runCount * 100) : 0;
              const heatLevel = point ? getTokenHeatLevel(point.totalTokens, maxTokens) : 0;
              return (
                <div className={`at-calendar-cell ${cell.inMonth ? `heat-${heatLevel}` : "outside"}`} key={cell.date} title={cell.inMonth ? cell.date : undefined}>
                  <div className="at-calendar-date">
                    <time dateTime={cell.date}>{cell.day}</time>
                    {point?.failedRunCount ? <span>{point.failedRunCount} {text(locale, "失败", "failed")}</span> : null}
                  </div>
                  {active && point ? (
                    <div className="at-calendar-metrics">
                      <strong className="at-mono">{formatCompactNumber(point.totalTokens, locale)}</strong>
                      <span>{point.runCount} Run · {successRate}%</span>
                      <span className="at-mono">{formatMoney(point.costUsd)}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function UsageLedger({ locale, usage, error }: { locale: DashboardLocale; usage: DashboardUsageSummary; error?: string }) {
  const clients = [...usage.clients].sort((left, right) => right.totalTokens - left.totalTokens);
  const models = [...usage.models].sort((left, right) => right.totalTokens - left.totalTokens);
  return (
    <section className="at-card">
      <div className="at-card-head">
        <div>
          <h2><Coins size={16} />{text(locale, "用量排行", "Usage rankings")}</h2>
          <p>{text(locale, "按 Token 从高到低排列；成本为估算值。", "Sorted by Tokens; costs are estimates.")}</p>
        </div>
      </div>
      {error ? <InlineError message={error} /> : null}
      <div className="at-grid-2 at-usage-grid">
        <UsageRank title={text(locale, "客户端", "Clients")} locale={locale} items={clients.map((item) => ({ label: item.client, tokens: item.totalTokens, costUsd: item.costUsd }))} />
        <UsageRank title={text(locale, "模型", "Models")} locale={locale} items={models.map((item) => ({ label: item.model, detail: item.provider, tokens: item.totalTokens, costUsd: item.costUsd }))} />
      </div>
    </section>
  );
}

function UsageRank({ title, locale, items }: {
  title: string;
  locale: DashboardLocale;
  items: Array<{ label: string; detail?: string; tokens: number; costUsd: number }>;
}) {
  const maxTokens = Math.max(1, ...items.map((item) => item.tokens));
  return (
    <section className="at-usage-rank" aria-label={title}>
      <h3>{title}</h3>
      {items.length === 0 ? <p className="at-token-empty">{text(locale, "暂无用量数据。", "No usage data.")}</p> : (
        <ol>
          {items.map((item, index) => (
            <li key={`${item.label}-${item.detail ?? ""}`}>
              <span className="at-rank-fill" style={{ width: `${Math.max(1.5, item.tokens / maxTokens * 100)}%` }} />
              <span className="at-rank-index at-mono">{String(index + 1).padStart(2, "0")}</span>
              <div className="at-rank-name"><strong title={item.label}>{item.label}</strong>{item.detail ? <span>{item.detail}</span> : null}</div>
              <div className="at-rank-value"><strong className="at-mono">{formatInteger(item.tokens, locale)}</strong><span className="at-mono">{formatMoney(item.costUsd)}</span></div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function MonthButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button aria-label={label} className="at-button" disabled={disabled} type="button" onClick={onClick}>{children}</button>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="at-stat"><span>{label}</span><strong className="at-mono">{value}</strong></div>;
}

function InlineError({ message }: { message: string }) {
  return <div className="at-token-error">{message}</div>;
}

function TokenState({ message }: { message: string }) {
  return <div className="at-token-empty">{message}</div>;
}

function toDisplayPoints(points: DashboardRunTrendPoint[], period: TokenTracePeriod, locale: DashboardLocale): DisplayTrendPoint[] {
  if (period === "day") {
    return points.slice(-31).map((point) => ({ ...point, key: point.date, label: formatDay(point.date, locale) }));
  }
  const aggregated = aggregateTokenTracePoints(points, period);
  return aggregated.slice(period === "week" ? -13 : 0).map((point) => ({
    ...point,
    label: period === "week" ? formatWeek(point.key, locale) : formatMonth(point.key, locale, true)
  }));
}

function overviewPath(period: TokenTracePeriod, locale: DashboardLocale) {
  const path = `/token-trace?view=overview&period=${period}`;
  return locale === "en" ? `${path}&lang=en` : path;
}

function calendarPath(month: string, locale: DashboardLocale) {
  const path = `/token-trace?view=calendar&month=${encodeURIComponent(month)}`;
  return locale === "en" ? `${path}&lang=en` : path;
}

function periodLabel(period: TokenTracePeriod, locale: DashboardLocale) {
  const labels = locale === "zh" ? { day: "日", week: "周", month: "月" } : { day: "Day", week: "Week", month: "Month" };
  return labels[period];
}

function text(locale: DashboardLocale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatInteger(value: number, locale: DashboardLocale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCompactNumber(value: number, locale: DashboardLocale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatMoney(value: number) {
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function formatDay(value: string, locale: DashboardLocale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function formatWeek(value: string, locale: DashboardLocale) {
  const start = new Date(`${value}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${formatDay(value, locale)}–${formatDay(end.toISOString().slice(0, 10), locale)}`;
}

function formatMonth(value: string, locale: DashboardLocale, short = false) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: short ? "short" : "long", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`));
}
