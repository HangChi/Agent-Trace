import Link from "next/link";

import {
  copy,
  formatAgent,
  formatClockTime,
  formatEventType,
  formatRedaction,
  formatStatus,
  formatSurface,
  localizedHref,
  parseLocale,
  type Locale
} from "../../i18n";
import { LanguageSwitcher } from "../../language-switcher";
import { inspectFailures } from "./failure-inspector";

export const dynamic = "force-dynamic";

type TraceEvent = {
  id: string;
  runId: string;
  parentId?: string;
  type: string;
  name: string;
  status: "running" | "success" | "error" | string;
  timestamp: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  metadata?: {
    agent?: string;
    surface?: string;
    sessionId?: string;
    turnId?: string;
    promptId?: string;
    toolUseId?: string;
    hookEvent?: string;
    permissionMode?: string;
    redactionLevel?: string;
    provider?: string;
    model?: string;
    tokenUsage?: {
      input: number;
      output: number;
      total: number;
    };
    [key: string]: unknown;
  };
};

type DetailSearchParams = Promise<{
  lang?: string | string[];
}>;

const collectorUrl = process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export default async function RunDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: DetailSearchParams;
}) {
  const { id } = await params;
  const locale = parseLocale((await searchParams).lang);
  const text = copy[locale];
  const { events, error } = await getEvents(id, locale);
  const totalTokens = events.reduce((sum, event) => sum + (event.metadata?.tokenUsage?.total ?? 0), 0);
  const totalDurationMs = events.reduce((sum, event) => sum + (event.durationMs ?? 0), 0);
  const failedEvents = events.filter((event) => event.status === "error").length;
  const failureInsights = inspectFailures(events);
  const sourceMetadata = getSourceMetadata(events);

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <Link className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline" href={localizedHref("/runs", locale)}>
              {text.detail.back}
            </Link>
            <LanguageSwitcher locale={locale} path={`/runs/${id}`} />
          </div>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Trace Detail</p>
              <h1 className="mt-1 break-all font-mono text-xl font-semibold text-stone-950">{id}</h1>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <SummaryPill label={text.detail.steps} value={events.length.toString()} />
              <SummaryPill label={text.common.tokens} value={totalTokens.toLocaleString()} />
              <SummaryPill label={text.detail.errors} value={failedEvents.toString()} />
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-stone-950">{text.detail.timeline}</h2>
            <p className="mt-1 text-xs text-stone-500">{text.detail.timelineHelp}</p>
          </div>

          {error ? <ErrorState message={error} locale={locale} /> : null}
          {!error && events.length === 0 ? <EmptyState locale={locale} /> : null}
          {!error && events.length > 0 ? <Timeline events={events} locale={locale} /> : null}
        </div>

        <aside className="h-fit border border-stone-200 bg-white px-4 py-4 shadow-sm">
          <h2 className="text-sm font-semibold text-stone-950">{text.detail.summary}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <SummaryRow label={text.common.collector} value={collectorUrl} />
            <SummaryRow label="Agent" value={formatAgent(sourceMetadata.agent ?? "manual", locale)} />
            <SummaryRow label={text.detail.surface} value={formatSurface(sourceMetadata.surface, locale) ?? "-"} />
            <SummaryRow label={text.detail.session} value={sourceMetadata.sessionId ?? "-"} />
            <SummaryRow label={text.detail.redaction} value={formatRedaction(sourceMetadata.redactionLevel, locale) ?? "-"} />
            <SummaryRow label={text.detail.totalDuration} value={formatDuration(totalDurationMs)} />
            <SummaryRow label={text.detail.failedSteps} value={failedEvents.toString()} />
            <SummaryRow label={text.detail.tokenUsage} value={totalTokens.toLocaleString()} />
          </dl>

          <div className="mt-6 border-t border-stone-200 pt-4">
            <h2 className="text-sm font-semibold text-stone-950">{text.detail.failureInspector}</h2>
            {failureInsights.length > 0 ? (
              <div className="mt-3 space-y-3">
                {failureInsights.map((insight) => (
                  <div key={`${insight.eventName}-${insight.title}`} className="border border-red-100 bg-red-50 px-3 py-3">
                    <div className="text-sm font-semibold text-red-950">{formatFailureTitle(insight.title, locale)}</div>
                    <div className="mt-1 text-xs text-red-800">
                      {insight.eventName} - {insight.eventType}
                    </div>
                    <p className="mt-2 text-sm text-red-900">{formatFailureReason(insight.reason, locale)}</p>
                    <p className="mt-2 text-sm text-red-950">{formatFailureSuggestion(insight.suggestion, locale)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-stone-500">{text.detail.noFailures}</p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

async function getEvents(runId: string, locale: Locale): Promise<{ events: TraceEvent[]; error?: string }> {
  try {
    const response = await fetch(`${collectorUrl}/runs/${runId}/events`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        events: [],
        error: locale === "zh" ? `Collector \u8fd4\u56de ${response.status}` : `Collector returned ${response.status}`
      };
    }

    return {
      events: (await response.json()) as TraceEvent[]
    };
  } catch (err) {
    return {
      events: [],
      error: err instanceof Error ? err.message : locale === "zh" ? "Collector \u65e0\u6cd5\u8bbf\u95ee" : "Collector is unreachable"
    };
  }
}

function Timeline({ events, locale }: { events: TraceEvent[]; locale: Locale }) {
  const text = copy[locale];

  return (
    <ol className="divide-y divide-stone-100">
      {events.map((event, index) => (
        <li key={event.id} className="grid gap-4 px-4 py-4 md:grid-cols-[180px_minmax(0,1fr)]">
          <div className="text-xs text-stone-500">
            <div className="font-mono">{formatClockTime(event.timestamp, locale)}</div>
            <div className="mt-1">
              {text.detail.step} {index + 1}
            </div>
          </div>

          <article className="relative border-l-2 border-stone-200 pl-4">
            <span className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${dotClass(event.status)}`} />
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-stone-950">{event.name}</h3>
                  <span className="bg-stone-100 px-2 py-1 font-mono text-xs text-stone-600">
                    {formatEventType(event.type, locale)}
                  </span>
                  <StatusBadge status={event.status} locale={locale} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-500">
                  <span>{event.durationMs ?? 0}ms</span>
                  {event.metadata?.agent ? <SourceBadge agent={event.metadata.agent} locale={locale} /> : null}
                  {event.metadata?.hookEvent ? <MetadataBadge value={event.metadata.hookEvent} /> : null}
                  {event.metadata?.permissionMode ? <MetadataBadge value={event.metadata.permissionMode} /> : null}
                  {event.metadata?.provider ? <span>{event.metadata.provider}</span> : null}
                  {event.metadata?.model ? <span>{event.metadata.model}</span> : null}
                  {event.metadata?.tokenUsage ? (
                    <span>{event.metadata.tokenUsage.total.toLocaleString()} tokens</span>
                  ) : null}
                </div>
                {hasTraceIds(event) ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-500">
                    {event.metadata?.sessionId ? <TraceId label="session" value={event.metadata.sessionId} /> : null}
                    {event.metadata?.turnId ? <TraceId label="turn" value={event.metadata.turnId} /> : null}
                    {event.metadata?.promptId ? <TraceId label="prompt" value={event.metadata.promptId} /> : null}
                    {event.metadata?.toolUseId ? <TraceId label="tool" value={event.metadata.toolUseId} /> : null}
                  </div>
                ) : null}
              </div>
              <div className="font-mono text-xs text-stone-400">{event.id}</div>
            </div>

            {event.error ? (
              <div className="mt-3 border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-900">
                {event.error.message}
              </div>
            ) : null}

            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-teal-700">{text.common.jsonDetail}</summary>
              <pre className="mt-2 max-h-[420px] overflow-auto bg-stone-950 p-3 text-xs text-stone-50">
                {JSON.stringify(
                  {
                    input: event.input,
                    output: event.output,
                    error: event.error,
                    metadata: event.metadata
                  },
                  null,
                  2
                )}
              </pre>
            </details>
          </article>
        </li>
      ))}
    </ol>
  );
}

function getSourceMetadata(events: TraceEvent[]): NonNullable<TraceEvent["metadata"]> {
  return events.find((event) => event.metadata?.agent)?.metadata ?? {};
}

function hasTraceIds(event: TraceEvent) {
  return Boolean(
    event.metadata?.sessionId ||
      event.metadata?.turnId ||
      event.metadata?.promptId ||
      event.metadata?.toolUseId
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
    <span className={`inline-flex border px-2 py-0.5 font-mono text-xs font-medium ${className}`}>
      {formatAgent(agent, locale)}
    </span>
  );
}

function MetadataBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex border border-stone-200 bg-white px-2 py-0.5 font-mono text-xs text-stone-700">
      {value}
    </span>
  );
}

function TraceId({ label, value }: { label: string; value: string }) {
  return (
    <span className="max-w-full truncate font-mono">
      {label}:{value}
    </span>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-stone-200 bg-stone-50 px-3 py-2 text-right">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 font-semibold text-stone-950">{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs text-stone-950">{value}</dd>
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
      <h3 className="text-sm font-semibold text-stone-950">{text.detail.emptyTitle}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{text.detail.emptyBody}</p>
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

function dotClass(status: string) {
  if (status === "success") {
    return "bg-emerald-500";
  }

  if (status === "error") {
    return "bg-red-500";
  }

  return "bg-amber-500";
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatFailureTitle(value: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    zh: {
      "Tool Timeout": "\u5de5\u5177\u8d85\u65f6",
      "Invalid JSON": "JSON \u65e0\u6548",
      "Token Budget Pressure": "\u4e0a\u4e0b\u6587\u9884\u7b97\u538b\u529b",
      "Unknown Error": "\u672a\u77e5\u9519\u8bef"
    },
    en: {}
  };

  return labels[locale][value] ?? value;
}

function formatFailureReason(value: string, locale: Locale) {
  if (locale === "en") {
    return value;
  }

  const labels: Record<string, string> = {
    "The step failed while waiting for an external operation to finish.":
      "\u8be5\u6b65\u9aa4\u7b49\u5f85\u5916\u90e8\u64cd\u4f5c\u5b8c\u6210\u65f6\u5931\u8d25\u3002",
    "The model or tool returned content that could not be parsed as JSON.":
      "\u6a21\u578b\u6216\u5de5\u5177\u8fd4\u56de\u4e86\u65e0\u6cd5\u89e3\u6790\u4e3a JSON \u7684\u5185\u5bb9\u3002",
    "The step likely exceeded the model or prompt context budget.":
      "\u8be5\u6b65\u9aa4\u53ef\u80fd\u8d85\u51fa\u4e86\u6a21\u578b\u6216\u63d0\u793a\u8bcd\u7684\u4e0a\u4e0b\u6587\u9884\u7b97\u3002",
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
      "\u53ef\u4ee5\u63d0\u9ad8\u8d85\u65f6\u65f6\u95f4\u3001\u589e\u52a0\u91cd\u8bd5\u903b\u8f91\uff0c\u6216\u63d0\u4f9b\u5907\u7528\u5de5\u5177\u3002",
    "Use schema validation and ask the model to return strict JSON.":
      "\u53ef\u4ee5\u52a0\u5165 schema \u6821\u9a8c\uff0c\u5e76\u8981\u6c42\u6a21\u578b\u8fd4\u56de\u4e25\u683c JSON\u3002",
    "Summarize earlier context, trim retrieved evidence, or split the task into smaller runs.":
      "\u53ef\u4ee5\u603b\u7ed3\u65e9\u671f\u4e0a\u4e0b\u6587\u3001\u88c1\u526a\u68c0\u7d22\u8bc1\u636e\uff0c\u6216\u628a\u4efb\u52a1\u62c6\u6210\u66f4\u5c0f\u7684\u8fd0\u884c\u3002",
    "Inspect the input, output, stack trace, and preceding steps.":
      "\u5efa\u8bae\u68c0\u67e5\u8f93\u5165\u3001\u8f93\u51fa\u3001\u5806\u6808\u548c\u524d\u7f6e\u6b65\u9aa4\u3002"
  };

  return labels[value] ?? value;
}
