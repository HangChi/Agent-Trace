import Link from "next/link";
import type {
  DashboardEventPage,
  DashboardEventVisibility,
  DashboardTraceInsight,
  DashboardTraceEvent
} from "@agent-trace/schema";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Filter,
  FileJson,
  Hash,
  Search,
  Zap
} from "lucide-react";

import {
  EmptyState,
  ErrorState,
  LanguageSwitcher,
  SourceBadge,
  StatusBadge,
  ThemeToggle
} from "~/components";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  copy,
  formatAgent,
  formatClockTime,
  formatEventType,
  formatRedaction,
  formatStatus,
  formatSurface,
  formatTraceInsightEvidence,
  formatTraceInsightTitle,
  localizedHref,
  parseLocale,
  type Locale
} from "~/lib/i18n";
import { cn } from "~/lib/utils";
import { AutoRefresh } from "../run-controls";
import { inspectFailures } from "./failure-inspector";
import { buildTraceForest, type TraceTreeNode } from "./trace-tree";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;

type DetailSearchParams = Promise<{
  lang?: SearchParamValue;
  q?: SearchParamValue;
  status?: SearchParamValue;
  type?: SearchParamValue;
  category?: SearchParamValue;
  show?: SearchParamValue;
  visibility?: SearchParamValue;
  page?: SearchParamValue;
  view?: SearchParamValue;
}>;

type EventFilters = {
  q: string;
  status: string;
  type: string;
  category: string;
};

type DetailView = "timeline" | "tree";

const collectorUrl = process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export default async function RunDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: DetailSearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  const locale = parseLocale(query.lang);
  const text = copy[locale];
  const filters = parseEventFilters(query);
  const visibility = parseVisibility(query);
  const page = parsePage(query.page);
  const view = parseDetailView(query.view);
  const { result, error } = await getEventPage(id, locale, filters, visibility, page);
  const events = result?.events ?? [];
  const counts = result?.counts ?? { total: 0, display: 0, hidden: 0, matching: 0 };
  const facets = result?.facets ?? { types: [], categories: [] };
  const pagination = result?.pagination ?? { page: 1, pageSize: 100, total: 0, totalPages: 1 };
  const summary = result?.summary ?? {
    totalTokens: 0,
    totalDurationMs: 0,
    failedEvents: 0,
    sourceMetadata: {},
    errorEvents: [],
    insights: []
  };
  const totalTokens = summary.totalTokens;
  const totalDurationMs = summary.totalDurationMs;
  const failedEvents = summary.failedEvents;
  const failureInsights = inspectFailures(summary.errorEvents);
  const traceInsights = summary.insights ?? [];
  const sourceMetadata = summary.sourceMetadata;

  return (
    <main id="main-content" className="min-h-screen bg-background text-foreground">
      <AutoRefresh />
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="w-full px-4 py-3 sm:px-6 lg:px-8 2xl:px-10">
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" className="-ml-2" asChild>
              <Link href={localizedHref("/runs", locale)}>
                <ArrowLeft className="h-4 w-4" />
                {text.detail.back}
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <LanguageSwitcher
                locale={locale}
                path={detailPath(id, filters, visibility, pagination.page, view)}
              />
              <ThemeToggle locale={locale} />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-primary">Trace Detail</p>
              <h1 className="mt-1 break-all font-mono text-base font-semibold leading-7 text-foreground sm:text-lg">
                {id}
              </h1>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <MiniStat icon={Hash} label={text.detail.steps} value={pagination.total} />
              <MiniStat icon={Zap} label={text.common.tokens} value={totalTokens.toLocaleString()} />
              <MiniStat icon={AlertTriangle} label={text.detail.errors} value={failedEvents} accent="danger" />
            </div>
          </div>
        </div>
      </header>

      <section className="grid w-full gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8 2xl:px-10">
        <Card className="overflow-hidden py-0">
          <div className="border-b border-border/80 bg-surface-raised px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {view === "tree" ? text.detail.tree : text.detail.timeline}
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {view === "tree" ? text.detail.treeHelp : text.detail.timelineHelp}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <div className="inline-flex rounded-md border border-border/80 bg-surface-muted p-0.5">
                  <Button variant={view === "timeline" ? "secondary" : "ghost"} size="xs" asChild>
                    <Link
                      href={detailHref(id, locale, filters, visibility, pagination.page, "timeline")}
                      aria-current={view === "timeline" ? "page" : undefined}
                    >
                      {text.detail.timelineView}
                    </Link>
                  </Button>
                  <Button variant={view === "tree" ? "secondary" : "ghost"} size="xs" asChild>
                    <Link
                      href={detailHref(id, locale, filters, visibility, pagination.page, "tree")}
                      aria-current={view === "tree" ? "page" : undefined}
                    >
                      {text.detail.treeView}
                    </Link>
                  </Button>
                </div>
                <span className="inline-flex w-fit items-center rounded-md border border-border/80 bg-surface-muted px-2 py-1 text-xs text-muted-foreground">
                  {formatFilterCount(events.length, pagination.total, locale)}
                </span>
                {counts.hidden > 0 ? (
                  <Link
                    href={detailHref(
                      id,
                      locale,
                      filters,
                      visibility === "hidden" ? "display" : "hidden",
                      1,
                      view
                    )}
                    className="inline-flex w-fit items-center rounded-md border border-border/80 bg-surface-muted px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent hover:text-foreground"
                    title={
                      visibility === "hidden"
                        ? text.detail.hideOtherEvents
                        : `${text.detail.showHiddenEvents}: ${counts.hidden}`
                    }
                  >
                    {visibility === "hidden"
                      ? text.detail.hideOtherEvents
                      : `${text.detail.showHiddenEvents}: ${counts.hidden}`}
                  </Link>
                ) : null}
              </div>
            </div>
            <FilterBar
              runId={id}
              locale={locale}
              filters={filters}
              facets={facets}
              resultCount={pagination.total}
              visibility={visibility}
              view={view}
            />
          </div>
          {error ? <ErrorState message={error} locale={locale} /> : null}
          {!error && pagination.total === 0 && counts.total === 0 ? (
            <EmptyState locale={locale} title={text.detail.emptyTitle} body={text.detail.emptyBody} />
          ) : null}
          {!error && counts.total > 0 && events.length === 0 ? (
            <EmptyState
              locale={locale}
              title={text.detail.emptyFilterTitle}
              body={text.detail.emptyFilterBody}
            />
          ) : null}
          {!error && events.length > 0 ? (
            view === "tree" ? (
              <TraceTree events={events} locale={locale} />
            ) : (
              <Timeline events={events} locale={locale} />
            )
          ) : null}
          {!error && pagination.totalPages > 1 ? (
            <PaginationControls
              runId={id}
              locale={locale}
              filters={filters}
              visibility={visibility}
              view={view}
              pagination={pagination}
            />
          ) : null}
        </Card>

        <aside className="flex flex-col gap-4">
          <Card className="py-0">
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold text-foreground">{text.detail.summary}</h2>
              <dl className="mt-4 divide-y divide-border/80 text-sm">
                <SummaryRow label={text.common.collector} value={collectorUrl} />
                <SummaryRow label="Agent" value={formatAgent(sourceMetadata.agent ?? "manual", locale)} />
                <SummaryRow label={text.detail.surface} value={formatSurface(sourceMetadata.surface, locale) ?? "-"} />
                <SummaryRow label={text.detail.session} value={sourceMetadata.sessionId ?? "-"} />
                <SummaryRow label={text.detail.redaction} value={formatRedaction(sourceMetadata.redactionLevel, locale) ?? "-"} />
                <SummaryRow label={text.detail.totalDuration} value={formatDuration(totalDurationMs)} />
                <SummaryRow label={text.detail.failedSteps} value={failedEvents.toString()} />
                <SummaryRow label={text.detail.tokenUsage} value={totalTokens.toLocaleString()} />
              </dl>
            </CardContent>
          </Card>

          {traceInsights.length > 0 ? (
            <Card className="py-0">
              <CardContent className="p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  {text.detail.automaticDiagnostics}
                </h2>
                <div className="mt-3 space-y-3">
                  {traceInsights.map((insight) => (
                    <TraceInsight key={`${insight.kind}-${insight.eventIds.join("-")}`} insight={insight} locale={locale} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="py-0">
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold text-foreground">{text.detail.failureInspector}</h2>
              {failureInsights.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {failureInsights.map((insight, index) => (
                    <div
                      key={`${insight.eventName}-${insight.title}-${index}`}
                      className="rounded-lg border border-status-error-border bg-status-error-subtle px-3 py-3 shadow-xs"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-status-error" />
                        <div className="text-sm font-semibold text-status-error">
                          {formatFailureTitle(insight.title, locale)}
                        </div>
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {insight.eventName} / {insight.eventType}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-foreground">
                        {formatFailureReason(insight.reason, locale)}
                      </p>
                      <p className="mt-1 text-sm font-medium text-primary">
                        {formatFailureSuggestion(insight.suggestion, locale)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-status-success-border bg-status-success-subtle px-3 py-3 text-sm text-status-success shadow-xs">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{text.detail.noFailures}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </section>
      <Button asChild size="icon" className="fixed right-5 bottom-5 z-50 rounded-full shadow-lg">
        <a href="#main-content" aria-label={text.detail.backToTop} title={text.detail.backToTop}>
          <ArrowUp className="h-4 w-4" aria-hidden />
        </a>
      </Button>
    </main>
  );
}

async function getEventPage(
  runId: string,
  locale: Locale,
  filters: EventFilters,
  visibility: DashboardEventVisibility,
  page: number
): Promise<{ result?: DashboardEventPage; error?: string }> {
  try {
    const params = new URLSearchParams({
      visibility,
      page: page.toString(),
      pageSize: "100"
    });

    if (filters.q) {
      params.set("q", filters.q);
    }

    for (const key of ["status", "type", "category"] as const) {
      if (filters[key] !== "all") {
        params.set(key, filters[key]);
      }
    }

    const response = await fetch(`${collectorUrl}/runs/${runId}/events?${params.toString()}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        error:
          locale === "zh"
            ? `Collector 返回 ${response.status}`
            : `Collector returned ${response.status}`
      };
    }

    return { result: (await response.json()) as DashboardEventPage };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : locale === "zh"
            ? "Collector 无法访问"
            : "Collector is unreachable"
    };
  }
}

function MiniStat({
  icon: Icon,
  label,
  value,
  accent
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  accent?: "danger";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border border-border/80 bg-surface-raised px-3 py-2 shadow-xs",
        accent === "danger" && "border-status-error-border bg-status-error-subtle"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0 text-muted-foreground", accent === "danger" && "text-status-error")} />
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className={cn("truncate text-sm font-semibold tabular-nums", accent === "danger" && "text-status-error")}>
          {value}
        </div>
      </div>
    </div>
  );
}

function FilterBar({
  runId,
  locale,
  filters,
  facets,
  resultCount,
  visibility,
  view
}: {
  runId: string;
  locale: Locale;
  filters: EventFilters;
  facets: DashboardEventPage["facets"];
  resultCount: number;
  visibility: DashboardEventVisibility;
  view: DetailView;
}) {
  const text = copy[locale];
  const typeOptions = facets.types;
  const categoryOptions = facets.categories;
  const hasActiveFilters = filters.q || filters.status !== "all" || filters.type !== "all" || filters.category !== "all";

  return (
    <form
      action={localizedHref(`/runs/${runId}`, locale)}
      className="mt-4 grid gap-3 rounded-lg border border-border/80 bg-surface-muted p-3 md:grid-cols-2 2xl:grid-cols-[minmax(220px,1fr)_150px_170px_150px_auto_auto]"
    >
      {locale === "en" ? <input type="hidden" name="lang" value="en" /> : null}
      {visibility !== "display" ? <input type="hidden" name="visibility" value={visibility} /> : null}
      {view !== "timeline" ? <input type="hidden" name="view" value={view} /> : null}
      <label className="min-w-0 text-xs font-medium text-muted-foreground md:col-span-2 2xl:col-span-1">
        {text.detail.filterSearch}
        <span className="mt-1 flex h-9 items-center gap-2 rounded-md border border-input bg-surface-raised px-3 text-foreground shadow-xs">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            name="q"
            defaultValue={filters.q}
            placeholder={text.detail.filterSearchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </span>
      </label>
      <FilterSelect
        label={text.detail.filterStatus}
        name="status"
        value={filters.status}
        options={["all", "running", "success", "error"].map((value) => ({
          value,
          label: value === "all" ? text.detail.filterAll : formatStatus(value, locale)
        }))}
      />
      <FilterSelect
        label={text.detail.filterType}
        name="type"
        value={filters.type}
        options={[
          { value: "all", label: text.detail.filterAll },
          ...typeOptions.map((value) => ({ value, label: formatEventType(value, locale) }))
        ]}
      />
      <FilterSelect
        label={text.detail.filterCategory}
        name="category"
        value={filters.category}
        options={[
          { value: "all", label: text.detail.filterAll },
          ...categoryOptions.map((value) => ({ value, label: formatCategory(value, locale) }))
        ]}
      />
      <div className="flex items-end">
        <Button type="submit" size="sm" className="w-full">
          <Filter className="h-4 w-4" aria-hidden />
          {text.detail.applyFilters}
        </Button>
      </div>
      <div className="flex items-end">
        {hasActiveFilters ? (
          <Button type="button" variant="ghost" size="sm" className="w-full" asChild>
            <Link href={detailHref(runId, locale, emptyEventFilters, visibility, 1, view)}>
              {text.detail.clearFilters}
            </Link>
          </Button>
        ) : (
          <span className="flex h-8 items-center text-xs text-muted-foreground tabular-nums">
            {resultCount.toLocaleString()}
          </span>
        )}
      </div>
    </form>
  );
}

function FilterSelect({
  label,
  name,
  value,
  options
}: {
  label: string;
  name: keyof EventFilters;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="min-w-0 text-xs font-medium text-muted-foreground">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="mt-1 h-9 w-full rounded-md border border-input bg-surface-raised px-3 text-sm text-foreground shadow-xs outline-none transition-colors focus:border-ring focus:ring-[3px] focus:ring-ring/25"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PaginationControls({
  runId,
  locale,
  filters,
  visibility,
  view,
  pagination
}: {
  runId: string;
  locale: Locale;
  filters: EventFilters;
  visibility: DashboardEventVisibility;
  view: DetailView;
  pagination: DashboardEventPage["pagination"];
}) {
  const text = copy[locale];
  const previousPage = Math.max(1, pagination.page - 1);
  const nextPage = Math.min(pagination.totalPages, pagination.page + 1);

  return (
    <div className="flex flex-col gap-3 border-t border-border/80 bg-surface-raised px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="text-xs text-muted-foreground tabular-nums">
        {pagination.page.toLocaleString()} / {pagination.totalPages.toLocaleString()}
      </div>
      <div className="flex items-center gap-2">
        {pagination.page > 1 ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={detailHref(runId, locale, filters, visibility, previousPage, view)}>
              {text.detail.previousPage}
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {text.detail.previousPage}
          </Button>
        )}
        {pagination.page < pagination.totalPages ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={detailHref(runId, locale, filters, visibility, nextPage, view)}>
              {text.detail.nextPage}
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {text.detail.nextPage}
          </Button>
        )}
      </div>
    </div>
  );
}

function Timeline({ events, locale }: { events: DashboardTraceEvent[]; locale: Locale }) {
  return (
    <ol className="divide-y divide-border/70">
      {events.map((event) => (
        <li
          key={event.id}
          className="grid gap-4 px-4 py-4 transition-colors hover:bg-accent/25 sm:px-5 md:grid-cols-[138px_minmax(0,1fr)]"
        >
          <div className="text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-surface-muted px-2 py-1 font-mono font-medium text-foreground shadow-xs">
              <Clock3 className="h-3 w-3 text-muted-foreground" aria-hidden />
              {formatClockTime(event.timestamp, locale)}
            </div>
          </div>

          <article className="relative min-w-0 border-l border-border/80 pl-5">
            <span
              className={cn(
                "absolute -left-[6px] top-1 h-3 w-3 rounded-full border-2 border-card ring-2",
                dotClass(event.status)
              )}
            />
            <EventDetails event={event} locale={locale} />
          </article>
        </li>
      ))}
    </ol>
  );
}

function TraceInsight({ insight, locale }: { insight: DashboardTraceInsight; locale: Locale }) {
  const text = copy[locale];
  const Icon = insight.severity === "info" ? Zap : AlertTriangle;

  return (
    <div className={cn("rounded-lg border px-3 py-3 shadow-xs", traceInsightContainerClass(insight.severity))}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", traceInsightTextClass(insight.severity))} />
        <div className={cn("min-w-0 flex-1 text-sm font-semibold", traceInsightTextClass(insight.severity))}>
          {formatTraceInsightTitle(insight.kind, locale)}
        </div>
        <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", traceInsightBadgeClass(insight.severity))}>
          {text.detail.insightSeverities[insight.severity]}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-foreground">
        {formatTraceInsightEvidence(insight, locale)}
      </p>
    </div>
  );
}

function traceInsightContainerClass(severity: DashboardTraceInsight["severity"]) {
  if (severity === "error") return "border-status-error-border bg-status-error-subtle";
  if (severity === "warning") return "border-status-warning-border bg-status-warning-subtle";
  return "border-border/80 bg-surface-muted";
}

function traceInsightTextClass(severity: DashboardTraceInsight["severity"]) {
  if (severity === "error") return "text-status-error";
  if (severity === "warning") return "text-status-warning";
  return "text-primary";
}

function traceInsightBadgeClass(severity: DashboardTraceInsight["severity"]) {
  if (severity === "error") return "border-status-error-border text-status-error";
  if (severity === "warning") return "border-status-warning-border text-status-warning";
  return "border-border text-primary";
}

function TraceTree({ events, locale }: { events: DashboardTraceEvent[]; locale: Locale }) {
  return (
    <ol className="space-y-2 px-4 py-4 sm:px-5">
      {buildTraceForest(events).map((node) => (
        <TraceTreeItem key={node.event.id} node={node} locale={locale} />
      ))}
    </ol>
  );
}

function TraceTreeItem({ node, locale }: { node: TraceTreeNode; locale: Locale }) {
  const event = node.event;

  return (
    <li>
      <details className="rounded-lg border border-border/80 bg-surface-raised shadow-xs">
        <summary className="cursor-pointer px-3 py-3 transition-colors hover:bg-accent/25 sm:px-4">
          <span className="ml-2 inline-flex max-w-[calc(100%-0.5rem)] flex-wrap items-center gap-2 align-middle">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-muted-foreground">
              <Clock3 className="h-3 w-3" aria-hidden />
              {formatClockTime(event.timestamp, locale)}
            </span>
            <EventSummary event={event} locale={locale} />
          </span>
        </summary>
        <div className="border-t border-border/70 px-4 py-4 sm:px-5">
          <EventDetails event={event} locale={locale} showSummary={false} />
          {node.children.length > 0 ? (
            <ol className="mt-4 space-y-2 border-l border-border/80 pl-3 sm:pl-4">
              {node.children.map((child) => (
                <TraceTreeItem key={child.event.id} node={child} locale={locale} />
              ))}
            </ol>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function EventSummary({ event, locale }: { event: DashboardTraceEvent; locale: Locale }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <span className="max-w-full break-words text-sm font-semibold text-foreground">{event.name}</span>
      <span className="rounded-md border border-border/80 bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
        {formatEventType(event.type, locale)}
      </span>
      <StatusBadge status={event.status} locale={locale} />
      <CategoryBadge event={event} locale={locale} />
    </span>
  );
}

function EventDetails({
  event,
  locale,
  showSummary = true
}: {
  event: DashboardTraceEvent;
  locale: Locale;
  showSummary?: boolean;
}) {
  const text = copy[locale];

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          {showSummary ? <EventSummary event={event} locale={locale} /> : null}
          <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", showSummary && "mt-2")}>
            <span className="font-mono tabular-nums">{event.durationMs ?? 0}ms</span>
            {event.metadata?.agent ? <SourceBadge agent={event.metadata.agent} locale={locale} /> : null}
            {event.metadata?.hookEvent ? <MetadataBadge value={event.metadata.hookEvent} /> : null}
            {event.metadata?.provider ? <span>{event.metadata.provider}</span> : null}
            {event.metadata?.model ? <span className="font-mono">{event.metadata.model}</span> : null}
          </div>
          <EventPrimaryDetail event={event} locale={locale} />
          {hasTraceIds(event) ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
              {event.metadata?.sessionId ? <TraceId label="session" value={event.metadata.sessionId} /> : null}
              {event.metadata?.turnId ? <TraceId label="turn" value={event.metadata.turnId} /> : null}
              {event.metadata?.promptId ? <TraceId label="prompt" value={event.metadata.promptId} /> : null}
              {event.metadata?.toolUseId ? <TraceId label="tool" value={event.metadata.toolUseId} /> : null}
            </div>
          ) : null}
        </div>
        <div className="max-w-[360px] shrink-0 break-all text-left font-mono text-[10px] leading-4 text-muted-foreground lg:text-right">
          {event.id}
        </div>
      </div>

      {event.error ? (
        <div className="mt-3 rounded-lg border border-status-error-border bg-status-error-subtle px-3 py-2 text-sm text-status-error shadow-xs">
          {event.error.message}
        </div>
      ) : null}

      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent">
          <FileJson className="h-3.5 w-3.5" aria-hidden />
          {text.common.jsonDetail}
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <pre className="mt-2 max-h-[420px] overflow-auto rounded-lg border border-border/80 bg-code p-4 text-xs leading-5 text-zinc-100 shadow-inner">
          {JSON.stringify(
            { input: event.input, output: event.output, error: event.error, metadata: event.metadata },
            null,
            2
          )}
        </pre>
      </details>
    </>
  );
}

function EventPrimaryDetail({ event, locale }: { event: DashboardTraceEvent; locale: Locale }) {
  const command = event.metadata?.command ?? getObjectString(event.input, "command");
  const tokenUsage = event.metadata?.tokenUsage;
  const category = getEventCategory(event);
  const toolName = event.metadata?.toolName;
  const skillName = event.metadata?.skillName;
  const mcp =
    event.metadata?.mcpServer && event.metadata?.mcpTool
      ? `${event.metadata.mcpServer}.${event.metadata.mcpTool}`
      : undefined;

  if (command) {
    return (
      <pre className="mt-3 overflow-x-auto rounded-lg border border-border/80 bg-surface-muted px-3 py-2 font-mono text-xs leading-5 text-foreground">
        {command}
      </pre>
    );
  }

  if (category === "command" && toolName) {
    return (
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-xs">
        <MetadataBadge value={`command ${toolName}`} />
      </div>
    );
  }

  if (tokenUsage?.total) {
    const labels = getTokenUsageLabels(locale);

    return (
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-xs tabular-nums">
        <MetadataBadge value={`${labels.total} ${tokenUsage.total.toLocaleString()}`} />
        <MetadataBadge value={`${labels.input} ${(tokenUsage.input ?? 0).toLocaleString()}`} />
        <MetadataBadge value={`${labels.output} ${(tokenUsage.output ?? 0).toLocaleString()}`} />
        {tokenUsage.estimated ? <MetadataBadge value={locale === "zh" ? "估算" : "estimated"} /> : null}
        {tokenUsage.method ? <MetadataBadge value={tokenUsage.method} /> : null}
        {tokenUsage.cachedInput ? <MetadataBadge value={`${labels.cached} ${tokenUsage.cachedInput.toLocaleString()}`} /> : null}
        {tokenUsage.reasoningOutput ? (
          <MetadataBadge value={`${labels.reasoning} ${tokenUsage.reasoningOutput.toLocaleString()}`} />
        ) : null}
      </div>
    );
  }

  if (skillName || mcp) {
    return (
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-xs">
        {skillName ? <MetadataBadge value={`skill ${skillName}`} /> : null}
        {mcp ? <MetadataBadge value={`mcp ${mcp}`} /> : null}
      </div>
    );
  }

  return null;
}

function getTokenUsageLabels(locale: Locale) {
  return locale === "zh"
    ? {
        total: "\u603b\u8ba1",
        input: "\u8f93\u5165",
        output: "\u8f93\u51fa",
        cached: "\u7f13\u5b58",
        reasoning: "\u63a8\u7406"
      }
    : {
        total: "total",
        input: "in",
        output: "out",
        cached: "cached",
        reasoning: "reasoning"
      };
}

function CategoryBadge({ event, locale }: { event: DashboardTraceEvent; locale: Locale }) {
  const labels: Record<string, string> = {
    command: locale === "zh" ? "命令" : "command",
    tool: locale === "zh" ? "工具" : "tool",
    mcp: "MCP",
    skill: "skill",
    tokens: "tokens"
  };
  const category = getEventCategory(event);

  if (!category || !(category in labels)) {
    return null;
  }

  return (
    <span className="rounded-md border border-border/80 bg-surface-raised px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {labels[category]}
    </span>
  );
}

function parseEventFilters(searchParams: Awaited<DetailSearchParams>): EventFilters {
  return {
    q: getSearchParam(searchParams.q).trim(),
    status: normalizeFilterValue(getSearchParam(searchParams.status)),
    type: normalizeFilterValue(getSearchParam(searchParams.type)),
    category: normalizeFilterValue(getSearchParam(searchParams.category))
  };
}

function parseVisibility(searchParams: Awaited<DetailSearchParams>): DashboardEventVisibility {
  const visibility = getSearchParam(searchParams.visibility);

  if (visibility === "hidden" || visibility === "all") {
    return visibility;
  }

  return getSearchParam(searchParams.show) === "all" ? "all" : "display";
}

function parsePage(value: SearchParamValue) {
  const parsed = Number(getSearchParam(value));

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function parseDetailView(value: SearchParamValue): DetailView {
  return getSearchParam(value) === "tree" ? "tree" : "timeline";
}

function getEventCategory(event: DashboardTraceEvent) {
  const metadata = event.metadata;
  const category = metadata?.category;

  if (category === "tool" && metadata?.toolKind === "command") {
    return "command";
  }

  if (category !== undefined) {
    return category;
  }

  if (metadata?.command !== undefined || getObjectString(event.input, "command") !== undefined) {
    return "command";
  }

  if (metadata?.toolKind === "command") {
    return "command";
  }

  if (metadata?.mcpServer !== undefined && metadata?.mcpTool !== undefined) {
    return "mcp";
  }

  if (metadata?.toolKind === "mcp") {
    return "mcp";
  }

  if (metadata?.skillName !== undefined) {
    return "skill";
  }

  if (metadata?.toolName !== undefined) {
    return "tool";
  }

  return metadata?.tokenUsage ? "tokens" : undefined;
}

function normalizeFilterValue(value: string) {
  return value.length > 0 ? value : "all";
}

function getSearchParam(value: SearchParamValue) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

const emptyEventFilters: EventFilters = {
  q: "",
  status: "all",
  type: "all",
  category: "all"
};

function detailHref(
  runId: string,
  locale: Locale,
  filters: EventFilters,
  visibility: DashboardEventVisibility,
  page: number,
  view: DetailView
) {
  return localizedHref(detailPath(runId, filters, visibility, page, view), locale);
}

function detailPath(
  runId: string,
  filters: EventFilters,
  visibility: DashboardEventVisibility,
  page: number,
  view: DetailView
) {
  const params = new URLSearchParams();

  if (filters.q) {
    params.set("q", filters.q);
  }

  for (const key of ["status", "type", "category"] as const) {
    if (filters[key] !== "all") {
      params.set(key, filters[key]);
    }
  }

  if (visibility !== "display") {
    params.set("visibility", visibility);
  }

  if (page > 1) {
    params.set("page", page.toString());
  }

  if (view !== "timeline") {
    params.set("view", view);
  }

  const suffix = params.toString();

  return `/runs/${runId}${suffix ? `?${suffix}` : ""}`;
}

function formatCategory(category: string, locale: Locale) {
  const labels: Record<string, string> = {
    command: locale === "zh" ? "\u547d\u4ee4" : "command",
    tool: locale === "zh" ? "\u5de5\u5177" : "tool",
    mcp: "MCP",
    skill: "skill",
    tokens: "tokens"
  };

  return labels[category] ?? category;
}

function formatFilterCount(shown: number, total: number, locale: Locale) {
  return locale === "zh"
    ? `\u5df2\u663e\u793a ${shown.toLocaleString()} / ${total.toLocaleString()} \u6761`
    : `Showing ${shown.toLocaleString()} / ${total.toLocaleString()}`;
}

function hasTraceIds(event: DashboardTraceEvent) {
  return Boolean(
    event.metadata?.sessionId ||
      event.metadata?.turnId ||
      event.metadata?.promptId ||
      event.metadata?.toolUseId
  );
}

function MetadataBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex max-w-full rounded-md border border-border/80 bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {value}
    </span>
  );
}

function TraceId({ label, value }: { label: string; value: string }) {
  return <span className="break-all">{label}:{value}</span>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs leading-5 text-foreground">{value}</dd>
    </div>
  );
}

function dotClass(status: string) {
  if (status === "success") {
    return "bg-status-success ring-status-success-border";
  }

  if (status === "error") {
    return "bg-status-error ring-status-error-border";
  }

  return "bg-status-warning ring-status-warning-border";
}

function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function formatFailureTitle(value: string, locale: Locale) {
  if (locale === "en") {
    return value;
  }

  const labels: Record<string, string> = {
    "Tool Timeout": "\u5de5\u5177\u8d85\u65f6",
    "Invalid JSON": "JSON \u65e0\u6548",
    "Token Budget Pressure": "\u4e0a\u4e0b\u6587\u9884\u7b97\u538b\u529b",
    "Unknown Error": "\u672a\u77e5\u9519\u8bef"
  };

  return labels[value] ?? value;
}

function formatFailureReason(value: string, locale: Locale) {
  if (locale === "en") {
    return value;
  }

  const labels: Record<string, string> = {
    "The step failed while waiting for an external operation to finish.":
      "\u8be5\u6b65\u9aa4\u5728\u7b49\u5f85\u5916\u90e8\u64cd\u4f5c\u5b8c\u6210\u65f6\u5931\u8d25\u3002",
    "The model or tool returned content that could not be parsed as JSON.":
      "\u6a21\u578b\u6216\u5de5\u5177\u8fd4\u56de\u4e86\u65e0\u6cd5\u89e3\u6790\u4e3a JSON \u7684\u5185\u5bb9\u3002",
    "The step likely exceeded the model or prompt context budget.":
      "\u8be5\u6b65\u9aa4\u53ef\u80fd\u8d85\u51fa\u4e86\u6a21\u578b\u6216 prompt \u7684\u4e0a\u4e0b\u6587\u9884\u7b97\u3002",
    "The step failed without a recognizable error signature.":
      "\u8be5\u6b65\u9aa4\u5931\u8d25\u4e86\uff0c\u4f46\u6ca1\u6709\u53ef\u8bc6\u522b\u7684\u9519\u8bef\u7279\u5f81\u3002"
  };

  return labels[value] ?? value;
}

function formatFailureSuggestion(value: string, locale: Locale) {
  if (locale === "en") {
    return value;
  }

  const labels: Record<string, string> = {
    "Increase the timeout, add retry logic, or provide a fallback tool.":
      "\u63d0\u9ad8\u8d85\u65f6\u65f6\u95f4\u3001\u589e\u52a0\u91cd\u8bd5\uff0c\u6216\u63d0\u4f9b\u5907\u7528\u5de5\u5177\u3002",
    "Use schema validation and ask the model to return strict JSON.":
      "\u52a0\u5165 schema \u6821\u9a8c\uff0c\u5e76\u8981\u6c42\u6a21\u578b\u8fd4\u56de\u4e25\u683c JSON\u3002",
    "Summarize earlier context, trim retrieved evidence, or split the task into smaller runs.":
      "\u603b\u7ed3\u65e9\u671f\u4e0a\u4e0b\u6587\u3001\u88c1\u526a\u68c0\u7d22\u8bc1\u636e\uff0c\u6216\u628a\u4efb\u52a1\u62c6\u6210\u66f4\u5c0f\u7684\u8fd0\u884c\u3002",
    "Inspect the input, output, stack trace, and preceding steps.":
      "\u68c0\u67e5\u8f93\u5165\u3001\u8f93\u51fa\u3001\u5806\u6808\u548c\u524d\u7f6e\u6b65\u9aa4\u3002"
  };

  return labels[value] ?? value;
}

function getObjectString(value: unknown, key: string) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const item = (value as Record<string, unknown>)[key];

  return typeof item === "string" && item.length > 0 ? item : undefined;
}
