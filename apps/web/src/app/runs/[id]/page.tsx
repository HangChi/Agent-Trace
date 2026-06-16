import Link from "next/link";

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

const collectorUrl = process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export default async function RunDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { events, error } = await getEvents(id);
  const totalTokens = events.reduce((sum, event) => sum + (event.metadata?.tokenUsage?.total ?? 0), 0);
  const totalDurationMs = events.reduce((sum, event) => sum + (event.durationMs ?? 0), 0);
  const failedEvents = events.filter((event) => event.status === "error").length;

  return (
    <main className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-4">
          <Link className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline" href="/runs">
            Back to runs
          </Link>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Run timeline</p>
              <h1 className="mt-1 break-all font-mono text-xl font-semibold text-stone-950">{id}</h1>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <SummaryPill label="Steps" value={events.length.toString()} />
              <SummaryPill label="Tokens" value={totalTokens.toLocaleString()} />
              <SummaryPill label="Errors" value={failedEvents.toString()} />
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-stone-950">Trace steps</h2>
            <p className="mt-1 text-xs text-stone-500">LLM calls, tool calls, outputs, metadata, and errors in order.</p>
          </div>

          {error ? <ErrorState message={error} /> : null}
          {!error && events.length === 0 ? <EmptyState /> : null}
          {!error && events.length > 0 ? <Timeline events={events} /> : null}
        </div>

        <aside className="h-fit border border-stone-200 bg-white px-4 py-4">
          <h2 className="text-sm font-semibold text-stone-950">Run summary</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <SummaryRow label="Collector" value={collectorUrl} />
            <SummaryRow label="Total duration" value={formatDuration(totalDurationMs)} />
            <SummaryRow label="Failed steps" value={failedEvents.toString()} />
            <SummaryRow label="Token usage" value={totalTokens.toLocaleString()} />
          </dl>
        </aside>
      </section>
    </main>
  );
}

async function getEvents(runId: string): Promise<{ events: TraceEvent[]; error?: string }> {
  try {
    const response = await fetch(`${collectorUrl}/runs/${runId}/events`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        events: [],
        error: `Collector returned ${response.status}`
      };
    }

    return {
      events: (await response.json()) as TraceEvent[]
    };
  } catch (err) {
    return {
      events: [],
      error: err instanceof Error ? err.message : "Collector is unreachable"
    };
  }
}

function Timeline({ events }: { events: TraceEvent[] }) {
  return (
    <ol className="divide-y divide-stone-100">
      {events.map((event, index) => (
        <li key={event.id} className="grid gap-4 px-4 py-4 md:grid-cols-[180px_minmax(0,1fr)]">
          <div className="text-xs text-stone-500">
            <div className="font-mono">{formatTime(event.timestamp)}</div>
            <div className="mt-1">Step {index + 1}</div>
          </div>

          <article className="relative border-l-2 border-stone-200 pl-4">
            <span className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${dotClass(event.status)}`} />
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-stone-950">{event.name}</h3>
                  <span className="rounded bg-stone-100 px-2 py-1 font-mono text-xs text-stone-600">
                    {event.type}
                  </span>
                  <StatusBadge status={event.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-500">
                  <span>{event.durationMs ?? 0}ms</span>
                  {event.metadata?.provider ? <span>{event.metadata.provider}</span> : null}
                  {event.metadata?.model ? <span>{event.metadata.model}</span> : null}
                  {event.metadata?.tokenUsage ? (
                    <span>{event.metadata.tokenUsage.total.toLocaleString()} tokens</span>
                  ) : null}
                </div>
              </div>
              <div className="font-mono text-xs text-stone-400">{event.id}</div>
            </div>

            {event.error ? (
              <div className="mt-3 border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-900">
                {event.error.message}
              </div>
            ) : null}

            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-teal-700">JSON detail</summary>
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
      <dt className="text-xs uppercase tracking-[0.14em] text-stone-500">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs text-stone-950">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "success"
      ? "bg-emerald-100 text-emerald-800"
      : status === "error"
        ? "bg-red-100 text-red-800"
        : "bg-amber-100 text-amber-800";

  return <span className={`rounded px-2 py-1 text-xs font-medium ${className}`}>{status}</span>;
}

function EmptyState() {
  return (
    <div className="px-4 py-12 text-center">
      <h3 className="text-sm font-semibold text-stone-950">No events captured for this run</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
        The collector has a run id, but no LLM or tool steps were recorded yet.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="border-t border-red-100 bg-red-50 px-4 py-4 text-sm text-red-900">
      Collector unavailable: {message}
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
