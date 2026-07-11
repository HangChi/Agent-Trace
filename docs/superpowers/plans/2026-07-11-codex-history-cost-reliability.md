# Codex History and Cost Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore every locally discoverable Codex session, prevent arbitrary tool output from becoming token usage, and show scanner-derived API-equivalent estimated cost.

**Architecture:** Keep `tokscale` as the usage and pricing authority and keep the watcher separate from the collector. Tighten hook normalization so only explicit provider usage structures and the known Claude Agent response shape are trusted, make supported local launch paths start the watcher automatically without a stale `.bin` shim, and let the existing session snapshot precedence repair summaries without deleting trace events.

**Tech Stack:** TypeScript, Node.js/Electron, Hono, SQLite/Drizzle, Next.js, `tokscale` 4.3, existing smoke-test scripts.

## Global Constraints

- Displayed cost is an estimated equivalent API cost, not a Codex subscription invoice.
- A positive scanner `costUsd` is authoritative.
- Ordinary tool input, command output, MCP output, and generic tool responses must never be recursively interpreted as LLM usage.
- Preserve recognized Claude Code Agent/subagent structured usage.
- Preserve all hook, OTel, command, tool, MCP, and skill events.
- A failed or partial scan must not prune the last successful complete snapshot.
- Do not transmit prompts, assistant responses, tool payloads, source files, or raw Codex JSONL.

---

## File Map

- `apps/server/src/agent-hook-normalizer.ts`: trust boundary for hook and OTel token usage.
- `apps/server/src/smoke.ts`: integration regressions for false tool-output usage and retained Claude Agent usage.
- `packages/cli/src/usage.ts`: shared scanner enable/disable semantics and existing `tokscale` execution.
- `packages/cli/src/index.ts`: local development orchestration; enables the watcher by default.
- `packages/cli/src/smoke.ts`: scanner option and complete-history normalization regressions.
- `apps/desktop/main.cjs`: direct development scanner launch through Electron-as-Node and `tsx/cli`.
- `apps/desktop/scripts/check.mjs`: static packaging/startup assertions.
- `apps/web/src/lib/cost.ts`: API-equivalent estimated-cost semantics.
- `apps/web/src/lib/cost.smoke.ts`: scanner cost regression.
- `README.md`, `README.en.md`, `docs/agent-tracing.md`: startup and cost meaning.

### Task 1: Reject token-like values in ordinary tool output

**Files:**
- Modify: `apps/server/src/smoke.ts:560-660, 1375-1465`
- Modify: `apps/server/src/agent-hook-normalizer.ts:107-114, 917-941, 1055-1110`

**Interfaces:**
- Consumes: hook payloads accepted by `normalizeAgentHook(source, body, hints)`.
- Produces: `extractHookTokenUsage(source, body, hookEvent, toolName, context): TokenUsage | undefined`, which trusts only explicit hook usage containers and the recognized Claude Agent response.

- [ ] **Step 1: Add the false-tool-usage regression**

After the existing Codex `PostToolUse` fixtures in `apps/server/src/smoke.ts`, post a command response whose business output contains a token-like total:

```ts
await expectAccepted(
  app.request("/integrations/codex/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: codexSessionId,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "codex_tool_usage_report",
      tool_input: { command: "node local-scan-check.js" },
      tool_response: {
        result: {
          totalTokens: 1_419_637_430,
          costUsd: 1152.63
        }
      },
      model: "gpt-5.6-sol",
      cwd: "/workspace/agent-trace"
    })
  }),
  "Codex tool output with token-like business data"
);
```

Fetch the run events and assert that the matching tool event has no usage:

```ts
const codexToolOutputEventsResponse = await app.request(`/runs/${codexRunId}/events`);
const codexToolOutputEvents = await codexToolOutputEventsResponse.json();
const tokenLikeToolEvent = Array.isArray(codexToolOutputEvents)
  ? codexToolOutputEvents.find(
      (event) => event.metadata?.toolUseId === "codex_tool_usage_report"
    )
  : undefined;

if (!tokenLikeToolEvent || tokenLikeToolEvent.metadata?.tokenUsage !== undefined) {
  throw new Error("Expected ordinary tool output token-like fields to remain business data.");
}
```

- [ ] **Step 2: Run the server smoke test and verify RED**

Run: `pnpm --filter @agent-trace/server smoke`

Expected: FAIL with `Expected ordinary tool output token-like fields to remain business data.` because generic `tool_response` traversal currently parses `totalTokens`.

- [ ] **Step 3: Route hook parsing through a trusted helper**

Replace the hook call to generic `extractTokenUsage` with:

```ts
const tokenUsage =
  extractHookTokenUsage(source, body, hookEvent, toolName, { model, provider }) ??
  transcriptTokenUsage ??
  estimateHookTokenUsage(source, body, hookEvent, model);
```

Add a helper next to `extractTokenUsage`:

```ts
function extractHookTokenUsage(
  source: AgentHookSource,
  body: Record<string, unknown>,
  hookEvent: string,
  toolName: string | undefined,
  context: UsageParseContext
): TokenUsage | undefined {
  for (const key of [
    "usage",
    "usage_metadata",
    "usageMetadata",
    "token_usage",
    "tokenUsage",
    "response_usage",
    "responseUsage"
  ]) {
    const usage = asRecord(parseJsonString(body[key]));

    if (Object.keys(usage).length === 0) continue;

    const parsed = extractTokenUsage(source, usage, context);
    if (parsed) return parsed;
  }

  if (source !== "claude-code" || hookEvent !== "PostToolUse" || toolName !== "Agent") {
    return undefined;
  }

  const response = asRecord(getValue(body, "tool_response", "toolResponse"));
  const structuredUsage = asRecord(getValue(response, "usage"));

  if (Object.keys(structuredUsage).length === 0) return undefined;

  const parsed = extractTokenUsage(source, structuredUsage, context);
  if (!parsed) return undefined;

  const aggregateTotal = getNonnegativeNumber(response, "totalTokens", "total_tokens");

  return aggregateTotal === undefined ? parsed : { ...parsed, total: aggregateTotal };
}
```

Do not add `tool_response`, `toolResponse`, `output`, `result`, or `message` to this helper's trusted top-level list.

- [ ] **Step 4: Run the server smoke test and verify GREEN**

Run: `pnpm --filter @agent-trace/server smoke`

Expected: PASS, including the existing assertion that Claude Agent usage totals 12,450.

- [ ] **Step 5: Commit the parser fix**

```bash
git add -- apps/server/src/agent-hook-normalizer.ts apps/server/src/smoke.ts
git commit -m "Reject token-like tool output"
```

### Task 2: Start history scanning automatically and avoid stale development shims

**Files:**
- Modify: `packages/cli/src/usage.ts:816-820`
- Modify: `packages/cli/src/index.ts:145-190`
- Modify: `packages/cli/src/smoke.ts:20-40`
- Modify: `apps/desktop/main.cjs:77-115, 623-644`
- Modify: `apps/desktop/scripts/check.mjs:24-50`

**Interfaces:**
- Produces: `isUsageScannerEnabled(value?: string): boolean` with default `true` and false values `0`, `false`, and `off`.
- Consumes: `tsx/cli`, `packages/cli/src/index.ts`, collector URL, and the user's home directory.

- [ ] **Step 1: Add scanner enablement assertions**

Import `isUsageScannerEnabled` in `packages/cli/src/smoke.ts` and add:

```ts
if (
  !isUsageScannerEnabled(undefined) ||
  !isUsageScannerEnabled("true") ||
  isUsageScannerEnabled("0") ||
  isUsageScannerEnabled("false") ||
  isUsageScannerEnabled("off")
) {
  throw new Error("Expected local usage scanning to default on with explicit disable values.");
}
```

Extend `apps/desktop/scripts/check.mjs` with direct-development-launch markers:

```js
for (const required of [
  "getDevelopmentCliInvocation",
  'require.resolve("tsx/cli"',
  'path.join(cliRoot, "src", "index.ts")',
  "ELECTRON_RUN_AS_NODE"
]) {
  if (!mainSource.includes(required)) {
    throw new Error(`Desktop development scanner is missing direct launch marker: ${required}`);
  }
}

if (mainSource.includes('["--filter", "@agent-trace/cli", "exec", "tsx"')) {
  throw new Error("Desktop development scanner must not depend on a package-manager .bin shim.");
}
```

- [ ] **Step 2: Run CLI smoke and desktop build to verify RED**

Run: `pnpm --filter @agent-trace/cli smoke`

Expected: FAIL because `isUsageScannerEnabled` is not exported.

Run: `pnpm --filter @agent-trace/desktop build`

Expected: FAIL with the missing direct launch marker.

- [ ] **Step 3: Add shared enable/disable semantics and default CLI development scanning**

Add to `packages/cli/src/usage.ts`:

```ts
export function isUsageScannerEnabled(value: string | undefined) {
  const configured = String(value ?? "").trim().toLowerCase();

  return configured !== "0" && configured !== "false" && configured !== "off";
}
```

Import it in `packages/cli/src/index.ts`, then replace the opt-in check in `runDev` with:

```ts
const usageScan = isUsageScannerEnabled(
  flags["usage-scan"] ?? process.env.AGENT_TRACE_USAGE_SCAN
);
```

Keep `--usage-scan=false` and `AGENT_TRACE_USAGE_SCAN=0` as explicit opt-outs. Update `printDevHelp()` so it says scanning defaults to enabled.

- [ ] **Step 4: Launch the desktop development scanner directly**

Replace the non-packaged `spawnPnpm` branch in `startUsageScannerService` with:

```js
const invocation = getDevelopmentCliInvocation();

return spawnPackagedNode(
  invocation.runner,
  {},
  invocation.cwd,
  [invocation.script, ...args],
  processOptions
);
```

Add:

```js
function getDevelopmentCliInvocation() {
  const workspaceRoot = resolveWorkspaceRoot();
  const cliRoot = path.join(workspaceRoot, "packages", "cli");

  return {
    runner: require.resolve("tsx/cli", { paths: [cliRoot] }),
    script: path.join(cliRoot, "src", "index.ts"),
    cwd: workspaceRoot
  };
}
```

This uses Electron's runtime with `ELECTRON_RUN_AS_NODE=1` and resolves the actual `tsx` module rather than a generated `.cmd` shim.

- [ ] **Step 5: Run CLI smoke and desktop build to verify GREEN**

Run: `pnpm --filter @agent-trace/cli smoke`

Expected: `Agent-Trace CLI smoke test passed.`

Run: `pnpm --filter @agent-trace/desktop build`

Expected: exit 0 with all desktop source checks passing.

- [ ] **Step 6: Commit scanner startup changes**

```bash
git add -- packages/cli/src/usage.ts packages/cli/src/index.ts packages/cli/src/smoke.ts apps/desktop/main.cjs apps/desktop/scripts/check.mjs
git commit -m "Start local history scanning reliably"
```

### Task 3: Mark scanner-derived cost as API-equivalent estimated cost

**Files:**
- Modify: `apps/web/src/lib/cost.smoke.ts`
- Modify: `apps/web/src/lib/cost.ts:75-115`

**Interfaces:**
- Consumes: stored run/model `costUsd` and configured exact-price fallback.
- Produces: `RunCost.estimated === true` whenever a dollar cost is displayed.

- [ ] **Step 1: Add a failing scanner-cost semantic assertion**

In `apps/web/src/lib/cost.smoke.ts`, add:

```ts
const scannerCost = calculateRunCost({
  costUsd: 29.912249,
  models: ["gpt-5.6-sol"],
  tokenUsage: {
    input: 749_641,
    output: 106_336,
    cachedInput: 43_577_088,
    total: 44_433_065,
    sourceKind: "scan",
    scope: "session"
  }
});

if (
  scannerCost.usd !== 29.912249 ||
  scannerCost.estimated !== true ||
  scannerCost.unpricedModels.length !== 0
) {
  throw new Error("Expected scanner cost to be displayed as API-equivalent estimated cost.");
}
```

- [ ] **Step 2: Run the cost smoke test and verify RED**

Run: `pnpm --filter @agent-trace/web exec tsx src/lib/cost.smoke.ts`

Expected: FAIL because stored scanner cost currently inherits the token estimate flag and is marked non-estimated.

- [ ] **Step 3: Make displayed cost semantics explicit**

In `calculateRunCost`, initialize the flag from whether there is any cost basis:

```ts
let estimated = storedUsd !== undefined || usages.length > 0;
```

Keep scanner `costUsd` precedence and the existing `costEstimated` UI label. Do not add a second pricing database or fuzzy matching in the web app.

- [ ] **Step 4: Run the cost smoke test and verify GREEN**

Run: `pnpm --filter @agent-trace/web exec tsx src/lib/cost.smoke.ts`

Expected: `Agent-Trace cost smoke test passed.`

- [ ] **Step 5: Commit cost semantics**

```bash
git add -- apps/web/src/lib/cost.ts apps/web/src/lib/cost.smoke.ts
git commit -m "Label scanner costs as estimates"
```

### Task 4: Document, backfill, and verify the complete pipeline

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/agent-tracing.md`

**Interfaces:**
- Consumes: the local home, running collector at `http://localhost:4319`, and the built CLI.
- Produces: a complete usage snapshot in the current collector plus documented startup/cost behavior.

- [ ] **Step 1: Update user-facing documentation**

Document all of the following in the existing usage-scanning sections:

```text
- Desktop and `agent-trace dev` start local usage scanning automatically.
- Set `AGENT_TRACE_USAGE_SCAN=0` or pass `--usage-scan=false` to disable it.
- The first scan restores active and archived Codex histories and deduplicates equivalent copies.
- Cost is estimated API-equivalent cost, not the user's Codex subscription invoice.
- Scanner-provided tokscale cost is authoritative; unknown prices remain explicitly unpriced.
```

- [ ] **Step 2: Run focused regression tests**

Run:

```text
pnpm --filter @agent-trace/server smoke
pnpm --filter @agent-trace/cli smoke
pnpm --filter @agent-trace/web exec tsx src/lib/cost.smoke.ts
pnpm --filter @agent-trace/desktop build
```

Expected: all four commands exit 0.

- [ ] **Step 3: Run full repository verification**

Run:

```text
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands exit 0 with no TypeScript, build, or whitespace errors.

- [ ] **Step 4: Post one real complete local snapshot**

With the collector running at port 4319, run the built CLI once:

```text
node packages/cli/dist/index.js usage --collector-url http://localhost:4319 --home %USERPROFILE% --timeout-ms 120000
```

Expected: output reports hundreds of usage rows posted; the scan includes at least 182 Codex model/session rows on the diagnosed machine.

- [ ] **Step 5: Verify the live collector summary**

Run a read-only query against `http://localhost:4319/runs` and verify:

```text
- Codex historical runs are substantially greater than the previous 5 recent runs.
- run_codex_019f4c80-2d37-79a2-93ee-e01f9cd88580 totals about 44,433,065 tokens, not 1,419,678,574.
- Its model is gpt-5.6-sol.
- Its stored estimated API-equivalent cost is about USD 29.91.
```

Do not delete the underlying command/tool events during this check.

- [ ] **Step 6: Commit documentation**

```bash
git add -- README.md README.en.md docs/agent-tracing.md
git commit -m "Document automatic history and estimated cost"
```
