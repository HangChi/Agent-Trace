import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { initializeDatabase, reconcileStaleRuns } from "./storage.js";

const staleRunReconciliationIntervalMs = 60_000;
type CollectorServer = ReturnType<typeof serve>;

type CollectorDependencies = {
  reconcileStaleRuns?: () => Promise<unknown>;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  fetch?: typeof fetch;
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

export async function startCollector(
  port = getCollectorPort(),
  dependencies: CollectorDependencies = {}
): Promise<CollectorServer | null> {
  const hostname = getCollectorHostname();
  const collectorUrl = `http://${hostname}:${port}`;

  if (port !== 0 && await isCompatibleCollector(collectorUrl, dependencies.fetch ?? fetch)) {
    console.log(`Agent-Trace collector already running at ${collectorUrl}; reusing it.`);
    return null;
  }

  initializeDatabase();
  const reconcileStale = dependencies.reconcileStaleRuns ?? reconcileStaleRuns;
  const reconcile = () => {
    void reconcileStale().catch((error) => {
      console.error("Agent-Trace stale-run reconciliation failed:", error);
    });
  };

  const server = serve({
    fetch: createApp().fetch,
    port,
    hostname
  });

  try {
    await waitForListening(server);
  } catch (error) {
    if (
      isAddressInUseError(error) &&
      await isCompatibleCollector(collectorUrl, dependencies.fetch ?? fetch)
    ) {
      console.log(`Agent-Trace collector already running at ${collectorUrl}; reusing it.`);
      return null;
    }

    if (isAddressInUseError(error)) {
      throw new Error(
        `Cannot start Agent-Trace collector: ${hostname}:${port} is already used by another application. Close that application or set AGENT_TRACE_SERVER_PORT to a free port.`,
        { cause: error }
      );
    }

    throw error;
  }

  const address = server.address();
  const listeningPort = typeof address === "string" ? port : address?.port ?? port;
  console.log(`Agent-Trace server running at http://${hostname}:${listeningPort}`);

  reconcile();
  const reconciliationTimer = (dependencies.setInterval ?? setInterval)(
    reconcile,
    staleRunReconciliationIntervalMs
  );
  reconciliationTimer.unref();

  server.once("close", () =>
    (dependencies.clearInterval ?? clearInterval)(reconciliationTimer)
  );

  return server;
}

async function isCompatibleCollector(collectorUrl: string, request: typeof fetch) {
  try {
    const response = await request(`${collectorUrl}/health`, {
      signal: AbortSignal.timeout(1_000)
    });
    if (!response.ok) return false;

    const body = await response.json() as { ok?: unknown; service?: unknown };
    return body.ok === true && body.service === "agent-trace";
  } catch {
    return false;
  }
}

function waitForListening(server: CollectorServer) {
  return new Promise<void>((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };

    server.once("listening", onListening);
    server.once("error", onError);
  });
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}
