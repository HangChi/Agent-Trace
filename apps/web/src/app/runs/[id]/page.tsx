import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";

import { SourceBadge, StatusBadge, EmptyState, ErrorState } from "../../components";
import {
  copy,
  formatAgent,
  formatClockTime,
  formatEventType,
  formatRedaction,
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
  const totalTokens = events.reduce(
    (sum, event) => sum + (event.metadata?.tokenUsage?.total ?? 0),
    0
  );
  const totalDurationMs = events.reduce((sum, event) => sum + (event.durationMs ?? 0), 0);
  const failedEvents = events.filter((event) => event.status === "error").length;
  const failureInsights = inspectFailures(events);
  const sourceMetadata = getSourceMetadata(events);

  return (
    <main
      id="main-content"
      className="min-h-screen bg-[var(--color-canvas)] transition-colors duration-300"
    >
      <header className="border-b border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] transition-colors duration-300">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <Link
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-accent)] underline-offset-4 transition-colors duration-150 hover:underline"
              href={localizedHref("/runs", locale)}
            >
              <ArrowLeft aria-hidden className="h-4 w-4" />
              {text.detail.back}
            </Link>
            <LanguageSwitcher locale={locale} path={`/runs/${id}`} />
          </div>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                Trace Detail
              </p>
              <h1 className="mt-1 break-all font-mono text-xl font-semibold text-[var(--color-foreground-primary)]">
                {id}
              </h1>
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
        <div className="border border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] shadow-[var(--shadow-card)] transition-colors duration-300">
          <div className="border-b border-[var(--color-border-primary)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--color-foreground-primary)]">
              {text.detail.timeline}
            </h2>
            <p className="mt-1 text-xs text-[var(--color-foreground-tertiary)]">
              {text.detail.timelineHelp}
            </p>
          </div>

          {error ? <ErrorState message={error} locale={locale} /> : null}
          {!error && events.length === 0 ? (
            <EmptyState
              locale={locale}
              title={text.detail.emptyTitle}
              body={text.detail.emptyBody}
            />
          ) : null}
          {!error && events.length > 0 ? (
            <Timeline events={events} locale={locale} />
          ) : null}
        </div>

        <aside className="h-fit border border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] px-4 py-4 shadow-[var(--shadow-card)] transition-colors duration-300">
          <h2 className="text-sm font-semibold text-[var(--color-foreground-primary)]">
            {text.detail.summary}
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <SummaryRow label={text.common.collector} value={collectorUrl} />
            <SummaryRow
              label="Agent"
              value={formatAgent(sourceMetadata.agent ?? "manual", locale)}
            />
            <SummaryRow
              label={text.detail.surface}
              value={formatSurface(sourceMetadata.surface, locale) ?? "-"}
            />
            <SummaryRow
              label={text.detail.session}
              value={sourceMetadata.sessionId ?? "-"}
            />
            <SummaryRow
              label={text.detail.redaction}
              value={formatRedaction(sourceMetadata.redactionLevel, locale) ?? "-"}
            />
            <SummaryRow
              label={text.detail.totalDuration}
              value={formatDuration(totalDurationMs)}
            />
            <SummaryRow label={text.detail.failedSteps} value={failedEvents.toString()} />
            <SummaryRow
              label={text.detail.tokenUsage}
              value={totalTokens.toLocaleString()}
            />
          </dl>

          <div className="mt-6 border-t border-[var(--color-border-primary)] pt-4">
            <h2 className="text-sm font-semibold text-[var(--color-foreground-primary)]">
              {text.detail.failureInspector}
            </h2>
            {failureInsights.length > 0 ? (
              <div className="mt-3 space-y-3">
                {failureInsights.map((insight) => (
                  <div
                    key={`${insight.eventName}-${insight.title}`}
                    className="border border-[var(--color-error-border)] bg-[var(--color-error-subtle)] px-3 py-3 transition-colors duration-300"
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-[var(--color-error)]" />
                      <div className="text-sm font-semibold text-[var(--color-error)]">
                        {formatFailureTitle(insight.title, locale)}
                      </div>
                    </div>
                    <div className="mt-1 font-mono text-xs text-[var(--color-foreground-tertiary)]">
                      {insight.eventName} - {insight.eventType}
                    </div>
                    <p className="mt-2 text-sm text-[var(--color-foreground-secondary)]">
                      {formatFailureReason(insight.reason, locale)}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-accent)]">
                      {formatFailureSuggestion(insight.suggestion, locale)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 text-sm text-[var(--color-success)]">
                <CheckCircle2 aria-hidden className="h-4 w-4" />
                <span>{text.detail.noFailures}</span>
              </div>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

async function getEvents(
  runId: string,
  locale: Locale
): Promise<{ events: TraceEvent[]; error?: string }> {
  try {
    const response = await fetch(`${collectorUrl}/runs/${runId}/events`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        events: [],
        error:
          locale === "zh"
            ? `Collector 返回 ${response.status}`
            : `Collector returned ${response.status}`
      };
    }

    return {
      events: (await response.json()) as TraceEvent[]
    };
  } catch (err) {
    return {
      events: [],
      error:
        err instanceof Error
          ? err.message
          : locale === "zh"
            ? "Collector 无法访问"
            : "Collector is unreachable"
    };
  }
}

function Timeline({ events, locale }: { events: TraceEvent[]; locale: Locale }) {
  const text = copy[locale];

  return (
    <ol className="divide-y divide-[var(--color-border-secondary)]">
      {events.map((event, index) => (
        <li
          key={event.id}
          className="grid gap-4 px-4 py-4 transition-colors duration-150 hover:bg-[var(--color-surface-secondary)] md:grid-cols-[180px_minmax(0,1fr)]"
        >
          <div className="text-xs text-[var(--color-foreground-tertiary)]">
            <div className="font-mono">{formatClockTime(event.timestamp, locale)}</div>
            <div className="mt-1">
              {text.detail.step} {index + 1}
            </div>
          </div>

          <article className="relative border-l-2 border-[var(--color-border-primary)] pl-4">
            <span
              className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full border-2 border-[var(--color-surface-primary)] ${dotClass(event.status)} transition-colors duration-300`}
            />
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-[var(--color-foreground-primary)]">
                    {event.name}
                  </h3>
                  <span className="bg-[var(--color-surface-secondary)] px-2 py-1 font-mono text-xs text-[var(--color-foreground-secondary)] transition-colors duration-300">
                    {formatEventType(event.type, locale)}
                  </span>
                  <StatusBadge status={event.status} locale={locale} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--color-foreground-tertiary)]">
                  <span>{event.durationMs ?? 0}ms</span>
                  {event.metadata?.agent ? (
                    <SourceBadge agent={event.metadata.agent} locale={locale} />
                  ) : null}
                  {event.metadata?.hookEvent ? (
                    <MetadataBadge value={event.metadata.hookEvent} />
                  ) : null}
                  {event.metadata?.permissionMode ? (
                    <MetadataBadge value={event.metadata.permissionMode} />
                  ) : null}
                  {event.metadata?.provider ? <span>{event.metadata.provider}</span> : null}
                  {event.metadata?.model ? <span>{event.metadata.model}</span> : null}
                  {event.metadata?.tokenUsage ? (
                    <span>{event.metadata.tokenUsage.total.toLocaleString()} tokens</span>
                  ) : null}
                </div>
                {hasTraceIds(event) ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--color-foreground-tertiary)]">
                    {event.metadata?.sessionId ? (
                      <TraceId label="session" value={event.metadata.sessionId} />
                    ) : null}
                    {event.metadata?.turnId ? (
                      <TraceId label="turn" value={event.metadata.turnId} />
                    ) : null}
                    {event.metadata?.promptId ? (
                      <TraceId label="prompt" value={event.metadata.promptId} />
                    ) : null}
                    {event.metadata?.toolUseId ? (
                      <TraceId label="tool" value={event.metadata.toolUseId} />
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="font-mono text-xs text-[var(--color-foreground-tertiary)]">
                {event.id}
              </div>
            </div>

            {event.error ? (
              <div className="mt-3 border border-[var(--color-error-border)] bg-[var(--color-error-subtle)] px-3 py-2 text-sm text-[var(--color-error)] transition-colors duration-300">
                {event.error.message}
              </div>
            ) : null}

            <details className="mt-3 group">
              <summary className="cursor-pointer text-sm font-medium text-[var(--color-accent)] transition-colors duration-150 hover:text-[var(--color-accent-hover)]">
                {text.common.jsonDetail}
              </summary>
              <pre className="mt-2 max-h-[420px] overflow-auto bg-[var(--color-foreground-primary)] p-3 text-xs text-[var(--color-foreground-inverse)]">
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

function MetadataBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex border border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] px-2 py-0.5 font-mono text-xs text-[var(--color-foreground-secondary)] transition-colors duration-300">
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
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-surface-secondary)] px-3 py-2 text-right transition-colors duration-300">
      <div className="text-xs text-[var(--color-foreground-tertiary)]">{label}</div>
      <div className="mt-1 font-semibold text-[var(--color-foreground-primary)]">{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-foreground-tertiary)]">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs text-[var(--color-foreground-primary)]">
        {value}
      </dd>
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
      "Tool Timeout": "工具超时",
      "Invalid JSON": "JSON 无效",
      "Token Budget Pressure": "上下文预算压力",
      "Unknown Error": "未知错误"
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
      "该步骤等待外部操作完成时失败。",
    "The model or tool returned content that could not be parsed as JSON.":
      "模型或工具返回了无法解析为 JSON 的内容。",
    "The step likely exceeded the model or prompt context budget.":
      "该步骤可能超出了模型或提示词的上下文预算。",
    "The step failed without a recognizable error signature.":
      "该步骤失败了，但没有可识别的错误特征。"
  };

  return labels[value] ?? value;
}

function formatFailureSuggestion(value: string, locale: Locale) {
  if (locale === "en") {
    return value;
  }

  const labels: Record<string, string> = {
    "Increase the timeout, add retry logic, or provide a fallback tool.":
      "可以提高超时时间、增加重试逻辑，或提供备用工具。",
    "Use schema validation and ask the model to return strict JSON.":
      "可以加入 schema 校验，并要求模型返回严格 JSON。",
    "Summarize earlier context, trim retrieved evidence, or split the task into smaller runs.":
      "可以总结早期上下文、裁剪检索证据，或把任务拆成更小的运行。",
    "Inspect the input, output, stack trace, and preceding steps.":
      "建议检查输入、输出、堆栈和前置步骤。"
  };

  return labels[value] ?? value;
}
