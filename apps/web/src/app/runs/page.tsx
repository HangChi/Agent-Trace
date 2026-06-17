import Link from "next/link";
import { Inbox } from "lucide-react";

import { SourceBadge, StatusBadge, EmptyState, ErrorState } from "../components";
import {
  copy,
  formatDateTime,
  formatRedaction,
  formatSurface,
  localizedHref,
  parseLocale,
  runningDurationLabel,
  type Locale
} from "../i18n";
import { LanguageSwitcher } from "../language-switcher";
import { DeleteRunButton, RefreshButton } from "./run-controls";

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
};

type RunsSearchParams = Promise<{
  lang?: string | string[];
}>;

const collectorUrl = process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export default async function RunsPage({ searchParams }: { searchParams: RunsSearchParams }) {
  const locale = parseLocale((await searchParams).lang);
  const text = copy[locale];
  const { runs, error } = await getRuns(locale);
  const totalRuns = runs.length;
  const failedRuns = runs.filter((run) => run.status === "error").length;
  const runningRuns = runs.filter((run) => run.status === "running").length;
  const agentRuns = runs.filter((run) => run.metadata?.agent).length;

  return (
    <main
      id="main-content"
      className="min-h-screen bg-[var(--color-canvas)] transition-colors duration-300"
    >
      <header className="border-b border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] transition-colors duration-300">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                ToolTrace
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--color-foreground-primary)]">
                {text.runs.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-[var(--color-foreground-secondary)]">
                {text.runs.subtitle}
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <LanguageSwitcher locale={locale} path="/runs" />
              <div className="border border-[var(--color-border-primary)] bg-[var(--color-surface-secondary)] px-3 py-2 text-xs text-[var(--color-foreground-secondary)] transition-colors duration-300">
                <div className="font-medium text-[var(--color-foreground-primary)]">
                  {text.common.collector}
                </div>
                <div className="mt-1 break-all font-mono">{collectorUrl}</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label={text.runs.allRuns} value={totalRuns.toString()} tone="blue" />
          <Metric label={text.runs.agentSource} value={agentRuns.toString()} tone="teal" />
          <Metric label={text.runs.running} value={runningRuns.toString()} tone="amber" />
          <Metric label={text.runs.errors} value={failedRuns.toString()} tone="red" />
        </div>

        <div className="mt-6 overflow-hidden border border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] shadow-[var(--shadow-card)] transition-colors duration-300">
          <div className="flex items-center justify-between border-b border-[var(--color-border-primary)] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-foreground-primary)]">
                {text.runs.recent}
              </h2>
              <p className="mt-1 text-xs text-[var(--color-foreground-tertiary)]">
                {text.runs.latest}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 items-center border border-[var(--color-border-primary)] bg-[var(--color-surface-secondary)] px-3 text-xs text-[var(--color-foreground-secondary)] transition-colors duration-300">
                {text.common.shown} {totalRuns} {text.common.rows}
              </span>
              <RefreshButton label={text.runs.refresh} refreshingLabel={text.runs.refreshing} />
            </div>
          </div>

          {error ? <ErrorState message={error} locale={locale} /> : null}
          {!error && runs.length === 0 ? (
            <EmptyState locale={locale} title={text.runs.emptyTitle} body={text.runs.emptyBody} />
          ) : null}
          {!error && runs.length > 0 ? <RunsTable runs={runs} locale={locale} /> : null}
        </div>
      </section>
    </main>
  );
}

async function getRuns(locale: Locale): Promise<{ runs: Run[]; error?: string }> {
  try {
    const response = await fetch(`${collectorUrl}/runs`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        runs: [],
        error: locale === "zh" ? `Collector 返回 ${response.status}` : `Collector returned ${response.status}`
      };
    }

    return {
      runs: (await response.json()) as Run[]
    };
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

function RunsTable({ runs, locale }: { runs: Run[]; locale: Locale }) {
  const text = copy[locale];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="bg-[var(--color-surface-secondary)] text-xs text-[var(--color-foreground-tertiary)] transition-colors duration-300">
          <tr>
            <th className="px-4 py-3 font-semibold">{text.runs.tableRun}</th>
            <th className="px-4 py-3 font-semibold">{text.runs.tableSource}</th>
            <th className="px-4 py-3 font-semibold">{text.runs.tableStatus}</th>
            <th className="px-4 py-3 font-semibold">{text.runs.tableStarted}</th>
            <th className="px-4 py-3 font-semibold">{text.runs.tableDuration}</th>
            <th className="px-4 py-3 font-semibold">{text.runs.tableError}</th>
            <th className="px-4 py-3 text-right font-semibold">{text.runs.tableActions}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-secondary)]">
          {runs.map((run) => (
            <tr
              key={run.id}
              className="transition-colors duration-150 hover:bg-[var(--color-surface-secondary)]"
            >
              <td className="px-4 py-3">
                <Link
                  className="font-medium text-[var(--color-foreground-primary)] underline-offset-4 transition-colors duration-150 hover:text-[var(--color-accent)] hover:underline"
                  href={localizedHref(`/runs/${run.id}`, locale)}
                >
                  {run.name}
                </Link>
                <div className="mt-1 font-mono text-xs text-[var(--color-foreground-tertiary)]">
                  {run.id}
                </div>
              </td>
              <td className="px-4 py-3">
                <SourceCell metadata={run.metadata} locale={locale} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={run.status} locale={locale} />
              </td>
              <td className="px-4 py-3 text-[var(--color-foreground-secondary)]">
                {formatDateTime(run.startedAt, locale)}
              </td>
              <td className="px-4 py-3 text-[var(--color-foreground-secondary)]">
                {formatDuration(run.startedAt, run.endedAt, locale)}
              </td>
              <td className="max-w-[260px] truncate px-4 py-3 text-[var(--color-foreground-secondary)]">
                {run.error ?? "-"}
              </td>
              <td className="px-4 py-3 text-right">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <div className="mt-1 font-mono text-xs text-[var(--color-foreground-tertiary)]">
        {details.length > 0 ? details.join(" / ") : "-"}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "amber" | "blue" | "red" | "teal";
}) {
  const tones = {
    amber: { light: "border-amber-200 bg-amber-50 text-amber-900", dark: "dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" },
    blue: { light: "border-sky-200 bg-sky-50 text-sky-900", dark: "dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200" },
    red: { light: "border-red-200 bg-red-50 text-red-900", dark: "dark:border-red-800 dark:bg-red-950 dark:text-red-200" },
    teal: { light: "border-teal-200 bg-teal-50 text-teal-900", dark: "dark:border-teal-800 dark:bg-teal-950 dark:text-teal-200" }
  };

  const t = tones[tone];

  return (
    <div className={`border px-4 py-3 transition-colors duration-300 ${t.light} ${t.dark}`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function formatDuration(startedAt: string, endedAt: string | undefined, locale: Locale) {
  if (!endedAt) {
    return runningDurationLabel(locale);
  }

  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "-";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}
