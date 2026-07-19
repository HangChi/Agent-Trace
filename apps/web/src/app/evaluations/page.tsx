import { DashboardApp } from "@agent-trace/dashboard-ui";

const collectorUrl = process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export default function EvaluationsPage() {
  return <DashboardApp apiBase={collectorUrl} initialPath="/evaluations" />;
}
