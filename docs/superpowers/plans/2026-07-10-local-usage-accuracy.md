# Local Usage Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically ingest every locally supported client, reconcile and deduplicate active/archived Codex histories, and calculate authoritative token totals and costs.

**Architecture:** Keep `tokscale` as the parser and pricing authority. The CLI runs an unfiltered primary scan, reconciles Codex JSONL histories by semantic fingerprint, and posts a complete snapshot that the server atomically replaces. The desktop packages and starts the CLI watcher automatically.

**Tech Stack:** TypeScript, Node.js streams/filesystem, tokscale 4.x, Hono, Drizzle/better-sqlite3, Electron, existing smoke-test scripts.

## Global Constraints

- Never add reasoning tokens on top of output tokens for scanner totals.
- Never infer a price from a similar model name.
- Never upload Codex conversation text or raw JSONL.
- Preserve explicit `--clients` filtering while making the default scan unfiltered.
- Preserve hook and OTel events when replacing scan snapshots.

---

### Task 1: Correct token totals and scan fallback pricing

**Files:**
- Modify: `packages/cli/src/smoke.ts`
- Modify: `packages/cli/src/usage.ts`
- Modify: `apps/web/src/lib/cost.smoke.ts`
- Modify: `apps/web/src/lib/cost.ts`

**Interfaces:**
- Consumes: tokscale rows with `input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`, and optional total/cost.
- Produces: normalized `UsageRow.totalTokens` and `calculateRunCost()` without cache/reasoning double billing.

- [ ] **Step 1: Write failing scanner-total assertions**

Change the CLI smoke fixture expectation to:

```ts
if (
  usageRows[0]?.totalTokens !== 135 ||
  usageRows[0]?.reasoningTokens !== 7
) {
  throw new Error("Expected scanner totals to exclude reasoning already contained in output.");
}
```

- [ ] **Step 2: Run the CLI smoke test and verify RED**

Run: `pnpm --filter @agent-trace/cli smoke`

Expected: FAIL because the current total is 142.

- [ ] **Step 3: Implement the minimal total fix**

Use this fallback in both row detection and normalization:

```ts
const totalTokens =
  firstInteger(row, totalTokenKeys) ||
  inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
```

Keep `reasoningTokens` as metadata only.

- [ ] **Step 4: Add a failing source-aware price assertion**

Add a scan usage with `input: 100`, `cachedInput: 60`, `output: 20`, `total: 180`, exact configured rates of input 2, cache 1, output 4, and assert USD `0.00034`.

- [ ] **Step 5: Run the cost smoke test and verify RED**

Run: `pnpm --filter @agent-trace/web exec tsx src/lib/cost.smoke.ts`

Expected: FAIL because scan input/cache is handled as provider-official input.

- [ ] **Step 6: Implement source-aware scan pricing**

For non-Anthropic scan usage calculate:

```ts
const scan = usage.sourceKind === "scan";
const uncachedInput = scan ? input : Math.max(0, input - cachedInput);
const nonOutputTokens = scan
  ? input + cachedInput + cacheCreationInput
  : input;
```

Bill `uncachedInput` and cache creation exactly once, cached input once, and derive output using `nonOutputTokens`.

- [ ] **Step 7: Run both smoke tests and verify GREEN**

Run the two commands from Steps 2 and 5. Expected: PASS.

### Task 2: Scan every tokscale client and reconcile Codex histories

**Files:**
- Create: `packages/cli/src/codex-history.ts`
- Modify: `packages/cli/src/usage.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/smoke.ts`

**Interfaces:**
- Produces: `findUncoveredCodexHistories(home, coveredSessionIds)` returning canonical file paths plus diagnostics.
- Consumes: a primary tokscale result and an injected supplemental-home scanner.

- [ ] **Step 1: Add failing default-client and dedup tests**

Assert the default runner receives `undefined` clients. Build temporary active/archive JSONL fixtures containing identical model/token-count sequences with different session IDs and assert only one canonical group. Add one unique archive fixture and assert it is uncovered.

- [ ] **Step 2: Run CLI smoke and verify RED**

Run: `pnpm --filter @agent-trace/cli smoke`

Expected: FAIL because defaults are hard-coded and the reconciliation module does not exist.

- [ ] **Step 3: Implement semantic Codex history indexing**

Stream JSONL lines, parse only `session_meta`, `turn_context`, and `event_msg`/`token_count`, and hash ordered tuples shaped as:

```ts
{
  timestamp,
  model,
  totalTokenUsage: info.total_token_usage,
  lastTokenUsage: info.last_token_usage
}
```

Exclude prompts, responses, tool data, file paths, and session IDs from the fingerprint. Group identical fingerprints, prefer an active file, and mark a group covered when any member ID exists in the primary scan.

- [ ] **Step 4: Make the primary default scan unfiltered**

Build tokscale args as:

```ts
const args = ["--json", "--group-by", "client,session,model"];
if (clients) args.splice(1, 0, "--client", clients);
```

Explicit CLI/environment clients remain normalized and passed.

- [ ] **Step 5: Add supplemental tokscale scanning**

Copy only uncovered canonical files into a temporary `home/.codex/sessions/...` tree, run tokscale for Codex against that isolated home, normalize the returned rows, merge by deterministic client/session/model identity, and delete the temporary tree in `finally`.

- [ ] **Step 6: Run CLI smoke and verify GREEN**

Run: `pnpm --filter @agent-trace/cli smoke`

Expected: PASS with unfiltered defaults, deduplicated fixtures, and one supplemented unique archive.

### Task 3: Replace complete scan snapshots safely

**Files:**
- Modify: `apps/server/src/agent-hooks.ts`
- Modify: `apps/server/src/storage.ts`
- Modify: `apps/server/src/smoke.ts`
- Modify: `packages/cli/src/usage.ts`

**Interfaces:**
- Consumes: `{ source: "tokscale", complete: true, rows, diagnostics }`.
- Produces: one transactional database snapshot containing exactly the current usage-scan events.

- [ ] **Step 1: Add a failing replacement regression test**

Post a complete scan with sessions A and B, then a complete scan with only A. Assert B's scan event disappears; assert a hook event on A remains. Also post an incomplete payload and assert it does not prune A.

- [ ] **Step 2: Run server smoke and verify RED**

Run: `pnpm --filter @agent-trace/server smoke`

Expected: FAIL because stale scan events remain.

- [ ] **Step 3: Implement atomic replacement storage**

Add a storage operation that uses `database.transaction()` to create/update runs, upsert current events, identify prior events whose metadata source is `usage-scan`, delete absent scan events only when `complete === true`, and delete a run only when its input source is `usage-scan` and it has no remaining events.

- [ ] **Step 4: Mark CLI scans complete only after successful reconciliation**

Post `complete: true` only after the primary scan, Codex reconciliation, normalization, and diagnostics collection all finish successfully.

- [ ] **Step 5: Run server and CLI smoke tests and verify GREEN**

Run: `pnpm --filter @agent-trace/server smoke`

Run: `pnpm --filter @agent-trace/cli smoke`

Expected: both PASS.

### Task 4: Start the usage watcher from desktop

**Files:**
- Modify: `apps/desktop/main.cjs`
- Modify: `apps/desktop/scripts/prepare-dist.mjs`
- Modify: `apps/desktop/scripts/check.mjs`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes: collector URL, `app.getPath("home")`, and `AGENT_TRACE_USAGE_SCAN`.
- Produces: one managed `agent-trace usage --watch --interval-ms 15000` child process.

- [ ] **Step 1: Add failing static desktop checks**

Extend `check.mjs` to require `main.cjs` to contain the watcher command, home argument, 15-second interval, and disable environment variable, and require `prepare-dist.mjs` to create `cli.tgz`.

- [ ] **Step 2: Run desktop build and verify RED**

Run: `pnpm --filter @agent-trace/desktop build`

Expected: FAIL because desktop does not launch or package the scanner.

- [ ] **Step 3: Package the CLI runtime**

Build/deploy `@agent-trace/cli` into staging, copy its production dependencies including tokscale native packages, and create `resources/archives/cli.tgz` alongside server/web archives.

- [ ] **Step 4: Launch a non-critical scanner child**

After collector readiness, start the CLI watcher with collector URL, real user home, and 15000 ms interval. Treat `0`, `false`, and `off` as disabled. Scanner startup/exit errors are logged but never replace the desktop window with a fatal error page.

- [ ] **Step 5: Run desktop build and verify GREEN**

Run: `pnpm --filter @agent-trace/desktop build`

Expected: PASS.

### Task 5: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/agent-tracing.md`

**Interfaces:**
- Documents automatic desktop behavior, all-client defaults, Codex archive reconciliation, token semantics, disable switch, and exact pricing behavior.

- [ ] **Step 1: Update documentation**

Document that desktop scanning is automatic, CLI default scanning is unfiltered, `--clients` narrows it, both Codex roots are reconciled, reasoning is output metadata, scanner cost is authoritative, and `AGENT_TRACE_USAGE_SCAN=0` disables desktop scanning.

- [ ] **Step 2: Run complete verification**

Run:

```text
pnpm --filter @agent-trace/cli smoke
pnpm --filter @agent-trace/server smoke
pnpm --filter @agent-trace/web exec tsx src/lib/cost.smoke.ts
pnpm --filter @agent-trace/desktop build
pnpm typecheck
pnpm build
git diff --check
```

Expected: every command exits 0 with no test failures or TypeScript errors.
