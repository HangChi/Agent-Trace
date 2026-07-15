import Link from "next/link";
import type {
  DashboardRunComparison,
  DashboardRunEventDiff,
  DashboardRunMetric
} from "@agent-trace/schema";
import { ArrowLeft, GitCompareArrows } from "lucide-react";

import { ConsoleHeader, ErrorState, StatusBadge } from "~/components";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "~/components/ui/table";
import { formatDateTime, localizedHref, parseLocale, type Locale } from "~/lib/i18n";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;
type CompareSearchParams = Promise<{ ids?: SearchParamValue; lang?: SearchParamValue }>;

const collectorUrl = process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export default async function CompareRunsPage({ searchParams }: { searchParams: CompareSearchParams }) {
  const query = await searchParams;
  const locale = parseLocale(query.lang);
  const ids = parseIds(query.ids);
  const result = await getComparison(ids, locale);

  return (
    <main id="main-content" className="min-h-dvh bg-background text-foreground">
      <ConsoleHeader
        locale={locale}
        path={comparisonPath(ids)}
        collectorUrl={collectorUrl}
      />
      <section className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Button variant="ghost" size="sm" className="-ml-3 text-muted-foreground" asChild>
          <Link href={localizedHref("/runs", locale)}>
            <ArrowLeft className="size-4" aria-hidden />
            {locale === "zh" ? "返回 Run 列表" : "Back to runs"}
          </Link>
        </Button>

        <div className="mt-4 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <GitCompareArrows className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em]">
              {locale === "zh" ? "Run 对比" : "Run comparison"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {locale === "zh"
                ? "第一列作为基准，对比状态、耗时、事件、Token 与成本。"
                : "The first run is the baseline for status, duration, events, tokens, and cost."}
            </p>
          </div>
        </div>

        {result.error ? <div className="mt-5"><ErrorState message={result.error} locale={locale} /></div> : null}
        {!result.error && result.runs.length > 0 ? (
          <>
            <ComparisonTable runs={result.runs} locale={locale} />
            <EventDiffTable
              diffs={result.eventDiffs}
              regressionCount={result.regressionCount}
              locale={locale}
            />
          </>
        ) : null}
      </section>
    </main>
  );
}

function EventDiffTable({
  diffs,
  regressionCount,
  locale
}: {
  diffs: DashboardRunEventDiff[];
  regressionCount: number;
  locale: Locale;
}) {
  return (
    <Card className="mt-5 overflow-hidden py-0">
      <div className="border-b border-border bg-surface-raised px-5 py-4">
        <h2 className="text-sm font-semibold">
          {locale === "zh" ? "事件差异与回归" : "Event differences and regressions"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {locale === "zh"
            ? `检测到 ${diffs.length} 个事件差异，其中 ${regressionCount} 项达到回归阈值。`
            : `${diffs.length} event differences; ${regressionCount} crossed regression thresholds.`}
        </p>
      </div>
      {diffs.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          {locale === "zh" ? "未检测到事件级差异。" : "No event-level differences detected."}
        </p>
      ) : (
        <Table containerClassName="overflow-x-auto">
          <TableHeader>
            <TableRow className="bg-surface-muted/90 hover:bg-surface-muted/90">
              <TableHead>{locale === "zh" ? "候选 Run" : "Candidate"}</TableHead>
              <TableHead>{locale === "zh" ? "事件" : "Event"}</TableHead>
              <TableHead>{locale === "zh" ? "变化" : "Changes"}</TableHead>
              <TableHead>{locale === "zh" ? "回归" : "Regressions"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {diffs.map((diff) => (
              <TableRow key={`${diff.runId}:${diff.eventKey}`}>
                <TableCell className="font-mono text-xs">{diff.runId}</TableCell>
                <TableCell>
                  <div className="font-medium">{diff.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {diff.type} · #{diff.occurrence}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {diff.changes.join(", ")}
                </TableCell>
                <TableCell>
                  {diff.regressions.length > 0 ? (
                    <span className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                      {diff.regressions.join(", ")}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function ComparisonTable({ runs, locale }: { runs: DashboardRunMetric[]; locale: Locale }) {
  const baseline = runs[0];
  if (!baseline) return null;

  const rows = [
    {
      label: locale === "zh" ? "状态" : "Status",
      render: (run: DashboardRunMetric) => <StatusBadge status={run.status} locale={locale} />
    },
    {
      label: locale === "zh" ? "开始时间" : "Started",
      render: (run: DashboardRunMetric) => formatDateTime(run.startedAt, locale)
    },
    {
      label: locale === "zh" ? "耗时" : "Duration",
      render: (run: DashboardRunMetric) => metricValue(formatDuration(run.durationMs), run.durationMs, baseline.durationMs, "duration")
    },
    {
      label: locale === "zh" ? "事件" : "Events",
      render: (run: DashboardRunMetric) => metricValue(run.eventCount.toLocaleString(), run.eventCount, baseline.eventCount)
    },
    {
      label: locale === "zh" ? "失败事件" : "Failed events",
      render: (run: DashboardRunMetric) => metricValue(run.failedEventCount.toLocaleString(), run.failedEventCount, baseline.failedEventCount)
    },
    {
      label: "Tokens",
      render: (run: DashboardRunMetric) => metricValue(run.totalTokens.toLocaleString(), run.totalTokens, baseline.totalTokens)
    },
    {
      label: locale === "zh" ? "成本" : "Cost",
      render: (run: DashboardRunMetric) => metricValue(formatUsd(run.costUsd), run.costUsd, baseline.costUsd, "cost")
    }
  ];

  return (
    <Card className="mt-5 overflow-hidden py-0">
      <Table containerClassName="overflow-x-auto">
        <TableHeader>
          <TableRow className="bg-surface-muted/90 hover:bg-surface-muted/90">
            <TableHead className="min-w-36">{locale === "zh" ? "指标" : "Metric"}</TableHead>
            {runs.map((run, index) => (
              <TableHead key={run.id} className="min-w-56 py-3 align-top">
                <Link
                  href={localizedHref(`/runs/${run.id}`, locale)}
                  className="block break-words text-sm font-semibold text-foreground hover:text-primary"
                >
                  {run.name}
                </Link>
                <span className="mt-1 block break-all font-mono text-[10px] font-normal text-muted-foreground">
                  {index === 0 ? (locale === "zh" ? "基准 · " : "Baseline · ") : ""}{run.id}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className="font-medium text-muted-foreground">{row.label}</TableCell>
              {runs.map((run) => (
                <TableCell key={run.id} className="font-mono text-sm tabular-nums">
                  {row.render(run)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function metricValue(
  formatted: string,
  value: number,
  baseline: number,
  kind: "number" | "duration" | "cost" = "number"
) {
  const difference = value - baseline;
  const formattedDifference = kind === "duration"
    ? formatSignedDuration(difference)
    : kind === "cost"
      ? `${difference >= 0 ? "+" : "-"}${formatUsd(Math.abs(difference))}`
      : `${difference >= 0 ? "+" : ""}${difference.toLocaleString()}`;

  return (
    <div>
      <div className="font-semibold text-foreground">{formatted}</div>
      {difference !== 0 ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{formattedDifference}</div>
      ) : null}
    </div>
  );
}

async function getComparison(
  ids: string[],
  locale: Locale
): Promise<DashboardRunComparison & { error?: string }> {
  if (ids.length < 2 || ids.length > 5) {
    return {
      runs: [],
      eventDiffs: [],
      regressionCount: 0,
      error: locale === "zh" ? "请选择 2–5 个 Run 进行对比。" : "Select 2–5 runs to compare."
    };
  }

  try {
    const params = new URLSearchParams({ ids: ids.join(",") });
    const response = await fetch(`${collectorUrl}/analytics/runs/compare?${params}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        runs: [],
        eventDiffs: [],
        regressionCount: 0,
        error: locale === "zh" ? `Run 对比返回 ${response.status}` : `Run comparison returned ${response.status}`
      };
    }

    const body = await response.json() as DashboardRunComparison;
    if (body.runs.length < 2) {
      return {
        runs: body.runs,
        eventDiffs: body.eventDiffs,
        regressionCount: body.regressionCount,
        error: locale === "zh" ? "至少有两个 Run 必须仍然存在。" : "At least two runs must still exist."
      };
    }

    return body;
  } catch (error) {
    return {
      runs: [],
      eventDiffs: [],
      regressionCount: 0,
      error: error instanceof Error ? error.message : locale === "zh" ? "Run 对比不可用" : "Run comparison is unavailable"
    };
  }
}

function parseIds(value: SearchParamValue) {
  const raw = Array.isArray(value) ? value[0] : value;
  return [...new Set((raw ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
}

function comparisonPath(ids: string[]) {
  const params = new URLSearchParams({ ids: ids.join(",") });
  return `/runs/compare?${params}`;
}

function formatDuration(value: number) {
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

function formatSignedDuration(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatDuration(Math.abs(value))}`;
}

function formatUsd(value: number) {
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}
