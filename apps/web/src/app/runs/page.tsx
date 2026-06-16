import Link from "next/link";

export const dynamic = "force-dynamic";

type Run = {
  id: string;
  name: string;
  status: "running" | "success" | "error" | string;
  startedAt: string;
  endedAt?: string;
  error?: string;
};

const collectorUrl = process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export default async function RunsPage() {
  const { runs, error } = await getRuns();
  const totalRuns = runs.length;
  const failedRuns = runs.filter((run) => run.status === "error").length;
  const runningRuns = runs.filter((run) => run.status === "running").length;

  return (
    <main className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
              ToolTrace
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-stone-950">Runs</h1>
          </div>
          <div className="text-right text-xs text-stone-500">
            <div>Collector</div>
            <div className="mt-1 font-mono text-stone-900">{collectorUrl}</div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Total runs" value={totalRuns.toString()} tone="blue" />
          <Metric label="Running" value={runningRuns.toString()} tone="amber" />
          <Metric label="Failed" value={failedRuns.toString()} tone="red" />
        </div>

        <div className="mt-6 overflow-hidden border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-stone-950">Recent agent runs</h2>
              <p className="mt-1 text-xs text-stone-500">Latest traces captured by the local collector.</p>
            </div>
            <span className="rounded bg-stone-100 px-2 py-1 text-xs text-stone-600">
              {totalRuns} shown
            </span>
          </div>

          {error ? <ErrorState message={error} /> : null}
          {!error && runs.length === 0 ? <EmptyState /> : null}
          {!error && runs.length > 0 ? <RunsTable runs={runs} /> : null}
        </div>
      </section>
    </main>
  );
}

async function getRuns(): Promise<{ runs: Run[]; error?: string }> {
  try {
    const response = await fetch(`${collectorUrl}/runs`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        runs: [],
        error: `Collector returned ${response.status}`
      };
    }

    return {
      runs: (await response.json()) as Run[]
    };
  } catch (err) {
    return {
      runs: [],
      error: err instanceof Error ? err.message : "Collector is unreachable"
    };
  }
}

function RunsTable({ runs }: { runs: Run[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-[0.12em] text-stone-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Started</th>
            <th className="px-4 py-3 font-semibold">Duration</th>
            <th className="px-4 py-3 font-semibold">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {runs.map((run) => (
            <tr key={run.id} className="hover:bg-stone-50">
              <td className="px-4 py-3">
                <Link className="font-medium text-stone-950 underline-offset-4 hover:underline" href={`/runs/${run.id}`}>
                  {run.name}
                </Link>
                <div className="mt-1 font-mono text-xs text-stone-500">{run.id}</div>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={run.status} />
              </td>
              <td className="px-4 py-3 text-stone-700">{formatDate(run.startedAt)}</td>
              <td className="px-4 py-3 text-stone-700">{formatDuration(run.startedAt, run.endedAt)}</td>
              <td className="max-w-[260px] truncate px-4 py-3 text-stone-700">{run.error ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "amber" | "blue" | "red" }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-sky-200 bg-sky-50 text-sky-900",
    red: "border-red-200 bg-red-50 text-red-900"
  };

  return (
    <div className={`border px-4 py-3 ${tones[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-[0.14em] opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
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
      <h3 className="text-sm font-semibold text-stone-950">No runs captured yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
        Start the local collector and run an instrumented agent to populate this table.
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function formatDuration(startedAt: string, endedAt?: string) {
  if (!endedAt) {
    return "running";
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
