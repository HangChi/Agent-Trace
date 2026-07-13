# Performance, Stability, and Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the local collector, make the repository's verification commands truthful, reduce dashboard read amplification, isolate SDK delivery failures, version SQLite upgrades, and add tree-shaped trace inspection with deterministic diagnostics.

**Architecture:** Keep the existing local-first Hono + SQLite + Next.js design. Add narrow modules only where behavior is reused or independently testable: collector host policy, dashboard read queries, migrations, SDK delivery, trace-tree construction, and deterministic insights. Preserve existing trace contracts and metadata-redaction defaults.

**Tech Stack:** TypeScript 5.9, Hono, better-sqlite3/Drizzle, Next.js 16, React 19, Node/tsx smoke tests, pnpm workspaces.

## Global Constraints

- Preserve all pre-existing uncommitted changes; never reset, overwrite, or stage them implicitly.
- Default collector access remains local-only and unauthenticated; external binding must require an explicit environment override.
- Tracing delivery must never delay the user's operation beyond the configured timeout and must never throw into user code.
- Preserve current usage precedence, metadata redaction, run visibility, and transcript/OTel timestamp semantics.
- Add no speculative configuration, dependency, hosted storage, or authentication system.
- Every behavior change follows RED -> GREEN and retains the existing smoke coverage.

---

### Task 1: Collector loopback policy

**Files:**
- Modify: `apps/server/src/start.ts`
- Modify: `apps/server/src/app.ts`
- Create: `apps/server/src/start.smoke.ts`
- Modify: `apps/server/package.json`

**Interfaces:**
- Produce `getCollectorHostname(): string`, defaulting to `127.0.0.1` and reading `AGENT_TRACE_SERVER_HOST` then `TOOLTRACE_SERVER_HOST`.
- `startCollector()` passes the hostname to Hono's Node adapter.
- CORS permits loopback dashboard origins (`127.0.0.1` or `localhost`, any port) and requests without an `Origin`; other origins receive no allow-origin header.

- [ ] Write smoke assertions for hostname defaults/overrides and allowed/denied CORS origins.
- [ ] Run the smoke and observe failures caused by missing policy.
- [ ] Implement the minimum hostname and CORS policy.
- [ ] Run the focused smoke, server smoke, and typecheck.

### Task 2: Truthful verification commands

**Files:**
- Modify: root and workspace `package.json` files
- Reuse: all existing `*.smoke.ts` files

**Interfaces:**
- Root `pnpm test` runs every existing smoke file.
- Each package owns a `test` script; packages without behavior tests use `typecheck` rather than silently doing nothing.
- Root `lint` becomes a truthful non-mutating verification command using TypeScript checks and `git diff --check`; do not add a lint dependency.

- [ ] Add a failing script-audit smoke that proves every workspace exposes `test` and `lint`.
- [ ] Run it and observe the missing-script failure.
- [ ] Add package scripts and a root script that executes the audit.
- [ ] Run `pnpm test`, `pnpm lint`, and `pnpm typecheck`.

### Task 3: Dashboard read-model and stale-run reconciliation

**Files:**
- Modify: `apps/server/src/storage.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/start.ts`
- Add focused smoke coverage under `apps/server/src/`

**Interfaces:**
- Add `listRunsPage({ includeUntracked, page, pageSize }) -> DashboardRunPage`; `/runs` delegates pagination to it.
- Add `reconcileStaleRuns()` as an explicit write operation invoked at collector startup and periodically, never from list/read functions.
- Event pagination applies SQL `LIMIT/OFFSET` and uses a composite `(run_id, timestamp)` index; filters and counts retain existing results.
- Run listing must not load event input/output/error payload columns merely to compute summaries.

- [ ] Add regression tests proving list reads do not mutate stale runs, explicit reconciliation does, pagination is bounded, and existing visibility/usage semantics remain unchanged.
- [ ] Run focused tests and observe the old read-side mutation/full-page behavior fail.
- [ ] Implement explicit reconciliation, database-side page selection, projected summary reads, and the composite index.
- [ ] Run server smoke suites and typecheck; inspect SQLite query plans for page and event-order queries.

### Task 4: Bounded SDK delivery

**Files:**
- Modify: `packages/sdk-js/src/index.ts`
- Modify: `packages/sdk-js/src/smoke.ts`
- Modify: `packages/sdk-js/package.json`

**Interfaces:**
- Extend `StartRunOptions` with optional `deliveryTimeoutMs?: number`, default `1000`.
- Every collector request uses an abort timeout and treats non-2xx responses as delivery failures.
- Delivery failures are swallowed; `traceLLM` and `traceTool` still execute and return/throw exactly as the wrapped function does.

- [ ] Add failing tests for a never-resolving fetch and a 500 response.
- [ ] Verify the timeout test fails because the wrapped operation does not start promptly.
- [ ] Implement one internal delivery helper using `AbortController` and timer cleanup.
- [ ] Run SDK tests and typecheck.

### Task 5: Versioned SQLite migrations

**Files:**
- Create: `apps/server/src/migrations.ts`
- Create: `apps/server/src/migrations.smoke.ts`
- Modify: `apps/server/src/storage.ts`
- Modify: `apps/server/src/init-db.ts`

**Interfaces:**
- Export `migrateDatabase(sqlite)` and store an integer schema version in `PRAGMA user_version`.
- Initial schema/index creation and legacy usage cleanup are ordered, transactional migrations.
- Reopening a current database performs no legacy scan or data rewrite.

- [ ] Add old-schema and current-schema fixtures; assert one-time upgrade, idempotence, preserved runs/events, and current indexes.
- [ ] Run the migration smoke and observe missing version tracking.
- [ ] Move startup DDL/cleanup into ordered migrations without changing Drizzle schema types.
- [ ] Run migration, storage, API, and transcript smoke suites.

### Task 6: Tree-shaped trace view

**Files:**
- Create: `apps/web/src/app/runs/[id]/trace-tree.ts`
- Create: `apps/web/src/app/runs/[id]/trace-tree.smoke.ts`
- Modify: `apps/web/src/app/runs/[id]/page.tsx`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**
- Export `buildTraceForest(events)` returning stable chronological roots with recursive children.
- Missing parents and cycles become roots; no event is dropped or duplicated.
- Detail UI provides chronological and tree modes; tree nodes use native `<details>` and preserve existing event details.

- [ ] Add failing pure tests for nested events, orphans, cycles, and stable ordering.
- [ ] Implement the minimum forest builder.
- [ ] Add the query-controlled tree rendering and localized labels.
- [ ] Run web tests, typecheck, and build.

### Task 7: Deterministic automatic diagnostics

**Files:**
- Create: `apps/server/src/trace-insights.ts`
- Create: `apps/server/src/trace-insights.smoke.ts`
- Modify: `packages/schema/src/index.ts`
- Modify: `apps/server/src/storage.ts`
- Modify: `apps/web/src/app/runs/[id]/page.tsx`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**
- Add `DashboardTraceInsight` with kinds `repeated_action`, `retry_loop`, `slow_step`, `token_hotspot`, and `failure_cascade` plus severity, event IDs, title, and evidence.
- Analyze the full run on the server, not just the current page; return insights in `DashboardEventPage.summary`.
- Use deterministic thresholds: 3 consecutive same action names; 3 attempts with an error before success; duration >= 10 seconds; one event >= 50% of positive run tokens and >= 1,000 tokens; error event followed by at least 2 descendant or subsequent errors.

- [ ] Add one failing test per insight kind and negative tests below thresholds.
- [ ] Implement the analyzer as a pure function.
- [ ] Attach insights to the read-model summary and render them in the detail sidebar.
- [ ] Run server/web tests, typecheck, and build.

### Task 8: Final verification and review

- [ ] Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` with the bundled Node runtime.
- [ ] Run `git diff --check` and inspect the full diff against every Global Constraint.
- [ ] Review that pre-existing user changes remain present and unmodified except where an approved task necessarily extends the same file.
- [ ] Perform a whole-branch code review and fix every Critical or Important finding.
