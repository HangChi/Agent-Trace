import Link from "next/link";
import { Activity, AlertCircle, Cpu, Play, Server } from "lucide-react";

import { EmptyState, ErrorState, LanguageSwitcher, SourceBadge, StatusBadge } from "~/components";
import { Card, CardContent } from "~/components/ui/card";
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
import { AutoRefresh, DeleteRunButton, RefreshButton } from "./run-controls";

export const dynamic = "force-dynamic";

type Run = {
  id: string;
  name: string;
  status: "running" | "success" | "error" | string;
  startedAt: string;
  endedAt?: string;
  error?: string;
  metadata?: AgentMetadata;
};

type AgentMetadata = {
  agent?: string;
  surface?: string;
  redactionLevel?: string;
  summary?: RunSummary;
};

type RunSummary = {
  commandCount?: number;
  toolCount?: number;
  mcpCount?: number;
  skillCount?: number;
  promptCount?: number;
  turnCount?: number;
  commands?: string[];
  tools?: string[];
  mcpTools?: string[];
  skills?: string[];
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
    cachedInput?: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
    reasoningOutput?: number;
    estimated?: boolean;
  };
};

type RunsSearchParams = Promise<{ lang?: string | string[] }>;

const collectorUrl = process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export default async function RunsPage({ searchParams }: { searchParams: RunsSearchParams }) {
  const locale = parseLocale((await searchParams).lang);
  const text = copy[locale];
  const { runs, error } = await getRuns(locale);
  const totalRuns = runs.length;
  const failedRuns = runs.filter((r) => r.status === "error").length;
  const runningRuns = runs.filter((r) => r.status === "running").length;
  const agentSources = getAgentSourceSummary(runs, locale);

  return (
    <main id="main-content" className="min-h-screen bg-background">
      <AutoRefresh />
      <header className="border-b border-border bg-card/95">
        <div className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                  <Activity className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-primary">ToolTrace</p>
                  <h1 className="text-xl font-semibold text-foreground">{text.runs.title}</h1>
                </div>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {text.runs.subtitle}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
              <LanguageSwitcher locale={locale} path="/runs" />
              <div
                className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-border bg-background px-3 text-xs shadow-sm"
                title={collectorUrl}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
                <Server className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="font-medium text-foreground">{text.common.collector}</span>
                <span className="max-w-[220px] truncate font-mono text-muted-foreground">
                  {collectorUrl}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label={text.runs.allRuns} value={totalRuns} icon={Activity} accent="sky" />
          <MetricCard
            label={text.runs.agentSource}
            value={agentSources.total}
            detail={agentSources.detail}
            icon={Cpu}
            accent="teal"
          />
          <MetricCard label={text.runs.running} value={runningRuns} icon={Play} accent="amber" />
          <MetricCard label={text.runs.errors} value={failedRuns} icon={AlertCircle} accent="red" />
        </div>

        <Card className="mt-5 overflow-hidden border-border bg-card py-0 shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{text.runs.recent}</h2>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                  {totalRuns}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{text.runs.latest}</p>
            </div>
            <RefreshButton label={text.runs.refresh} refreshingLabel={text.runs.refreshing} />
          </div>

          {error ? <ErrorState message={error} locale={locale} /> : null}
          {!error && runs.length === 0 ? (
            <EmptyState locale={locale} title={text.runs.emptyTitle} body={text.runs.emptyBody} />
          ) : null}
          {!error && runs.length > 0 ? (
            <div>
              <Table className="min-w-[1460px] table-fixed">
                <colgroup>
                  <col className="w-[360px]" />
                  <col className="w-[150px]" />
                  <col className="w-[190px]" />
                  <col className="w-[270px]" />
                  <col className="w-[220px]" />
                  <col className="w-[180px]" />
                  <col className="w-[90px]" />
                  <col className="w-[72px]" />
                </colgroup>
                <TableHeader>
                  <TableRow className="border-border bg-muted/60 hover:bg-muted/60">
                    <TableHead className="h-10 pl-5 text-xs font-semibold text-muted-foreground">
                      {text.runs.tableRun}
                    </TableHead>
                    <TableHead className="h-10 text-xs font-semibold text-muted-foreground">
                      {text.runs.tableSource}
                    </TableHead>
                    <TableHead className="h-10 text-xs font-semibold text-muted-foreground">
                      {text.runs.tableStatus}
                    </TableHead>
                    <TableHead className="h-10 text-xs font-semibold text-muted-foreground">
                      {text.runs.tableTracked}
                    </TableHead>
                    <TableHead className="h-10 text-xs font-semibold text-muted-foreground">
                      {text.runs.tableTokens}
                    </TableHead>
                    <TableHead className="h-10 text-xs font-semibold text-muted-foreground">
                      {text.runs.tableStarted}
                    </TableHead>
                    <TableHead className="h-10 text-xs font-semibold text-muted-foreground">
                      {text.runs.tableDuration}
                    </TableHead>
                    <TableHead className="h-10 pr-5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className="group border-border/70 transition-colors hover:bg-accent/35"
                    >
                      <TableCell className="py-3 pl-5 whitespace-normal">
                        <div className="flex min-w-0 items-center gap-3">
                          <StatusDot status={run.status} />
                          <div className="min-w-0">
                            <Link
                              className="block break-all text-sm font-semibold text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                              href={localizedHref(`/runs/${run.id}`, locale)}
                            >
                              {run.name}
                            </Link>
                            <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                              {run.id}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 align-top">
                        <SourceCell metadata={run.metadata} locale={locale} />
                      </TableCell>
                      <TableCell className="py-3 align-top whitespace-normal">
                        <StatusBadge status={run.status} locale={locale} />
                        {run.error ? (
                          <div className="mt-1 break-words font-mono text-[11px] text-destructive">
                            {run.error}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="py-3 align-top">
                        <SummaryCell summary={run.metadata?.summary} locale={locale} />
                      </TableCell>
                      <TableCell className="py-3 align-top">
                        <TokenCell tokenUsage={run.metadata?.summary?.tokenUsage} locale={locale} />
                      </TableCell>
                      <TableCell className="py-3 align-top text-[13px] text-muted-foreground tabular-nums">
                        {formatDateTime(run.startedAt, locale)}
                      </TableCell>
                      <TableCell className="py-3 align-top">
                        <span
                          className={cn(
                            "text-[13px] tabular-nums",
                            run.status === "running"
                              ? "font-medium text-status-warning"
                              : "text-muted-foreground"
                          )}
                        >
                          {formatDuration(run.startedAt, run.endedAt, locale)}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 pr-5 text-right align-top">
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
            </div>
          ) : null}
        </Card>
      </section>
    </main>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full border border-card shadow-[0_0_0_3px_var(--muted)]",
        status === "success" && "bg-status-success",
        status === "error" && "bg-status-error",
        status === "running" && "animate-pulse bg-status-warning"
      )}
    />
  );
}

async function getRuns(locale: Locale): Promise<{ runs: Run[]; error?: string }> {
  try {
    const response = await fetch(`${collectorUrl}/runs`, { cache: "no-store" });

    if (!response.ok) {
      return {
        runs: [],
        error:
          locale === "zh"
            ? `Collector 返回 ${response.status}`
            : `Collector returned ${response.status}`
      };
    }

    return { runs: (await response.json()) as Run[] };
  } catch (err) {
    return {
      runs: [],
      error:
        err instanceof Error
          ? err.message
          : locale === "zh"
            ? "Collector 无法访问"
            : "Collector is unreachable"
    };
  }
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent
}: {
  label: string;
  value: number;
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "sky" | "teal" | "amber" | "red";
}) {
  const accents = {
    sky: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/35 dark:text-sky-300 dark:border-sky-900",
    teal: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/35 dark:text-teal-300 dark:border-teal-900",
    amber:
      "bg-status-warning-subtle text-status-warning border-status-warning-border",
    red: "bg-status-error-subtle text-status-error border-status-error-border"
  };

  return (
    <Card className="border-border bg-card py-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{value}</p>
            {detail ? (
              <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground" title={detail}>
                {detail}
              </p>
            ) : null}
          </div>
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg border", accents[accent])}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function getAgentSourceSummary(runs: Run[], locale: Locale) {
  const counts = new Map<string, number>();

  for (const run of runs) {
    const agent = run.metadata?.agent ?? "manual";
    counts.set(agent, (counts.get(agent) ?? 0) + 1);
  }

  const sources = [...counts.entries()].sort((a, b) => {
    const countDiff = b[1] - a[1];

    return countDiff === 0 ? a[0].localeCompare(b[0]) : countDiff;
  });

  return {
    total: sources.length,
    detail: sources
      .slice(0, 3)
      .map(([agent, count]) => `${formatAgent(agent, locale)} ${count.toLocaleString()}`)
      .join(" / ")
  };
}

function SourceCell({ metadata, locale }: { metadata?: AgentMetadata; locale: Locale }) {
  const agent = metadata?.agent ?? "manual";
  const details = [
    formatSurface(metadata?.surface, locale),
    formatRedaction(metadata?.redactionLevel, locale)
  ].filter(Boolean);

  return (
    <div>
      <SourceBadge agent={agent} locale={locale} />
      {details.length > 0 ? (
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
          {details.join(" / ")}
        </div>
      ) : null}
    </div>
  );
}

function SummaryCell({ summary, locale }: { summary?: RunSummary; locale: Locale }) {
  if (!summary || getSummaryTotal(summary) === 0) {
    return <span className="text-[13px] text-muted-foreground">-</span>;
  }

  const counts = [
    countLabel(summary.promptCount, locale === "zh" ? "\u63d0\u793a" : "prompt"),
    countLabel(summary.turnCount, locale === "zh" ? "\u56de\u5408" : "turn"),
    countLabel(summary.commandCount, locale === "zh" ? "命令" : "cmd"),
    countLabel(summary.toolCount, locale === "zh" ? "工具" : "tool"),
    countLabel(summary.mcpCount, "MCP"),
    countLabel(summary.skillCount, "skill")
  ].filter((item): item is string => Boolean(item));
  const examples = [
    ...(summary.commands ?? []),
    ...(summary.mcpTools ?? []),
    ...(summary.skills ?? []),
    ...(summary.tools ?? [])
  ].slice(0, 2);

  return (
    <div className="min-w-[180px]">
      <div className="flex flex-wrap gap-1.5">
        {counts.map((item) => (
          <span
            key={item}
            className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
      {examples.length > 0 ? (
        <div className="mt-1 max-w-[260px] truncate font-mono text-[11px] text-muted-foreground">
          {examples.join(" / ")}
        </div>
      ) : null}
    </div>
  );
}

function TokenCell({
  tokenUsage,
  locale
}: {
  tokenUsage?: RunSummary["tokenUsage"];
  locale: Locale;
}) {
  const total = tokenUsage?.total ?? 0;

  if (total === 0) {
    return <span className="text-[13px] text-muted-foreground">-</span>;
  }

  return (
    <div className="font-mono text-xs tabular-nums">
      <div className="font-semibold text-foreground">{total.toLocaleString()}</div>
      <div className="text-[11px] text-muted-foreground">
        in {(tokenUsage?.input ?? 0).toLocaleString()} / out{" "}
        {(tokenUsage?.output ?? 0).toLocaleString()}
        {tokenUsage?.reasoningOutput
          ? ` / reasoning ${tokenUsage.reasoningOutput.toLocaleString()}`
          : ""}
      </div>
      {tokenUsage?.estimated ? (
        <div className="text-[10px] text-muted-foreground">
          {locale === "zh" ? "估算" : "estimated"}
        </div>
      ) : null}
    </div>
  );
}

function getSummaryTotal(summary: RunSummary) {
  return (
    (summary.commandCount ?? 0) +
    (summary.toolCount ?? 0) +
    (summary.mcpCount ?? 0) +
    (summary.skillCount ?? 0) +
    (summary.promptCount ?? 0) +
    (summary.turnCount ?? 0) +
    (summary.tokenUsage?.total ?? 0)
  );
}

function countLabel(count: number | undefined, label: string) {
  return count && count > 0 ? `${count} ${label}` : undefined;
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
