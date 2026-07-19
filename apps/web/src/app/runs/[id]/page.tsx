import { DashboardApp } from "@agent-trace/dashboard-ui";

const collectorUrl = process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DashboardApp apiBase={collectorUrl} initialPath={`/runs/${encodeURIComponent(id)}`} />;
}
