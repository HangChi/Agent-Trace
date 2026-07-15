import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const databasePath = join(tmpdir(), `agent-trace-read-model-smoke-${Date.now()}.db`);
process.env.AGENT_TRACE_DB_PATH = databasePath;

const storage = await import("./storage.js");
const { createApp } = await import("./app.js");
const { db: defaultDatabase } = await import("./db.js");
storage.initializeDatabase(databasePath);

const sqlite = new Database(databasePath);
sqlite.pragma("foreign_keys = ON");
const queries: Array<{ sql: string; params: unknown[] }> = [];
const database = drizzle(sqlite, {
  logger: {
    logQuery(query, params) {
      queries.push({ sql: query, params });
    }
  }
});
const staleStartedAt = new Date(Date.now() - 32 * 60_000).toISOString();
const staleLastActivityAt = new Date(Date.now() - 31 * 60_000).toISOString();

try {
  await storage.createRun(
    {
      id: "read-model-stale",
      name: "stale run",
      status: "running",
      startedAt: staleStartedAt,
      input: { source: "agent-hook" }
    },
    database
  );
  await storage.createEvent(
    {
      id: "read-model-stale-event",
      runId: "read-model-stale",
      type: "run_started",
      name: "session",
      status: "running",
      timestamp: staleLastActivityAt,
      metadata: { category: "lifecycle" }
    },
    database
  );

  await storage.listRuns({ includeUntracked: true }, database);
  const statusAfterRead = sqlite
    .prepare("SELECT status FROM runs WHERE id = ?")
    .get("read-model-stale") as { status: string } | undefined;
  assert.equal(
    statusAfterRead?.status,
    "running",
    "listRuns must not reconcile stale runs"
  );

  assert.equal(typeof storage.listRunsPage, "function", "listRunsPage must be exported");
  assert.equal(typeof storage.reconcileStaleRuns, "function", "reconcileStaleRuns must be exported");

  await storage.reconcileStaleRuns(database);
  const reconciled = sqlite
    .prepare("SELECT status, ended_at AS endedAt, error FROM runs WHERE id = ?")
    .get("read-model-stale") as
    | { status: string; endedAt: string | null; error: string | null }
    | undefined;
  assert.equal(reconciled?.status, "error");
  assert.equal(reconciled?.endedAt, staleLastActivityAt);
  assert.match(String(reconciled?.error), /^No completion hook received after /);

  const base = Date.now();
  for (let index = 0; index < 5; index += 1) {
    await storage.createRun(
      {
        id: `read-model-run-${index}`,
        name: `run ${index}`,
        status: index === 1 ? "error" : index === 2 ? "running" : "success",
        startedAt: new Date(base + index * 1_000).toISOString(),
        metadata: { agent: index % 2 === 0 ? "codex" : "claude-code" },
        output: { index }
      },
      database
    );
  }

  await storage.createRun(
    {
      id: "read-model-empty-content",
      name: "empty tracked content",
      status: "success",
      startedAt: new Date(base + 6_000).toISOString(),
      metadata: { agent: "codex" }
    },
    database
  );
  await storage.createRun(
    {
      id: "read-model-tracked-content",
      name: "tracked content",
      status: "success",
      startedAt: new Date(base + 7_000).toISOString(),
      metadata: { agent: "codex" }
    },
    database
  );
  await storage.createEvent(
    {
      id: "read-model-tracked-content-event",
      runId: "read-model-tracked-content",
      type: "tool_call",
      name: "read file",
      status: "success",
      timestamp: new Date(base + 8_000).toISOString(),
      metadata: {
        category: "tool",
        toolName: "read_file",
        model: "filter-model",
        costUsd: 1.25,
        tokenUsage: { input: 10, output: 5, total: 15 }
      }
    },
    database
  );

  const trackedContentPage = await storage.listRunsPage({ pageSize: 200 }, database);
  assert.deepEqual(
    trackedContentPage.runs.map((run) => run.id),
    ["read-model-tracked-content"],
    "default run listing must hide records whose tracked-content summary is empty"
  );
  const allContentPage = await storage.listRunsPage(
    { includeUntracked: true, pageSize: 200 },
    database
  );
  assert.ok(allContentPage.runs.some((run) => run.id === "read-model-empty-content"));

  const filteredRunPage = await storage.listRunsPage(
    {
      q: "tracked content",
      status: "success",
      source: "codex",
      model: "filter-model",
      startedAfter: new Date(base + 5_000).toISOString(),
      startedBefore: new Date(base + 9_000).toISOString(),
      minCostUsd: 1,
      maxCostUsd: 2,
      sort: "cost",
      order: "desc"
    },
    database
  );
  assert.deepEqual(filteredRunPage.runs.map((run) => run.id), ["read-model-tracked-content"]);

  const legacyRuns = await storage.listRuns({ includeUntracked: true }, database);
  queries.length = 0;
  const runPage = await storage.listRunsPage(
    { includeUntracked: true, page: 2, pageSize: 2 },
    database
  );
  assert.deepEqual(runPage.runs, legacyRuns.slice(2, 4));
  assert.deepEqual(runPage.pagination, {
    page: 2,
    pageSize: 2,
    total: legacyRuns.length,
    totalPages: Math.ceil(legacyRuns.length / 2)
  });
  assert.deepEqual(runPage.summary, summarizeRuns(legacyRuns));
  const includeUntrackedPayloadQuery = findPayloadQuery(queries, "runs");
  assert.match(includeUntrackedPayloadQuery.sql, /limit \? offset \?/i);
  assert.doesNotMatch(includeUntrackedPayloadQuery.sql, /\bin\s*\(/i);

  for (let index = 5; index < 25; index += 1) {
    await storage.createRun(
      {
        id: `read-model-run-${index}`,
        name: `run ${index}`,
        status: "success",
        startedAt: new Date(base + index * 1_000).toISOString(),
        metadata: { agent: "codex" }
      },
      database
    );
  }

  queries.length = 0;
  await storage.listRunsPage({ page: 2, pageSize: 3 }, database);
  assert.ok(
    Math.max(...queries.map((query) => query.params.length)) <= 5,
    `run page bound too many parameters: ${queries
      .map((query) => `${query.params.length}:${query.sql}`)
      .join(" | ")}`
  );
  const fractionalRunPage = await storage.listRunsPage(
    { includeUntracked: true, page: 0.5, pageSize: 0.5 },
    database
  );
  assert.equal(fractionalRunPage.pagination.page, 1);
  assert.equal(fractionalRunPage.pagination.pageSize, 1);
  assert.ok(Number.isFinite(fractionalRunPage.pagination.totalPages));
  assert.equal(fractionalRunPage.runs.length, 1);

  const app = createApp();
  for (const path of ["/runs?page=NaN", "/runs?pageSize=Infinity"]) {
    const response = await app.request(path);
    const body = await response.json() as {
      runs?: unknown[];
      pagination?: { page?: number; pageSize?: number; totalPages?: number };
    };
    assert.equal(Array.isArray(body), false, `${path} must return DashboardRunPage`);
    assert.ok(Array.isArray(body.runs), `${path} must contain a runs page`);
    assert.ok(Number.isFinite(body.pagination?.page));
    assert.ok(Number.isFinite(body.pagination?.pageSize));
    assert.ok(Number.isFinite(body.pagination?.totalPages));
    assert.ok((body.pagination?.page ?? 0) >= 1);
    assert.ok((body.pagination?.pageSize ?? 0) >= 1);
  }

  const boundedRunPage = await storage.listRunsPage(
    { includeUntracked: true, pageSize: 10_000 },
    database
  );
  assert.equal(boundedRunPage.pagination.pageSize, 200);
  assert.ok(boundedRunPage.runs.length <= 200);

  await storage.createRun(
    {
      id: "read-model-events",
      name: "event paging",
      status: "success",
      startedAt: new Date(base + 10_000).toISOString()
    },
    database
  );
  for (let index = 0; index < 7; index += 1) {
    await storage.createEvent(
      {
        id: `read-model-event-${index}`,
        runId: "read-model-events",
        type: index % 2 === 0 ? "tool_call" : "step_started",
        name: index === 3 ? "needle event" : `event ${index}`,
        status: index === 5 ? "error" : "success",
        timestamp: new Date(base + 20_000 + index * 1_000).toISOString(),
        input: { command: index === 3 ? "find needle" : `command ${index}` },
        output: { payload: `output ${index}` },
        error:
          index === 5
            ? { message: "error-only-sentinel timeout", stack: "private stack", code: "E_PRIVATE" }
            : undefined,
        metadata: {
          agent: "codex",
          category: index % 2 === 0 ? "tool" : "lifecycle",
          toolName: index === 4 ? "metadata-only-sentinel" : undefined,
          tokenUsage: { input: 0, output: index, total: index }
        }
      },
      database
    );
  }

  const legacyEvents = await storage.listEventsByRunId("read-model-events", database);
  queries.length = 0;
  const eventPage = await storage.listEventsPageByRunId(
    "read-model-events",
    { visibility: "all", page: 2, pageSize: 2 },
    database
  );
  const descendingLegacyEvents = [...legacyEvents].reverse();
  assert.deepEqual(eventPage.events, descendingLegacyEvents.slice(2, 4));
  assert.equal(eventPage.pagination.total, legacyEvents.length);
  assert.equal(eventPage.events.length, 2);
  assert.equal(eventPage.counts.total, 7);
  assert.equal(eventPage.summary.totalTokens, 21);
  assert.equal(eventPage.summary.failedEvents, 1);
  assert.deepEqual(
    eventPage.summary.errorEvents,
    legacyEvents.filter((event) => event.status === "error")
  );
  const initialEventPayloadQueries = queries.filter(
    (query) => query.sql.includes('from "events"') && query.sql.includes('"output_json"')
  );
  assert.equal(
    initialEventPayloadQueries.length,
    2,
    `expected one page payload query and one error-only payload query: ${initialEventPayloadQueries
      .map((query) => query.sql)
      .join(" | ")}`
  );
  const errorPayloadQuery = initialEventPayloadQueries.find((query) =>
    /"events"\."status"\s*=\s*\?/i.test(query.sql)
  );
  assert.ok(errorPayloadQuery, "expected a status=error full-payload query");
  assert.ok(errorPayloadQuery.params.includes("error"));
  const initialPagePayloadQuery = findPayloadQuery(queries, "events");
  assert.match(initialPagePayloadQuery.sql, /limit \? offset \?/i);
  assert.doesNotMatch(initialPagePayloadQuery.sql, /\bid\b[^]*\bin\s*\(/i);
  assert.ok(
    queries
      .filter((query) => query.sql.includes('from "events"') && !query.sql.includes('"output_json"'))
      .every((query) => /count\(|sum\(|distinct|limit \?/i.test(query.sql)),
    "event pagination must use aggregates or bounded facet/source queries instead of a full projected scan"
  );
  assert.ok(
    queries.some((query) =>
      query.sql.includes('from "events"') &&
      query.sql.includes('"events"."metadata_json"') &&
      /where[^]*run_id[^]*in\s*\(/i.test(query.sql)
    ),
    `run page event summaries must be restricted to current-page run ids: ${queries.map(({ sql }) => sql).join(" | ")}`
  );
  const fractionalEventPage = await storage.listEventsPageByRunId(
    "read-model-events",
    { visibility: "all", page: 0.5, pageSize: 0.5 },
    database
  );
  assert.equal(fractionalEventPage.pagination.page, 1);
  assert.equal(fractionalEventPage.pagination.pageSize, 1);
  assert.ok(Number.isFinite(fractionalEventPage.pagination.totalPages));
  assert.deepEqual(fractionalEventPage.events.map((event) => event.id), ["read-model-event-6"]);

  for (const [query, expectedId] of [
    ["needle event", "read-model-event-3"],
    ["find needle", "read-model-event-3"],
    ["error-only-sentinel", "read-model-event-5"],
    ["metadata-only-sentinel", "read-model-event-4"]
  ] as const) {
    const filteredEventPage = await storage.listEventsPageByRunId(
      "read-model-events",
      { visibility: "all", q: query, pageSize: 10_000 },
      database
    );
    assert.deepEqual(filteredEventPage.events.map((event) => event.id), [expectedId]);
    assert.equal(filteredEventPage.counts.matching, 1);
    assert.equal(filteredEventPage.pagination.pageSize, 500);
  }

  for (const [filters, expectedIds] of [
    [{ status: "error" }, ["read-model-event-5"]],
    [
      { type: "tool_call" },
      ["read-model-event-6", "read-model-event-4", "read-model-event-2", "read-model-event-0"]
    ],
    [
      { category: "lifecycle" },
      ["read-model-event-5", "read-model-event-3", "read-model-event-1"]
    ]
  ] as const) {
    const filtered = await storage.listEventsPageByRunId(
      "read-model-events",
      { visibility: "all", ...filters },
      database
    );
    assert.deepEqual(filtered.events.map((event) => event.id), expectedIds);
  }

  queries.length = 0;
  const pushedDown = await storage.listEventsPageByRunId(
    "read-model-events",
    { visibility: "all", status: "success", type: "tool_call", page: 2, pageSize: 1 },
    database
  );
  assert.deepEqual(pushedDown.events.map((event) => event.id), ["read-model-event-4"]);
  const pushedDownPayloadQuery = findPayloadQuery(queries, "events");
  assert.match(pushedDownPayloadQuery.sql, /status[^]*type/i);
  assert.ok(pushedDownPayloadQuery.params.includes(1), "expected real page offset in SQL params");
  assert.doesNotMatch(pushedDownPayloadQuery.sql, /\bid\b[^]*\bin\s*\(/i);
  assert.ok(
    queries.some((query) => /count\(\*\)[^]*status[^]*type/i.test(query.sql)),
    "expected status and type filters to be pushed into the matching-count query"
  );

  await storage.createRun(
    {
      id: "read-model-full-run-insights",
      name: "full-run insights",
      status: "success",
      startedAt: new Date(base + 40_000).toISOString()
    },
    database
  );
  for (let index = 0; index < 3; index += 1) {
    await storage.createEvent(
      {
        id: `read-model-insight-${index}`,
        runId: "read-model-full-run-insights",
        type: "tool_call",
        name: index === 2 ? "filtered needle" : `repeat ${index}`,
        status: "success",
        timestamp: new Date(base + 41_000 + index * 1_000).toISOString(),
        output: { payload: `private output ${index}` },
        metadata: { category: "tool", toolName: "read_file" }
      },
      database
    );
  }
  const filteredInsightPage = await storage.listEventsPageByRunId(
    "read-model-full-run-insights",
    { visibility: "all", q: "filtered needle", pageSize: 1, includeInsights: true },
    database
  );
  assert.deepEqual(filteredInsightPage.events.map((event) => event.id), ["read-model-insight-2"]);
  assert.deepEqual(
    (filteredInsightPage.summary.insights ?? []).find(
      (insight) => insight.kind === "repeated_action"
    )?.eventIds,
    ["read-model-insight-0", "read-model-insight-1", "read-model-insight-2"]
  );

  await storage.createRun(
    {
      id: "read-model-transcript-suppression",
      name: "transcript suppression",
      status: "success",
      startedAt: new Date(base + 30_000).toISOString()
    },
    database
  );
  await storage.createEvent(
    {
      id: "read-model-live-action",
      runId: "read-model-transcript-suppression",
      type: "tool_call",
      name: "live action",
      status: "success",
      timestamp: new Date(base + 31_000).toISOString(),
      metadata: { category: "tool", source: "agent-hook" }
    },
    database
  );
  await storage.createEvent(
    {
      id: "read-model-transcript-action",
      runId: "read-model-transcript-suppression",
      type: "tool_call",
      name: "transcript action",
      status: "success",
      timestamp: new Date(base + 32_000).toISOString(),
      metadata: { category: "tool", source: "transcript" }
    },
    database
  );
  const displayOnly = await storage.listEventsPageByRunId(
    "read-model-transcript-suppression",
    { visibility: "display" },
    database
  );
  const hiddenOnly = await storage.listEventsPageByRunId(
    "read-model-transcript-suppression",
    { visibility: "hidden" },
    database
  );
  assert.deepEqual(displayOnly.events.map((event) => event.id), ["read-model-live-action"]);
  assert.deepEqual(hiddenOnly.events.map((event) => event.id), ["read-model-transcript-action"]);
  assert.deepEqual(displayOnly.counts, { total: 2, display: 1, hidden: 1, matching: 1 });
  assert.deepEqual(displayOnly.facets, { types: ["tool_call"], categories: ["tool"] });

  await storage.createRun(
    {
      id: "read-model-malformed-timestamps",
      name: "malformed timestamps",
      status: "success",
      startedAt: new Date(base + 40_000).toISOString()
    },
    database
  );
  await storage.createEvent(
    {
      id: "read-model-valid-timestamp",
      runId: "read-model-malformed-timestamps",
      type: "step_started",
      name: "valid timestamp",
      status: "success",
      timestamp: new Date(base + 41_000).toISOString()
    },
    database
  );
  await storage.createEvent(
    {
      id: "read-model-malformed-timestamp",
      runId: "read-model-malformed-timestamps",
      type: "step_started",
      name: "malformed timestamp",
      status: "success",
      timestamp: "not-a-time"
    },
    database
  );
  const malformedTimestampPage = await storage.listEventsPageByRunId(
    "read-model-malformed-timestamps",
    { visibility: "all", page: 1, pageSize: 1 },
    database
  );
  assert.equal(malformedTimestampPage.pagination.pageSize, 1);
  assert.deepEqual(malformedTimestampPage.events.map((event) => event.id), [
    "read-model-valid-timestamp"
  ]);

  await storage.createRun(
    {
      id: "read-model-duplicate-timestamps",
      name: "duplicate timestamps",
      status: "success",
      startedAt: new Date(base + 42_000).toISOString()
    },
    database
  );
  const duplicateTimestamp = new Date(base + 43_000).toISOString();
  for (const id of ["read-model-duplicate-first", "read-model-duplicate-second"]) {
    await storage.createEvent(
      {
        id,
        runId: "read-model-duplicate-timestamps",
        type: "step_started",
        name: id,
        status: "success",
        timestamp: duplicateTimestamp
      },
      database
    );
  }
  queries.length = 0;
  const duplicateTimestampPage = await storage.listEventsPageByRunId(
    "read-model-duplicate-timestamps",
    { visibility: "all", page: 1, pageSize: 1 },
    database
  );
  assert.deepEqual(duplicateTimestampPage.events.map((event) => event.id), [
    "read-model-duplicate-first"
  ]);
  assert.doesNotMatch(findPayloadQuery(queries, "events").sql, /\bin\s*\(/i);

  await storage.createRun(
    {
      id: "read-model-stale-race",
      name: "stale race",
      status: "running",
      startedAt: staleStartedAt
    },
    database
  );
  const racingDatabase = databaseWithBeforeRunUpdate(() => {
    sqlite
      .prepare(
        "INSERT INTO events (id, run_id, type, name, status, timestamp) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        "read-model-race-event",
        "read-model-stale-race",
        "step_started",
        "new activity",
        "running",
        new Date().toISOString()
      );
  });
  assert.equal(await storage.reconcileStaleRuns(racingDatabase), 0);
  assert.equal(
    (sqlite.prepare("SELECT status FROM runs WHERE id = ?").get("read-model-stale-race") as {
      status: string;
    }).status,
    "running"
  );

  await storage.createRun(
    {
      id: "read-model-stale-upsert-race",
      name: "stale upsert race",
      status: "running",
      startedAt: staleStartedAt
    },
    database
  );
  await storage.createEvent(
    {
      id: "read-model-upsert-race-event",
      runId: "read-model-stale-upsert-race",
      type: "step_started",
      name: "old activity",
      status: "running",
      timestamp: staleLastActivityAt
    },
    database
  );
  const upsertingDatabase = databaseWithBeforeRunUpdate(() => {
    sqlite
      .prepare("UPDATE events SET timestamp = ? WHERE id = ?")
      .run(new Date().toISOString(), "read-model-upsert-race-event");
  });
  assert.equal(await storage.reconcileStaleRuns(upsertingDatabase), 0);
  assert.equal(
    (sqlite
      .prepare("SELECT status FROM runs WHERE id = ?")
      .get("read-model-stale-upsert-race") as { status: string }).status,
    "running"
  );

  const queryPlan = sqlite
    .prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM events WHERE run_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    )
    .all("read-model-events", 2, 0) as Array<{ detail: string }>;
  const queryPlanDetails = queryPlan
    .map((row) => String(row.detail));
  assert.ok(
    queryPlanDetails.some((detail) => detail.includes("events_run_id_timestamp_idx")),
    `expected composite index in query plan: ${queryPlanDetails.join(" | ")}`
  );
  assert.ok(
    queryPlanDetails.every((detail) => !detail.includes("USE TEMP B-TREE FOR ORDER BY")),
    `expected no temporary order-by B-tree: ${queryPlanDetails.join(" | ")}`
  );
} finally {
  sqlite.close();
  defaultDatabase.$client.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
}

console.log("Agent-Trace read-model smoke test passed.");

function summarizeRuns(runs: Awaited<ReturnType<typeof storage.listRuns>>) {
  const agents = new Map<string, number>();

  for (const run of runs) {
    const agent = run.metadata?.agent ?? "manual";
    agents.set(agent, (agents.get(agent) ?? 0) + 1);
  }

  return {
    totalRuns: runs.length,
    runningRuns: runs.filter((run) => run.status === "running").length,
    failedRuns: runs.filter((run) => run.status === "error").length,
    agents: [...agents.entries()]
      .map(([agent, count]) => ({ agent, count }))
      .sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent))
  };
}

function findPayloadQuery(
  loggedQueries: Array<{ sql: string; params: unknown[] }>,
  table: "runs" | "events"
) {
  const query = loggedQueries.find(
    (item) => item.sql.includes(`from "${table}"`) && item.sql.includes('"output_json"')
  );
  assert.ok(query, `expected full ${table} payload query`);
  return query;
}

function databaseWithBeforeRunUpdate(callback: () => void) {
  let invoked = false;

  return drizzle(sqlite, {
    logger: {
      logQuery(query) {
        if (!invoked && /^update "runs"/i.test(query)) {
          invoked = true;
          callback();
        }
      }
    }
  });
}
