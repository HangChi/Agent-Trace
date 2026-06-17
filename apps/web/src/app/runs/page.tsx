import Link from "next/link";
import { Activity, AlertCircle, Cpu, Play } from "lucide-react";

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
  const agentRuns = runs.filter((r) => r.metadata?.agent).length;

  return (
    <main id="main-content" className="min-h-screen bg-background">
      <AutoRefresh />
      <header className="border-b border-border/40 bg-card/60 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
                  TT
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  ToolTrace
                </p>
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
                {text.runs.title}
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                {text.runs.subtitle}
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <LanguageSwitcher locale={locale} path="/runs" />
              <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                <span className="text-xs font-medium text-foreground">{text.common.collector}</span>
                <span className="font-mono text-xs text-muted-foreground">{collectorUrl}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label={text.runs.allRuns} value={totalRuns} icon={Activity} accent="sky" />
          <MetricCard label={text.runs.agentSource} value={agentRuns} icon={Cpu} accent="teal" />
          <MetricCard label={text.runs.running} value={runningRuns} icon={Play} accent="amber" />
          <MetricCard label={text.runs.errors} value={failedRuns} icon={AlertCircle} accent="red" />
        </div>

        <Card className="mt-6 overflow-hidden border-border/40 shadow-sm">
          <div className="flex items-center justify-between gap-4 px-5 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-foreground">{text.runs.recent}</h2>
              <span className="inline-flex h-5 items-center rounded-full border border-border/40 px-2 text-[11px] text-muted-foreground tabular-nums">
                {totalRuns}
              </span>
            </div>
            <RefreshButton label={text.runs.refresh} refreshingLabel={text.runs.refreshing} />
          </div>

          {error ? <ErrorState message={error} locale={locale} /> : null}
          {!error && runs.length === 0 ? (
            <EmptyState locale={locale} title={text.runs.emptyTitle} body={text.runs.emptyBody} />
          ) : null}
          {!error && runs.length > 0 ? (
            <div className="overflow-x-auto border-t border-border/40">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/30 bg-muted/30 hover:bg-muted/30">
                    <TableHead className="h-9 pl-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {text.runs.tableRun}
                    </TableHead>
                    <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {text.runs.tableSource}
                    </TableHead>
                    <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {text.runs.tableStatus}
                    </TableHead>
                    <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {text.runs.tableTracked}
                    </TableHead>
                    <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {text.runs.tableTokens}
                    </TableHead>
                    <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {text.runs.tableStarted}
                    </TableHead>
                    <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {text.runs.tableDuration}
                    </TableHead>
                    <TableHead className="h-9 pr-5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run, i) => (
                    <TableRow
                      key={run.id}
                      className={cn(
                        "group border-border/20 transition-colors hover:bg-muted/20",
                        i === runs.length - 1 && "border-b-0"
                      )}
                    >
                      <TableCell className="py-3 pl-5">
                        <div className="flex items-center gap-3">
                          <StatusDot status={run.status} />
                          <div className="min-w-0">
                            <Link
                              className="block truncate text-sm font-medium text-foreground decoration-muted-foreground/20 underline-offset-4 transition-colors hover:text-primary hover:underline"
                              href={localizedHref(`/runs/${run.id}`, locale)}
                            >
                              {run.name}
                            </Link>
                            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/50">
                              {run.id}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <SourceCell metadata={run.metadata} locale={locale} />
                      </TableCell>
                      <TableCell className="py-3">
                        <StatusBadge status={run.status} locale={locale} />
                        {run.error ? (
                          <div className="mt-1 max-w-[180px] truncate font-mono text-[11px] text-destructive/80">
                            {run.error}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="py-3">
                        <SummaryCell summary={run.metadata?.summary} locale={locale} />
                      </TableCell>
                      <TableCell className="py-3">
                        <TokenCell tokenUsage={run.metadata?.summary?.tokenUsage} />
                      </TableCell>
                      <TableCell className="py-3 text-[13px] text-muted-foreground tabular-nums">
                        {formatDateTime(run.startedAt, locale)}
                      </TableCell>
                      <TableCell className="py-3">
                        <span
                          className={cn(
                            "text-[13px] tabular-nums",
                            run.status === "running"
                              ? "font-medium text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          )}
                        >
                          {formatDuration(run.startedAt, run.endedAt, locale)}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 pr-5 text-right">
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
        "h-2 w-2 shrink-0 rounded-full",
        status === "success" && "bg-emerald-500",
        status === "error" && "bg-red-500",
        status === "running" && "animate-pulse bg-amber-500"
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
  icon: Icon,
  accent
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: "sky" | "teal" | "amber" | "red";
}) {
  const accents = {
    sky: "border-l-sky-500 bg-sky-50/60 dark:bg-sky-950/30 dark:border-l-sky-400",
    teal: "border-l-teal-500 bg-teal-50/60 dark:bg-teal-950/30 dark:border-l-teal-400",
    amber: "border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/30 dark:border-l-amber-400",
    red: "border-l-red-500 bg-red-50/60 dark:bg-red-950/30 dark:border-l-red-400"
  };
  const iconColors = {
    sky: "text-sky-600 dark:text-sky-400",
    teal: "text-teal-600 dark:text-teal-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400"
  };

  return (
    <Card className={cn("overflow-hidden rounded-xl border-l-4 border-border/40 shadow-sm", accents[accent])}>
      <CardContent className="flex items-center justify-between px-4 py-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {value}
          </p>
        </div>
        <div className={cn("rounded-lg bg-background/60 p-2", iconColors[accent])}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
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
        <div className="mt-1 font-mono text-[11px] text-muted-foreground/50">
          {details.join(" / ")}
        </div>
      ) : null}
    </div>
  );
}

function SummaryCell({ summary, locale }: { summary?: RunSummary; locale: Locale }) {
  if (!summary || getSummaryTotal(summary) === 0) {
    return <span className="text-[13px] text-muted-foreground/40">-</span>;
  }

  const counts = [
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
            className="rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
      {examples.length > 0 ? (
        <div className="mt-1 max-w-[260px] truncate font-mono text-[11px] text-muted-foreground/70">
          {examples.join(" / ")}
        </div>
      ) : null}
    </div>
  );
}

function TokenCell({ tokenUsage }: { tokenUsage?: RunSummary["tokenUsage"] }) {
  const total = tokenUsage?.total ?? 0;

  if (total === 0) {
    return <span className="text-[13px] text-muted-foreground/40">-</span>;
  }

  return (
    <div className="font-mono text-xs tabular-nums">
      <div className="font-semibold text-foreground">{total.toLocaleString()}</div>
      <div className="text-[11px] text-muted-foreground/60">
        in {(tokenUsage?.input ?? 0).toLocaleString()} / out{" "}
        {(tokenUsage?.output ?? 0).toLocaleString()}
      </div>
    </div>
  );
}

function getSummaryTotal(summary: RunSummary) {
  return (
    (summary.commandCount ?? 0) +
    (summary.toolCount ?? 0) +
    (summary.mcpCount ?? 0) +
    (summary.skillCount ?? 0) +
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
