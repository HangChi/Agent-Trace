import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { initializeDatabase } from "./storage.js";

export function getCollectorPort() {
  return Number(
    process.env.PORT ??
      process.env.AGENT_TRACE_SERVER_PORT ??
      process.env.TOOLTRACE_SERVER_PORT ??
      4319
  );
}

export function startCollector(port = getCollectorPort()) {
  initializeDatabase();

  const server = serve({
    fetch: createApp().fetch,
    port
  });

  console.log(`Agent-Trace server running at http://localhost:${port}`);

  return server;
}
