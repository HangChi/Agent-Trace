import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Hash, Zap } from "lucide-react";

import { EmptyState, ErrorState, LanguageSwitcher, SourceBadge, StatusBadge } from "~/components";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
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
import { cn } from "~/lib/utils";
import { AutoRefresh } from "../run-controls";
import { inspectFailures } from "./failure-inspector";

export const dynamic = "force-dynamic";

type TokenUsage = {
  input: number;
  output: number;
  total: number;
  cachedInput?: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
  reasoningOutput?: number;
  source?: string;
};

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
  error?: { message: string; stack?: string; code?: string };
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
    category?: string;
    command?: string;
    toolName?: string;
    toolKind?: string;
    mcpServer?: string;
    mcpTool?: string;
    skillName?: string;
    tokenUsage?: TokenUsage;
    [key: string]: unknown;
  };
};

type DetailSearchParams = Promise<{ lang?: string | string[] }>;

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
  const displayEvents = events.filter(isDisplayEvent);
  const hiddenEvents = Math.max(events.length - displayEvents.length, 0);
  const totalTokens = events.reduce((sum, event) => sum + (event.metadata?.tokenUsage?.total ?? 0), 0);
  const totalDurationMs = events.reduce((sum, event) => sum + (event.durationMs ?? 0), 0);
  const failedEvents = events.filter((event) => event.status === "error").length;
  const failureInsights = inspectFailures(events);
  const sourceMetadata = getSourceMetadata(events);

  return (
    <main id="main-content" className="min-h-screen bg-background">
      <AutoRefresh />
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
            <div className="flex flex-wrap items-center gap-2">
              <MiniStat icon={Hash} label={text.detail.steps} value={displayEvents.length} />
              <MiniStat icon={Zap} label={text.common.tokens} value={totalTokens.toLocaleString()} />
              <MiniStat icon={AlertTriangle} label={text.detail.errors} value={failedEvents} accent="danger" />
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden border-border/60 shadow-sm">
          <div className="border-b border-border/60 px-5 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{text.detail.timeline}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{text.detail.timelineHelp}</p>
              </div>
              {hiddenEvents > 0 ? (
                <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                  {text.detail.hiddenEvents}: {hiddenEvents}
                </span>
              ) : null}
            </div>
          </div>
          {error ? <ErrorState message={error} locale={locale} /> : null}
          {!error && displayEvents.length === 0 ? (
            <EmptyState locale={locale} title={text.detail.emptyTitle} body={text.detail.emptyBody} />
          ) : null}
          {!error && displayEvents.length > 0 ? <Timeline events={displayEvents} locale={locale} /> : null}
        </Card>

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
                        {insight.eventName} / {insight.eventType}
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
      return {
        events: [],
        error:
          locale === "zh"
            ? `Collector 返回 ${response.status}`
            : `Collector returned ${response.status}`
      };
    }

    return { events: (await response.json()) as TraceEvent[] };
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
        "flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2",
        accent === "danger" && "border-destructive/20 bg-destructive/5 dark:bg-destructive/5"
      )}
    >
      <Icon className={cn("h-4 w-4 text-muted-foreground", accent === "danger" && "text-destructive")} />
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className={cn("text-sm font-semibold tabular-nums", accent === "danger" && "text-destructive")}>
          {value}
        </div>
      </div>
    </div>
  );
}

function Timeline({ events, locale }: { events: TraceEvent[]; locale: Locale }) {
  const text = copy[locale];

  return (
    <ol className="divide-y divide-border/40">
      {events.map((event, index) => (
        <li
          key={event.id}
          className="grid gap-4 px-5 py-4 transition-colors hover:bg-muted/30 md:grid-cols-[160px_minmax(0,1fr)]"
        >
          <div className="text-xs text-muted-foreground">
            <div className="font-mono font-medium text-foreground/80">
              {formatClockTime(event.timestamp, locale)}
            </div>
            <div className="mt-0.5">
              {text.detail.step} {index + 1}
            </div>
          </div>

          <article className="relative border-l-2 border-border/60 pl-4">
            <span
              className={cn(
                "absolute -left-[7px] top-1 h-3 w-3 rounded-full border-2 border-card ring-2",
                dotClass(event.status)
              )}
            />
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{event.name}</h3>
                  <span className="rounded-md bg-muted/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {formatEventType(event.type, locale)}
                  </span>
                  <StatusBadge status={event.status} locale={locale} />
                  <CategoryBadge event={event} locale={locale} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono tabular-nums">{event.durationMs ?? 0}ms</span>
                  {event.metadata?.agent ? <SourceBadge agent={event.metadata.agent} locale={locale} /> : null}
                  {event.metadata?.hookEvent ? <MetadataBadge value={event.metadata.hookEvent} /> : null}
                  {event.metadata?.provider ? <span>{event.metadata.provider}</span> : null}
                  {event.metadata?.model ? <span className="font-mono">{event.metadata.model}</span> : null}
                </div>
                <EventPrimaryDetail event={event} />
                {hasTraceIds(event) ? (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground/70">
                    {event.metadata?.sessionId ? <TraceId label="session" value={event.metadata.sessionId} /> : null}
                    {event.metadata?.turnId ? <TraceId label="turn" value={event.metadata.turnId} /> : null}
                    {event.metadata?.promptId ? <TraceId label="prompt" value={event.metadata.promptId} /> : null}
                    {event.metadata?.toolUseId ? <TraceId label="tool" value={event.metadata.toolUseId} /> : null}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 font-mono text-[10px] text-muted-foreground/50">{event.id}</div>
            </div>

            {event.error ? (
              <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {event.error.message}
              </div>
            ) : null}

            <details className="group mt-3">
              <summary className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent">
                {text.common.jsonDetail}
              </summary>
              <pre className="mt-2 max-h-[420px] overflow-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100 dark:bg-black">
                {JSON.stringify(
                  { input: event.input, output: event.output, error: event.error, metadata: event.metadata },
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

function EventPrimaryDetail({ event }: { event: TraceEvent }) {
  const command = event.metadata?.command ?? getObjectString(event.input, "command");
  const tokenUsage = event.metadata?.tokenUsage;
  const skillName = event.metadata?.skillName;
  const mcp = event.metadata?.mcpServer && event.metadata?.mcpTool
    ? `${event.metadata.mcpServer}.${event.metadata.mcpTool}`
    : undefined;

  if (command) {
    return (
      <pre className="mt-3 overflow-x-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2 font-mono text-xs text-foreground">
        {command}
      </pre>
    );
  }

  if (tokenUsage?.total) {
    return (
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-xs tabular-nums">
        <MetadataBadge value={`total ${tokenUsage.total.toLocaleString()}`} />
        <MetadataBadge value={`in ${(tokenUsage.input ?? 0).toLocaleString()}`} />
        <MetadataBadge value={`out ${(tokenUsage.output ?? 0).toLocaleString()}`} />
        {tokenUsage.cachedInput ? <MetadataBadge value={`cached ${tokenUsage.cachedInput.toLocaleString()}`} /> : null}
        {tokenUsage.reasoningOutput ? (
          <MetadataBadge value={`reasoning ${tokenUsage.reasoningOutput.toLocaleString()}`} />
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

function CategoryBadge({ event, locale }: { event: TraceEvent; locale: Locale }) {
  const labels: Record<string, string> = {
    command: locale === "zh" ? "命令" : "command",
    tool: locale === "zh" ? "工具" : "tool",
    mcp: "MCP",
    skill: "skill",
    tokens: "tokens"
  };
  const category = event.metadata?.category;

  if (!category || !(category in labels)) {
    return null;
  }

  return (
    <span className="rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {labels[category]}
    </span>
  );
}

function isDisplayEvent(event: TraceEvent) {
  const category = event.metadata?.category;

  return (
    category === "command" ||
    category === "tool" ||
    category === "mcp" ||
    category === "skill" ||
    category === "tokens" ||
    event.metadata?.tokenUsage !== undefined
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
    <span className="inline-flex rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {value}
    </span>
  );
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
  if (status === "success") {
    return "bg-emerald-500 ring-emerald-500/20";
  }

  if (status === "error") {
    return "bg-red-500 ring-red-500/20";
  }

  return "bg-amber-500 ring-amber-500/20";
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
