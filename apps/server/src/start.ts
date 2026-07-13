import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { initializeDatabase, reconcileStaleRuns } from "./storage.js";

const staleRunReconciliationIntervalMs = 60_000;

type CollectorDependencies = {
  reconcileStaleRuns?: () => Promise<unknown>;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
};

export function getCollectorPort() {
  return Number(
    process.env.PORT ??
      process.env.AGENT_TRACE_SERVER_PORT ??
      process.env.TOOLTRACE_SERVER_PORT ??
      4319
  );
}

export function getCollectorHostname(): string {
  return (
    process.env.AGENT_TRACE_SERVER_HOST ||
    process.env.TOOLTRACE_SERVER_HOST ||
    "127.0.0.1"
  );
}

export function startCollector(
  port = getCollectorPort(),
  dependencies: CollectorDependencies = {}
) {
  initializeDatabase();
  const hostname = getCollectorHostname();
  const reconcileStale = dependencies.reconcileStaleRuns ?? reconcileStaleRuns;
  const reconcile = () => {
    void reconcileStale().catch((error) => {
      console.error("Agent-Trace stale-run reconciliation failed:", error);
    });
  };

  reconcile();
  const reconciliationTimer = (dependencies.setInterval ?? setInterval)(
    reconcile,
    staleRunReconciliationIntervalMs
  );
  reconciliationTimer.unref();
  const server = serve({
    fetch: createApp().fetch,
    port,
    hostname
  });

  console.log(`Agent-Trace server running at http://${hostname}:${port}`);

  server.once("close", () =>
    (dependencies.clearInterval ?? clearInterval)(reconciliationTimer)
  );

  return server;
}
