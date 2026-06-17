import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle2, Hash, Zap, Clock } from "lucide-react";

import { SourceBadge, StatusBadge, EmptyState, ErrorState, LanguageSwitcher } from "~/components";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";
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
} from "~/lib/i18n";
import { inspectFailures } from "./failure-inspector";

export const dynamic = "force-dynamic";

type TraceEvent = {
  id: string; runId: string; parentId?: string; type: string; name: string;
  status: "running" | "success" | "error" | string;
  timestamp: string; durationMs?: number;
  input?: unknown; output?: unknown;
  error?: { message: string; stack?: string; code?: string };
  metadata?: {
    agent?: string; surface?: string; sessionId?: string; turnId?: string;
    promptId?: string; toolUseId?: string; hookEvent?: string; permissionMode?: string;
    redactionLevel?: string; provider?: string; model?: string;
    tokenUsage?: { input: number; output: number; total: number };
    [key: string]: unknown;
  };
};

type DetailSearchParams = Promise<{ lang?: string | string[] }>;

const collectorUrl = process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export default async function RunDetailPage({
  params, searchParams
}: { params: Promise<{ id: string }>; searchParams: DetailSearchParams }) {
  const { id } = await params;
  const locale = parseLocale((await searchParams).lang);
  const text = copy[locale];
  const { events, error } = await getEvents(id, locale);
  const totalTokens = events.reduce((s, e) => s + (e.metadata?.tokenUsage?.total ?? 0), 0);
  const totalDurationMs = events.reduce((s, e) => s + (e.durationMs ?? 0), 0);
  const failedEvents = events.filter((e) => e.status === "error").length;
  const failureInsights = inspectFailures(events);
  const sourceMetadata = getSourceMetadata(events);

  return (
    <main id="main-content" className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href={localizedHref("/runs", locale)}>
                <ArrowLeft className="h-4 w-4" />
                {text.detail.back}
              </Link>
            </Button>
            <LanguageSwitcher locale={locale} path={`/runs/${id}`} />
          </div>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Trace Detail
              </p>
              <h1 className="mt-1 break-all font-mono text-lg font-semibold tracking-tight text-foreground">
                {id}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <MiniStat icon={Hash} label={text.detail.steps} value={events.length} />
              <MiniStat icon={Zap} label={text.common.tokens} value={totalTokens.toLocaleString()} />
              <MiniStat icon={AlertTriangle} label={text.detail.errors} value={failedEvents} accent="danger" />
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── Timeline ── */}
        <Card className="overflow-hidden border-border/60 shadow-sm">
          <div className="border-b border-border/60 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">{text.detail.timeline}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{text.detail.timelineHelp}</p>
          </div>
          {error ? <ErrorState message={error} locale={locale} /> : null}
          {!error && events.length === 0 ? (
            <EmptyState locale={locale} title={text.detail.emptyTitle} body={text.detail.emptyBody} />
          ) : null}
          {!error && events.length > 0 ? <Timeline events={events} locale={locale} /> : null}
        </Card>

        {/* ── Sidebar ── */}
        <aside className="flex flex-col gap-4">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="px-4 py-4">
              <h2 className="text-sm font-semibold text-foreground">{text.detail.summary}</h2>
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
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="px-4 py-4">
              <h2 className="text-sm font-semibold text-foreground">{text.detail.failureInspector}</h2>
              {failureInsights.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {failureInsights.map((insight) => (
                    <div
                      key={`${insight.eventName}-${insight.title}`}
                      className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                        <div className="text-sm font-semibold text-destructive">
                          {formatFailureTitle(insight.title, locale)}
                        </div>
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {insight.eventName} — {insight.eventType}
                      </div>
                      <p className="mt-2 text-sm text-foreground/80">
                        {formatFailureReason(insight.reason, locale)}
                      </p>
                      <p className="mt-1 text-sm font-medium text-primary">
                        {formatFailureSuggestion(insight.suggestion, locale)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{text.detail.noFailures}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </section>
    </main>
  );
}

async function getEvents(runId: string, locale: Locale): Promise<{ events: TraceEvent[]; error?: string }> {
  try {
    const response = await fetch(`${collectorUrl}/runs/${runId}/events`, { cache: "no-store" });
    if (!response.ok) {
      return { events: [], error: locale === "zh" ? `Collector 返回 ${response.status}` : `Collector returned ${response.status}` };
    }
    return { events: (await response.json()) as TraceEvent[] };
  } catch (err) {
    return { events: [], error: err instanceof Error ? err.message : locale === "zh" ? "Collector 无法访问" : "Collector is unreachable" };
  }
}

/* ── Mini Stat ── */
function MiniStat({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string | number;
  accent?: "danger";
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2",
      accent === "danger" && "border-destructive/20 bg-destructive/5 dark:bg-destructive/5"
    )}>
      <Icon className={cn("h-4 w-4 text-muted-foreground", accent === "danger" && "text-destructive")} />
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn("text-sm font-semibold tabular-nums", accent === "danger" && "text-destructive")}>
          {value}
        </div>
      </div>
    </div>
  );
}

/* ── Timeline ── */
function Timeline({ events, locale }: { events: TraceEvent[]; locale: Locale }) {
  const text = copy[locale];
  return (
    <ol className="divide-y divide-border/40">
      {events.map((event, index) => (
        <li key={event.id} className="grid gap-4 px-5 py-4 transition-colors hover:bg-muted/30 md:grid-cols-[160px_minmax(0,1fr)]">
          <div className="text-xs text-muted-foreground">
            <div className="font-mono font-medium text-foreground/80">{formatClockTime(event.timestamp, locale)}</div>
            <div className="mt-0.5">
              {text.detail.step} {index + 1}
            </div>
          </div>

          <article className="relative border-l-2 border-border/60 pl-4">
            <span className={cn(
              "absolute -left-[7px] top-1 h-3 w-3 rounded-full border-2 border-card ring-2",
              dotClass(event.status)
            )} />
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{event.name}</h3>
                  <span className="rounded-md bg-muted/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {formatEventType(event.type, locale)}
                  </span>
                  <StatusBadge status={event.status} locale={locale} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono tabular-nums">{event.durationMs ?? 0}ms</span>
                  {event.metadata?.agent && <SourceBadge agent={event.metadata.agent} locale={locale} />}
                  {event.metadata?.hookEvent && <MetadataBadge value={event.metadata.hookEvent} />}
                  {event.metadata?.permissionMode && <MetadataBadge value={event.metadata.permissionMode} />}
                  {event.metadata?.provider && <span>{event.metadata.provider}</span>}
                  {event.metadata?.model && <span className="font-mono">{event.metadata.model}</span>}
                  {event.metadata?.tokenUsage && (
                    <span className="font-mono tabular-nums">{event.metadata.tokenUsage.total.toLocaleString()} tokens</span>
                  )}
                </div>
                {hasTraceIds(event) && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground/70">
                    {event.metadata?.sessionId && <TraceId label="session" value={event.metadata.sessionId} />}
                    {event.metadata?.turnId && <TraceId label="turn" value={event.metadata.turnId} />}
                    {event.metadata?.promptId && <TraceId label="prompt" value={event.metadata.promptId} />}
                    {event.metadata?.toolUseId && <TraceId label="tool" value={event.metadata.toolUseId} />}
                  </div>
                )}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground/50 shrink-0">{event.id}</div>
            </div>

            {event.error && (
              <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {event.error.message}
              </div>
            )}

            <details className="mt-3 group">
              <summary className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent">
                {text.common.jsonDetail}
              </summary>
              <pre className="mt-2 max-h-[420px] overflow-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100 dark:bg-black">
                {JSON.stringify({ input: event.input, output: event.output, error: event.error, metadata: event.metadata }, null, 2)}
              </pre>
            </details>
          </article>
        </li>
      ))}
    </ol>
  );
}

function getSourceMetadata(events: TraceEvent[]): NonNullable<TraceEvent["metadata"]> {
  return events.find((e) => e.metadata?.agent)?.metadata ?? {};
}
function hasTraceIds(e: TraceEvent) { return Boolean(e.metadata?.sessionId || e.metadata?.turnId || e.metadata?.promptId || e.metadata?.toolUseId); }

function MetadataBadge({ value }: { value: string }) {
  return <span className="inline-flex rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{value}</span>;
}
function TraceId({ label, value }: { label: string; value: string }) {
  return <span className="max-w-[200px] truncate">{label}:{value}</span>;
}
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}
function dotClass(status: string) {
  if (status === "success") return "bg-emerald-500 ring-emerald-500/20";
  if (status === "error") return "bg-red-500 ring-red-500/20";
  return "bg-amber-500 ring-amber-500/20";
}
function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
function formatFailureTitle(value: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    zh: { "Tool Timeout": "工具超时", "Invalid JSON": "JSON 无效", "Token Budget Pressure": "上下文预算压力", "Unknown Error": "未知错误" }, en: {}
  };
  return labels[locale][value] ?? value;
}
function formatFailureReason(value: string, locale: Locale) {
  if (locale === "en") return value;
  const m: Record<string, string> = {
    "The step failed while waiting for an external operation to finish.": "该步骤等待外部操作完成时失败。",
    "The model or tool returned content that could not be parsed as JSON.": "模型或工具返回了无法解析为 JSON 的内容。",
    "The step likely exceeded the model or prompt context budget.": "该步骤可能超出了模型或提示词的上下文预算。",
    "The step failed without a recognizable error signature.": "该步骤失败了，但没有可识别的错误特征。"
  };
  return m[value] ?? value;
}
function formatFailureSuggestion(value: string, locale: Locale) {
  if (locale === "en") return value;
  const m: Record<string, string> = {
    "Increase the timeout, add retry logic, or provide a fallback tool.": "可以提高超时时间、增加重试逻辑，或提供备用工具。",
    "Use schema validation and ask the model to return strict JSON.": "可以加入 schema 校验，并要求模型返回严格 JSON。",
    "Summarize earlier context, trim retrieved evidence, or split the task into smaller runs.": "可以总结早期上下文、裁剪检索证据，或把任务拆成更小的运行。",
    "Inspect the input, output, stack trace, and preceding steps.": "建议检查输入、输出、堆栈和前置步骤。"
  };
  return m[value] ?? value;
}
