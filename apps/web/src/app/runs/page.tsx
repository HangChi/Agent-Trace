import Link from "next/link";
import type {
  DashboardRun,
  DashboardRunMetadata,
  DashboardRunPage,
  DashboardRunSummary,
  DashboardUsageSummary
} from "@agent-trace/schema";
import { Activity, AlertCircle, ChevronLeft, ChevronRight, Coins, Cpu, Eye, EyeOff, ListFilter, Play, Server } from "lucide-react";

import {
  ConsoleHeader,
  EmptyState,
  ErrorState,
  SourceBadge,
  StatusBadge
} from "~/components";
import { TelemetryStrip } from "~/components/telemetry-strip";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "~/components/ui/table";
import {
  copy,
  formatAgent,
  formatDateTime,
  formatRedaction,
  formatSurface,
  localizedHref,
  parseLocale,
  runningDurationLabel,
  type Locale
} from "~/lib/i18n";
import { cn } from "~/lib/utils";
import {
  AutoRefresh,
  BulkDeleteRunsButton,
  DeleteRunButton,
  RefreshButton,
  SelectAllRunsCheckbox
} from "./run-controls";
import { calculateRunCost, getUsdCnyRate, type RunCost } from "~/lib/cost";
import { ResizableTableColumns } from "./resizable-table-columns";
import { fetchScannerStatus, type ScannerDiagnostic } from "./scanner-status";
import { getPaginationItems } from "./pagination";

export const dynamic = "force-dynamic";

type RunsSearchParams = Promise<{
  lang?: string | string[];
  page?: string | string[];
  runs?: string | string[];
  scanner?: string | string[];
}>;

type RunMode = "tracked" | "all";

const collectorUrl = process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";
const runsBulkDeleteFormId = "runs-bulk-delete-form";
const runsTableColumnStorageKey = "agent-trace:runs-table-columns:v2";
const runsPageSize = 20;
const runsTableFixedColumnWidth = 44 + 42;
const runsTableColumns = [
  {
    id: "run",
    cssVariable: "--runs-col-run" as const,
    defaultWidth: 360,
    minWidth: 220,
    maxWidth: 640
  },
  {
    id: "source",
    cssVariable: "--runs-col-source" as const,
    defaultWidth: 140,
    minWidth: 110,
    maxWidth: 260
  },
  {
    id: "status",
    cssVariable: "--runs-col-status" as const,
    defaultWidth: 96,
    minWidth: 88,
    maxWidth: 180
  },
  {
    id: "model",
    cssVariable: "--runs-col-model" as const,
    defaultWidth: 160,
    minWidth: 120,
    maxWidth: 320
  },
  {
    id: "tracked",
    cssVariable: "--runs-col-tracked" as const,
    defaultWidth: 190,
    minWidth: 150,
    maxWidth: 360
  },
  {
    id: "tokens",
    cssVariable: "--runs-col-tokens" as const,
    defaultWidth: 150,
    minWidth: 130,
    maxWidth: 260
  },
  {
    id: "cost",
    cssVariable: "--runs-col-cost" as const,
    defaultWidth: 150,
    minWidth: 120,
    maxWidth: 260
  },
  {
    id: "started",
    cssVariable: "--runs-col-started" as const,
    defaultWidth: 146,
    minWidth: 130,
    maxWidth: 260
  },
  {
    id: "duration",
    cssVariable: "--runs-col-duration" as const,
    defaultWidth: 104,
    minWidth: 90,
    maxWidth: 180
  }
];

export default async function RunsPage({ searchParams }: { searchParams: RunsSearchParams }) {
  const params = await searchParams;
  const locale = parseLocale(params.lang);
  const text = copy[locale];
  const requestedPage = parsePageParam(params.page);
  const runMode = parseRunMode(params.runs);
  const scannerMode = parseScannerMode(params.scanner);
  const [{ page: runPage, error }, scannerStatus, usageResult, exchangeRate] = await Promise.all([
    getRunPage(locale, requestedPage, runMode),
    fetchScannerStatus(collectorUrl),
    getUsageSummary(locale),
    getUsdCnyRate()
  ]);
  const runs = runPage.runs;
  const pagination = runPage.pagination;
  const totalRuns = runPage.summary.totalRuns;
  const failedRuns = runPage.summary.failedRuns;
  const runningRuns = runPage.summary.runningRuns;
  const agentSources = getAgentSourceSummary(runPage.summary.agents, locale);
  const allScannerDiagnostics = scannerStatus.diagnostics;
  const scannerDiagnostics = scannerMode === "all"
    ? allScannerDiagnostics
    : allScannerDiagnostics.filter(isDetectedScannerDiagnostic);
  const hiddenScannerCount = allScannerDiagnostics.length - scannerDiagnostics.length;

  return (
    <main id="main-content" className="min-h-dvh bg-background text-foreground">
      <AutoRefresh />
      <ConsoleHeader
        locale={locale}
        path={runsHref(locale, pagination.page, scannerMode, runMode)}
        collectorUrl={collectorUrl}
      />

      <section className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              {text.runs.consoleLabel}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-foreground">
              {text.runs.title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
              {text.runs.subtitle}
            </p>
          </div>
        </div>

        <TelemetryStrip
          className="mt-6"
          items={[
            { label: text.runs.allRuns, value: totalRuns, icon: Activity },
            {
              label: text.runs.agentSource,
              value: agentSources.total,
              detail: agentSources.detail,
              icon: Cpu,
              tone: "trace"
            },
            { label: text.runs.running, value: runningRuns, icon: Play, tone: "running" },
            { label: text.runs.errors, value: failedRuns, icon: AlertCircle, tone: "error" }
          ]}
        />

        <Card className="mt-5 overflow-hidden py-0">
          <div className="flex flex-col gap-3 border-b border-border bg-surface-raised px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-4 w-0.5 rounded-full bg-primary" aria-hidden />
                <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">{text.runs.recent}</h2>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border/80 bg-surface-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                  {totalRuns.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatCountLabel(text.runs.perPage, runsPageSize)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{text.runs.latest}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={runsHref(
                    locale,
                    1,
                    scannerMode,
                    runMode === "all" ? "tracked" : "all"
                  )}
                >
                  {runMode === "all" ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                  {runMode === "all" ? text.runs.hideEmptyRuns : text.runs.showAllRuns}
                </Link>
              </Button>
              <BulkDeleteRunsButton
                formId={runsBulkDeleteFormId}
                label={text.runs.bulkDelete}
                deletingLabel={text.runs.deleting}
                title={text.runs.bulkDeleteConfirmPrompt}
                description={text.runs.bulkDeleteConfirm}
                confirmLabel={text.runs.confirm}
                cancelLabel={text.runs.cancel}
                failedText={text.runs.bulkDeleteFailed}
                selectedText={text.runs.selectedRuns}
                clearSelectionLabel={text.runs.clearSelection}
              />
              <RefreshButton label={text.runs.refresh} refreshingLabel={text.runs.refreshing} />
            </div>
          </div>

          {error ? <ErrorState message={error} locale={locale} /> : null}
          {!error && runs.length === 0 ? (
            <EmptyState locale={locale} title={text.runs.emptyTitle} body={text.runs.emptyBody} />
          ) : null}
          {!error && runs.length > 0 ? (
            <>
              <p className="border-b border-border bg-surface-muted/70 px-4 py-2 font-mono text-[10px] text-muted-foreground md:hidden">
                {text.runs.tableScrollHint}
              </p>
              <form id={runsBulkDeleteFormId}>
                <ResizableTableColumns
                  columns={runsTableColumns}
                  fixedWidth={runsTableFixedColumnWidth}
                  storageKey={runsTableColumnStorageKey}
                >
                  <Table
                    className="table-fixed"
                    containerClassName="max-h-[72vh] overflow-auto"
                    style={{
                      minWidth: "var(--runs-table-width)",
                      width: "max(100%, var(--runs-table-width))"
                    }}
                  >
                    <colgroup>
                      <col className="w-[44px]" />
                      <col style={{ width: "var(--runs-col-run)" }} />
                      <col style={{ width: "var(--runs-col-source)" }} />
                      <col style={{ width: "var(--runs-col-status)" }} />
                      <col style={{ width: "var(--runs-col-model)" }} />
                      <col style={{ width: "var(--runs-col-tracked)" }} />
                      <col style={{ width: "var(--runs-col-tokens)" }} />
                      <col style={{ width: "var(--runs-col-cost)" }} />
                      <col style={{ width: "var(--runs-col-started)" }} />
                      <col style={{ width: "var(--runs-col-duration)" }} />
                      <col className="w-[42px]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow className="bg-surface-muted/90 hover:bg-surface-muted/90">
                        <TableHead className="h-11 pl-4 pr-0">
                          <SelectAllRunsCheckbox
                            formId={runsBulkDeleteFormId}
                            label={text.runs.selectAll}
                          />
                        </TableHead>
                        <TableHead className="relative h-11 pr-4">
                          {text.runs.tableRun}
                          <ColumnResizeHandle column="run" label={text.runs.tableRun} locale={locale} />
                        </TableHead>
                        <TableHead className="relative h-11 pr-4">
                          {text.runs.tableSource}
                          <ColumnResizeHandle column="source" label={text.runs.tableSource} locale={locale} />
                        </TableHead>
                        <TableHead className="relative h-11 pr-4">
                          {text.runs.tableStatus}
                          <ColumnResizeHandle column="status" label={text.runs.tableStatus} locale={locale} />
                        </TableHead>
                        <TableHead className="relative h-11 pr-4">
                          {text.runs.tableModel}
                          <ColumnResizeHandle column="model" label={text.runs.tableModel} locale={locale} />
                        </TableHead>
                        <TableHead className="relative h-11 pr-4">
                          {text.runs.tableTracked}
                          <ColumnResizeHandle column="tracked" label={text.runs.tableTracked} locale={locale} />
                        </TableHead>
                        <TableHead className="relative h-11 pr-4 text-right">
                          {text.runs.tableTokens}
                          <ColumnResizeHandle column="tokens" label={text.runs.tableTokens} locale={locale} />
                        </TableHead>
                        <TableHead className="relative h-11 pr-4 text-right">
                          {text.runs.tableCost}
                          <ColumnResizeHandle column="cost" label={text.runs.tableCost} locale={locale} />
                        </TableHead>
                        <TableHead className="relative h-11 pr-4">
                          {text.runs.tableStarted}
                          <ColumnResizeHandle column="started" label={text.runs.tableStarted} locale={locale} />
                        </TableHead>
                        <TableHead className="relative h-11 pr-4 text-right">
                          {text.runs.tableDuration}
                          <ColumnResizeHandle column="duration" label={text.runs.tableDuration} locale={locale} />
                        </TableHead>
                        <TableHead className="h-11 pr-4" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.map((run) => (
                        <TableRow
                          key={run.id}
                          className="group"
                        >
                        <TableCell className="py-4 pl-4 pr-0 align-top">
                          <label className="-ml-2 inline-flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-accent/60 md:size-9">
                            <input
                              type="checkbox"
                              name="runIds"
                              value={run.id}
                              data-run-checkbox="true"
                              className="size-4 cursor-pointer rounded border-border accent-primary"
                              aria-label={`${text.runs.selectRun}: ${run.name}`}
                            />
                          </label>
                        </TableCell>
                        <TableCell className="relative py-4 whitespace-normal before:absolute before:inset-y-3 before:left-0 before:w-px before:bg-border group-hover:before:bg-primary/45">
                          <div className="flex min-w-0 items-center gap-3">
                            <StatusDot status={run.status} />
                            <div className="min-w-0">
                              <Link
                                className="block break-all text-sm font-semibold text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                                href={localizedHref(`/runs/${run.id}`, locale)}
                              >
                                {run.name}
                              </Link>
                              <p className="mt-1 break-all font-mono text-[11px] leading-4 text-muted-foreground">
                                {run.id}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 align-top whitespace-normal">
                          <SourceCell metadata={run.metadata} locale={locale} />
                        </TableCell>
                        <TableCell className="py-4 align-top whitespace-normal">
                          <StatusBadge status={run.status} locale={locale} />
                          {run.error ? (
                            <div
                              className="mt-1 max-w-[84px] truncate font-mono text-[11px] text-destructive"
                              title={run.error}
                            >
                              {run.error}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="py-4 align-top whitespace-normal">
                          <ModelCell summary={run.metadata?.summary} />
                        </TableCell>
                        <TableCell className="py-4 align-top whitespace-normal">
                          <SummaryCell summary={run.metadata?.summary} locale={locale} />
                        </TableCell>
                        <TableCell className="py-4 text-right align-top whitespace-normal">
                          <TokenCell tokenUsage={run.metadata?.summary?.tokenUsage} locale={locale} />
                        </TableCell>
                        <TableCell className="py-4 text-right align-top whitespace-normal">
                          <CostCell
                            cost={calculateRunCost(run.metadata?.summary, exchangeRate)}
                            locale={locale}
                          />
                        </TableCell>
                        <TableCell className="py-4 align-top text-[13px] text-muted-foreground tabular-nums">
                          <div>{formatDateTime(run.startedAt, locale)}</div>
                        </TableCell>
                        <TableCell className="py-4 text-right align-top text-xs tabular-nums">
                          <div
                            className={cn(
                              "tabular-nums",
                              run.status === "running"
                                ? "font-medium text-status-warning"
                                : "text-muted-foreground"
                            )}
                          >
                            {formatDuration(run.startedAt, run.endedAt, locale)}
                          </div>
                        </TableCell>
                        <TableCell className="py-4 pr-4 text-right align-top">
                          <DeleteRunButton
                            runId={run.id}
                            label={text.runs.delete}
                            deletingLabel={text.runs.deleting}
                            title={text.runs.confirmPrompt}
                            description={text.runs.confirmDelete}
                            confirmLabel={text.runs.confirm}
                            cancelLabel={text.runs.cancel}
                            failedText={text.runs.deleteFailed}
                          />
                        </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ResizableTableColumns>
              </form>
              {pagination.totalPages > 1 ? (
                <RunsPaginationControls
                  locale={locale}
                  pagination={pagination}
                  runMode={runMode}
                  scannerMode={scannerMode}
                />
              ) : null}
            </>
          ) : null}
        </Card>

        <UsageLedger summary={usageResult.summary} error={usageResult.error} locale={locale} />

        {allScannerDiagnostics.length > 0 ? (
          <ScannerStatus
            currentPage={pagination.page}
            diagnostics={scannerDiagnostics}
            hiddenCount={hiddenScannerCount}
            locale={locale}
            runMode={runMode}
            showAll={scannerMode === "all"}
          />
        ) : null}
      </section>
    </main>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-card",
        status === "success" &&
          "bg-status-success shadow-[0_0_0_3px_var(--status-success-subtle)]",
        status === "error" &&
          "bg-status-error shadow-[0_0_0_3px_var(--status-error-subtle)]",
        status === "running" &&
          "animate-pulse bg-status-warning shadow-[0_0_0_3px_var(--status-warning-subtle)]"
      )}
    />
  );
}

function ColumnResizeHandle({
  column,
  label,
  locale
}: {
  column: string;
  label: string;
  locale: Locale;
}) {
  const title = locale === "zh" ? `调整${label}列宽` : `Resize ${label} column`;

  return (
    <button
      type="button"
      data-column-resizer={column}
      aria-label={title}
      title={title}
      className="absolute right-0 top-1/2 h-6 w-3 -translate-y-1/2 cursor-col-resize touch-none rounded-sm bg-transparent p-0 outline-none transition-colors before:absolute before:left-1/2 before:top-1 before:h-4 before:w-px before:-translate-x-1/2 before:bg-border hover:before:bg-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:before:bg-primary"
    />
  );
}

async function getRunPage(
  locale: Locale,
  page: number,
  runMode: RunMode
): Promise<{ page: DashboardRunPage; error?: string }> {
  try {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(runsPageSize)
    });

    if (runMode === "all") {
      query.set("includeUntracked", "1");
    }

    const response = await fetch(`${collectorUrl}/runs?${query}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        page: createEmptyRunPage(page),
        error:
          locale === "zh"
            ? `Collector 返回 ${response.status}`
            : `Collector returned ${response.status}`
      };
    }

    const payload = await response.json();

    return {
      page: Array.isArray(payload)
        ? createRunPageFromRuns(payload as DashboardRun[], page)
        : (payload as DashboardRunPage)
    };
  } catch (err) {
    return {
      page: createEmptyRunPage(page),
      error:
        err instanceof Error
          ? err.message
          : locale === "zh"
            ? "Collector 无法访问"
            : "Collector is unreachable"
    };
  }
}

function createEmptyRunPage(page: number): DashboardRunPage {
  return createRunPageFromRuns([], page);
}

function createRunPageFromRuns(runs: DashboardRun[], page: number): DashboardRunPage {
  const totalPages = Math.max(1, Math.ceil(runs.length / runsPageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * runsPageSize;
  const counts = new Map<string, number>();

  for (const run of runs) {
    const agent = run.metadata?.agent ?? "manual";
    counts.set(agent, (counts.get(agent) ?? 0) + 1);
  }

  return {
    runs: runs.slice(start, start + runsPageSize),
    pagination: {
      page: safePage,
      pageSize: runsPageSize,
      total: runs.length,
      totalPages
    },
    summary: {
      totalRuns: runs.length,
      runningRuns: runs.filter((run) => run.status === "running").length,
      failedRuns: runs.filter((run) => run.status === "error").length,
      agents: [...counts.entries()]
        .map(([agent, count]) => ({ agent, count }))
        .sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent))
    }
  };
}

function parsePageParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function parseScannerMode(value: string | string[] | undefined): "detected" | "all" {
  const raw = Array.isArray(value) ? value[0] : value;

  return raw === "all" ? "all" : "detected";
}

async function getUsageSummary(
  locale: Locale
): Promise<{ summary: DashboardUsageSummary; error?: string }> {
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
        error: locale === "zh" ? `用量汇总返回 ${response.status}` : `Usage summary returned ${response.status}`
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

function parseRunMode(value: string | string[] | undefined): RunMode {
  const raw = Array.isArray(value) ? value[0] : value;

  return raw === "all" ? "all" : "tracked";
}

function runsHref(
  locale: Locale,
  page: number,
  scannerMode: "detected" | "all",
  runMode: RunMode
) {
  const params = new URLSearchParams();

  if (page > 1) {
    params.set("page", String(page));
  }

  if (scannerMode === "all") {
    params.set("scanner", "all");
  }

  if (runMode === "all") {
    params.set("runs", "all");
  }

  const query = params.toString();

  return localizedHref(query ? `/runs?${query}` : "/runs", locale);
}

function ScannerStatus({
  currentPage,
  diagnostics,
  hiddenCount,
  runMode,
  showAll,
  locale
}: {
  currentPage: number;
  diagnostics: ScannerDiagnostic[];
  hiddenCount: number;
  runMode: RunMode;
  showAll: boolean;
  locale: Locale;
}) {
  const text = copy[locale];
  const nextMode = showAll ? "detected" : "all";
  const toggleLabel = showAll
    ? text.runs.scannerShowDetected
    : `${text.runs.scannerShowAll}${hiddenCount > 0 ? ` (${hiddenCount.toLocaleString()})` : ""}`;

  return (
    <Card className="mt-5 overflow-hidden py-0">
      <div className="flex flex-col gap-3 border-b border-border/70 bg-surface-raised px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-300">
            <Server className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{text.runs.scannerStatus}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{text.runs.scannerStatusHelp}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={runsHref(locale, currentPage, nextMode, runMode)}>
            <ListFilter className="h-4 w-4" aria-hidden />
            {toggleLabel}
          </Link>
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader sticky={false}>
            <TableRow className="bg-surface-muted/80 hover:bg-surface-muted/80">
              <TableHead className="h-10 pl-4">{text.runs.scannerClient}</TableHead>
              <TableHead className="h-10">{text.runs.scannerState}</TableHead>
              <TableHead className="h-10">{text.runs.scannerMessages}</TableHead>
              <TableHead className="h-10">{text.runs.scannerPath}</TableHead>
              <TableHead className="h-10 pr-4">{text.runs.scannerAction}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {diagnostics.map((diagnostic) => (
              <TableRow key={diagnostic.client}>
                <TableCell className="py-3 pl-4 align-top">
                  <SourceBadge agent={clientToAgent(diagnostic.client)} locale={locale} />
                </TableCell>
                <TableCell className="py-3 align-top">
                  <span
                    className={cn(
                      "inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                      getScannerStatusClass(diagnostic.status)
                    )}
                  >
                    {formatScannerStatus(diagnostic.status, locale)}
                  </span>
                </TableCell>
                <TableCell className="py-3 align-top font-mono text-xs tabular-nums text-muted-foreground">
                  {diagnostic.messageCount?.toLocaleString() ?? "-"}
                </TableCell>
                <TableCell className="max-w-[360px] py-3 align-top">
                  <div
                    className={cn(
                      "break-all font-mono text-[11px] leading-4",
                      diagnostic.pathExists === false ? "text-status-error" : "text-muted-foreground"
                    )}
                    title={diagnostic.path}
                  >
                    {diagnostic.path ?? text.runs.scannerNoPath}
                  </div>
                </TableCell>
                <TableCell className="max-w-[520px] py-3 pr-4 align-top">
                  {diagnostic.actionHint || diagnostic.warning ? (
                    <div className="space-y-1">
                      {diagnostic.actionHint ? (
                        <div className="break-all font-mono text-[11px] leading-4 text-foreground">
                          {diagnostic.actionHint}
                        </div>
                      ) : null}
                      {diagnostic.warning ? (
                        <div className="break-words text-[11px] leading-4 text-muted-foreground">
                          {diagnostic.warning}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function RunsPaginationControls({
  locale,
  pagination,
  runMode,
  scannerMode
}: {
  locale: Locale;
  pagination: DashboardRunPage["pagination"];
  runMode: RunMode;
  scannerMode: "detected" | "all";
}) {
  const text = copy[locale];
  const previousPage = Math.max(1, pagination.page - 1);
  const nextPage = Math.min(pagination.totalPages, pagination.page + 1);
  const pageItems = getPaginationItems(pagination.page, pagination.totalPages);

  return (
    <div className="flex flex-col gap-3 border-t border-border/80 bg-surface-raised px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatPaginationSummary(
          text.runs.paginationSummary,
          pagination.page,
          pagination.totalPages,
          pagination.pageSize,
          pagination.page === pagination.totalPages
            ? pagination.total - (pagination.page - 1) * pagination.pageSize
            : pagination.pageSize
        )}
      </div>
      <nav
        aria-label={locale === "zh" ? "运行记录分页" : "Run pagination"}
        className="flex flex-wrap items-center justify-end gap-2"
      >
        {pagination.page > 1 ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={runsHref(locale, previousPage, scannerMode, runMode)}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {text.detail.previousPage}
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {text.detail.previousPage}
          </Button>
        )}
        <div className="flex items-center gap-1">
          {pageItems.map((item, index) =>
            item === "ellipsis" ? (
              <span
                key={`ellipsis-${index}`}
                aria-hidden="true"
                className="flex h-8 min-w-6 items-center justify-center px-1 text-xs text-muted-foreground"
              >
                …
              </span>
            ) : (
              <Button
                key={item}
                variant={item === pagination.page ? "default" : "outline"}
                size="icon-sm"
                asChild
              >
                <Link
                  href={runsHref(locale, item, scannerMode, runMode)}
                  aria-current={item === pagination.page ? "page" : undefined}
                  aria-label={locale === "zh" ? `第 ${item} 页` : `Page ${item}`}
                >
                  {item}
                </Link>
              </Button>
            )
          )}
        </div>
        {pagination.page < pagination.totalPages ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={runsHref(locale, nextPage, scannerMode, runMode)}>
              {text.detail.nextPage}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {text.detail.nextPage}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </nav>
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
    <Card className="mt-5 overflow-hidden py-0">
      <div className="flex flex-col gap-3 border-b border-border/70 bg-surface-raised px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">{text.usageTitle}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{text.usageHelp}</p>
        </div>
        <div className="flex items-baseline gap-4 font-mono tabular-nums">
          <div className="text-right">
            <div className="text-lg font-semibold text-foreground">{summary.totalTokens.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tokens</div>
          </div>
          <div className="border-l border-border/80 pl-4 text-right">
            <div className="text-lg font-semibold text-foreground">{formatUsd(summary.costUsd)}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{text.usageEstimatedCost}</div>
          </div>
        </div>
      </div>

      {error ? <div className="border-b border-border/70 px-5 py-3 text-sm text-destructive">{error}</div> : null}

      <div className="grid divide-y divide-border/70 md:grid-cols-2 md:divide-x md:divide-y-0">
        <UsageRankList title={text.usageClients} empty={text.usageEmpty} items={clients.map((item) => ({
          label: item.client,
          tokens: item.totalTokens,
          costUsd: item.costUsd
        }))} />
        <UsageRankList title={text.usageModels} empty={text.usageEmpty} items={models.map((item) => ({
          label: item.model,
          detail: item.provider,
          tokens: item.totalTokens,
          costUsd: item.costUsd
        }))} />
      </div>
    </Card>
  );
}

function UsageRankList({
  title,
  empty,
  items
}: {
  title: string;
  empty: string;
  items: Array<{ label: string; detail?: string; tokens: number; costUsd: number }>;
}) {
  return (
    <section className="min-w-0 px-4 py-4 sm:px-5" aria-label={title}>
      <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-2 max-h-64 divide-y divide-border/70 overflow-auto">
          {items.map((item) => (
            <li key={`${item.label}-${item.detail ?? ""}`} className="flex items-center justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate font-mono text-xs font-semibold text-foreground" title={item.label}>{item.label}</div>
                {item.detail ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.detail}</div> : null}
              </div>
              <div className="shrink-0 text-right font-mono text-xs tabular-nums">
                <div className="font-semibold text-foreground">{item.tokens.toLocaleString()}</div>
                <div className="text-[10px] text-muted-foreground">{formatUsd(item.costUsd)}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatCountLabel(template: string, count: number) {
  return template.replace("{count}", count.toLocaleString());
}

function formatPaginationSummary(
  template: string,
  page: number,
  totalPages: number,
  pageSize: number,
  currentCount: number
) {
  return template
    .replace("{page}", page.toLocaleString())
    .replace("{totalPages}", totalPages.toLocaleString())
    .replace("{currentCount}", Math.max(0, currentCount).toLocaleString())
    .replace("{pageSize}", pageSize.toLocaleString());
}

function getAgentSourceSummary(
  sources: Array<{ agent: string; count: number }>,
  locale: Locale
) {
  const sortedSources = [...sources].sort((a, b) => {
    const countDiff = b.count - a.count;

    return countDiff === 0 ? a.agent.localeCompare(b.agent) : countDiff;
  });

  return {
    total: sortedSources.length,
    detail: sortedSources
      .slice(0, 3)
      .map(({ agent, count }) => `${formatAgent(agent, locale)} ${count.toLocaleString()}`)
      .join(" / ")
  };
}

function isDetectedScannerDiagnostic(diagnostic: ScannerDiagnostic) {
  return diagnostic.status !== "missing" || diagnostic.pathExists === true;
}


function formatScannerStatus(status: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    zh: {
      available: "\u6709\u6570\u636e",
      waiting: "\u7b49\u5f85\u8bb0\u5f55",
      missing: "\u672a\u68c0\u6d4b\u5230",
      needs_sync: "\u9700\u8981 sync",
      needs_login: "\u9700\u8981 login",
      synced: "\u5df2\u540c\u6b65",
      error: "\u5f02\u5e38"
    },
    en: {
      available: "available",
      waiting: "waiting",
      missing: "missing",
      needs_sync: "needs sync",
      needs_login: "needs login",
      synced: "synced",
      error: "error"
    }
  };

  return labels[locale][status] ?? status;
}

function getScannerStatusClass(status: string) {
  if (status === "available" || status === "synced") {
    return "border-status-success-border bg-status-success-subtle text-status-success";
  }

  if (status === "needs_sync" || status === "needs_login" || status === "waiting") {
    return "border-status-warning-border bg-status-warning-subtle text-status-warning";
  }

  if (status === "error") {
    return "border-status-error-border bg-status-error-subtle text-status-error";
  }

  return "border-border bg-surface-muted text-muted-foreground";
}

function clientToAgent(client: string) {
  if (client === "claude") return "claude-code";
  if (client === "copilot") return "github-copilot";

  return client;
}

function SourceCell({ metadata, locale }: { metadata?: DashboardRunMetadata; locale: Locale }) {
  const agent = metadata?.agent ?? "manual";
  const details = [
    formatSurface(metadata?.surface, locale),
    formatRedaction(metadata?.redactionLevel, locale)
  ].filter(Boolean);

  return (
    <div>
      <SourceBadge agent={agent} locale={locale} />
      {details.length > 0 ? (
        <div className="mt-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
          {details.join(" / ")}
        </div>
      ) : null}
    </div>
  );
}

function ModelCell({ summary }: { summary?: DashboardRunSummary }) {
  const models = getSummaryModels(summary);

  if (models.length === 0) {
    return <span className="text-[13px] text-muted-foreground">-</span>;
  }

  return (
    <div className="min-w-0 whitespace-normal font-mono text-xs" title={models.join(" / ")}>
      <div className="truncate font-semibold text-foreground">{models[0]}</div>
      {models.length > 1 ? (
        <div className="mt-1 text-[11px] text-muted-foreground">+{models.length - 1}</div>
      ) : null}
    </div>
  );
}

function SummaryCell({ summary, locale }: { summary?: DashboardRunSummary; locale: Locale }) {
  if (!summary || getSummaryTotal(summary) === 0) {
    return <span className="text-[13px] text-muted-foreground">-</span>;
  }

  const counts = [
    countLabel(summary.commandCount, locale === "zh" ? "命令" : "cmd"),
    countLabel(summary.toolCount, locale === "zh" ? "工具" : "tool"),
    countLabel(summary.mcpCount, "MCP"),
    countLabel(summary.skillCount, "skill")
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap gap-1.5">
        {counts.map((item) => (
          <span
            key={item}
            className="rounded-md border border-border/80 bg-surface-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function CostCell({
  cost,
  locale
}: {
  cost: RunCost;
  locale: Locale;
}) {
  const text = copy[locale];
  const title = [
    cost.unpricedModels.length > 0
      ? `${text.runs.costUnpriced}: ${cost.unpricedModels.join(", ")}`
      : undefined,
    cost.exchangeRate
      ? `USD/CNY ${cost.exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
      : undefined,
    cost.exchangeRateUpdatedAt
  ]
    .filter(Boolean)
    .join(" / ");

  if (cost.usd === undefined) {
    return (
      <div className="text-xs text-muted-foreground" title={title || undefined}>
        {cost.unpricedModels.length > 0 ? text.runs.costUnpriced : "-"}
      </div>
    );
  }

  return (
    <div className="whitespace-normal font-mono text-xs tabular-nums" title={title || undefined}>
      <div className="font-semibold text-foreground">
        {cost.estimated ? <span className="mr-1 text-[10px] text-muted-foreground">{text.runs.costEstimated}</span> : null}
        <span>{formatUsd(cost.usd)}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {cost.cny !== undefined ? formatCny(cost.cny) : text.runs.costUsdOnly}
      </div>
      {cost.unpricedModels.length > 0 ? (
        <div className="text-[10px] text-muted-foreground">
          {text.runs.costUnpriced} {cost.unpricedModels.length.toLocaleString()}
        </div>
      ) : null}
    </div>
  );
}

function getSummaryModels(summary: DashboardRunSummary | undefined) {
  const models = summary?.models ?? summary?.modelUsage?.map((usage) => usage.model) ?? [];

  return [...new Set(models)].filter((model) => model.length > 0);
}

function TokenCell({
  tokenUsage,
  locale
}: {
  tokenUsage?: DashboardRunSummary["tokenUsage"];
  locale: Locale;
}) {
  const total = tokenUsage?.total ?? 0;

  if (!tokenUsage || total === 0) {
    return <span className="text-[13px] text-muted-foreground">-</span>;
  }

  return (
    <div className="whitespace-normal font-mono text-xs tabular-nums" title={getTokenUsageTitle(locale)}>
      <div className="font-semibold text-foreground">{total.toLocaleString()}</div>
      <div className="text-[11px] text-muted-foreground">
        {formatTokenUsageParts(tokenUsage, locale).join(" / ")}
      </div>
      {tokenUsage?.estimated ? (
        <div className="text-[10px] text-muted-foreground">
          {locale === "zh" ? "估算" : "estimated"}
        </div>
      ) : null}
    </div>
  );
}

function formatTokenUsageParts(
  tokenUsage: NonNullable<DashboardRunSummary["tokenUsage"]>,
  locale: Locale
) {
  const inputLabel = locale === "zh" ? "\u8f93\u5165" : "in";
  const outputLabel = locale === "zh" ? "\u8f93\u51fa" : "out";
  const reasoningLabel = locale === "zh" ? "\u63a8\u7406" : "reasoning";
  const parts = [
    `${inputLabel} ${(tokenUsage.input ?? 0).toLocaleString()}`,
    `${outputLabel} ${(tokenUsage.output ?? 0).toLocaleString()}`
  ];

  if (tokenUsage.reasoningOutput) {
    parts.push(`${reasoningLabel} ${tokenUsage.reasoningOutput.toLocaleString()}`);
  }

  return parts;
}

function getTokenUsageTitle(locale: Locale) {
  return locale === "zh"
    ? "\u8f93\u5165=prompt/\u4e0a\u4e0b\u6587 token\uff1b\u8f93\u51fa=\u53ef\u89c1\u751f\u6210 token\uff1b\u63a8\u7406=\u9690\u85cf\u601d\u8003 token\uff0c\u901a\u5e38\u6309\u8f93\u51fa\u8ba1\u8d39\u3002"
    : "in=prompt/context tokens; out=visible generated tokens; reasoning=hidden reasoning tokens, usually billed as output.";
}

function getSummaryTotal(summary: DashboardRunSummary) {
  return (
    (summary.commandCount ?? 0) +
    (summary.toolCount ?? 0) +
    (summary.mcpCount ?? 0) +
    (summary.skillCount ?? 0)
  );
}

function countLabel(count: number | undefined, label: string) {
  return count && count > 0 ? `${count} ${label}` : undefined;
}

function formatUsd(value: number) {
  return `$${formatMoney(value)}`;
}

function formatCny(value: number) {
  return `CNY ${formatMoney(value)}`;
}

function formatMoney(value: number) {
  return value < 0.01 ? value.toFixed(4) : value.toFixed(2);
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function formatDuration(startedAt: string, endedAt: string | undefined, locale: Locale) {
  if (!endedAt) {
    return runningDurationLabel(locale);
  }

  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();

  if (!Number.isFinite(ms) || ms < 0) {
    return "-";
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}
