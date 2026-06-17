import Link from "next/link";

import {
  copy,
  formatAgent,
  formatDateTime,
  formatRedaction,
  formatStatus,
  formatSurface,
  localizedHref,
  parseLocale,
  runningDurationLabel,
  type Locale
} from "../i18n";
import { LanguageSwitcher } from "../language-switcher";

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
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">ToolTrace</p>
              <h1 className="mt-2 text-2xl font-semibold text-stone-950">{text.runs.title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-stone-600">{text.runs.subtitle}</p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <LanguageSwitcher locale={locale} path="/runs" />
              <div className="border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
                <div className="font-medium text-stone-900">{text.common.collector}</div>
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

        <div className="mt-6 overflow-hidden border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-stone-950">{text.runs.recent}</h2>
              <p className="mt-1 text-xs text-stone-500">{text.runs.latest}</p>
            </div>
            <span className="border border-stone-200 bg-stone-50 px-2 py-1 text-xs text-stone-600">
              {text.common.shown} {totalRuns} {text.common.rows}
            </span>
          </div>

          {error ? <ErrorState message={error} locale={locale} /> : null}
          {!error && runs.length === 0 ? <EmptyState locale={locale} /> : null}
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
        error: locale === "zh" ? `Collector \u8fd4\u56de ${response.status}` : `Collector returned ${response.status}`
      };
    }

    return {
      runs: (await response.json()) as Run[]
    };
  } catch (err) {
    return {
      runs: [],
      error: err instanceof Error ? err.message : locale === "zh" ? "Collector \u65e0\u6cd5\u8bbf\u95ee" : "Collector is unreachable"
    };
  }
}

function RunsTable({ runs, locale }: { runs: Run[]; locale: Locale }) {
  const text = copy[locale];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="bg-stone-50 text-xs text-stone-500">
          <tr>
            <th className="px-4 py-3 font-semibold">{text.runs.tableRun}</th>
            <th className="px-4 py-3 font-semibold">{text.runs.tableSource}</th>
            <th className="px-4 py-3 font-semibold">{text.runs.tableStatus}</th>
            <th className="px-4 py-3 font-semibold">{text.runs.tableStarted}</th>
            <th className="px-4 py-3 font-semibold">{text.runs.tableDuration}</th>
            <th className="px-4 py-3 font-semibold">{text.runs.tableError}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {runs.map((run) => (
            <tr key={run.id} className="hover:bg-stone-50">
              <td className="px-4 py-3">
                <Link
                  className="font-medium text-stone-950 underline-offset-4 hover:underline"
                  href={localizedHref(`/runs/${run.id}`, locale)}
                >
                  {run.name}
                </Link>
                <div className="mt-1 font-mono text-xs text-stone-500">{run.id}</div>
              </td>
              <td className="px-4 py-3">
                <SourceCell metadata={run.metadata} locale={locale} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={run.status} locale={locale} />
              </td>
              <td className="px-4 py-3 text-stone-700">{formatDateTime(run.startedAt, locale)}</td>
              <td className="px-4 py-3 text-stone-700">{formatDuration(run.startedAt, run.endedAt, locale)}</td>
              <td className="max-w-[260px] truncate px-4 py-3 text-stone-700">{run.error ?? "-"}</td>
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
      <div className="mt-1 font-mono text-xs text-stone-500">
        {details.length > 0 ? details.join(" / ") : "-"}
      </div>
    </div>
  );
}

function SourceBadge({ agent, locale }: { agent: string; locale: Locale }) {
  const className =
    agent === "codex"
      ? "border-teal-200 bg-teal-50 text-teal-800"
      : agent === "claude-code"
        ? "border-violet-200 bg-violet-50 text-violet-800"
        : "border-stone-200 bg-stone-50 text-stone-700";

  return (
    <span className={`inline-flex border px-2 py-1 font-mono text-xs font-medium ${className}`}>
      {formatAgent(agent, locale)}
    </span>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "amber" | "blue" | "red" | "teal" }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-sky-200 bg-sky-50 text-sky-900",
    red: "border-red-200 bg-red-50 text-red-900",
    teal: "border-teal-200 bg-teal-50 text-teal-900"
  };

  return (
    <div className={`border px-4 py-3 ${tones[tone]}`}>
      <div className="text-xs font-medium text-current opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function StatusBadge({ status, locale }: { status: string; locale: Locale }) {
  const className =
    status === "success"
      ? "bg-emerald-100 text-emerald-800"
      : status === "error"
        ? "bg-red-100 text-red-800"
        : "bg-amber-100 text-amber-800";

  return <span className={`px-2 py-1 text-xs font-medium ${className}`}>{formatStatus(status, locale)}</span>;
}

function EmptyState({ locale }: { locale: Locale }) {
  const text = copy[locale];

  return (
    <div className="px-4 py-12 text-center">
      <h3 className="text-sm font-semibold text-stone-950">{text.runs.emptyTitle}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{text.runs.emptyBody}</p>
    </div>
  );
}

function ErrorState({ message, locale }: { message: string; locale: Locale }) {
  return (
    <div className="border-t border-red-100 bg-red-50 px-4 py-4 text-sm text-red-900">
      {copy[locale].common.unavailable}
      {message}
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

