# Safe Offline Action Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify offline transcript actions as command, tool, MCP, or Skill while defaulting all new command writes to metadata-only storage.

**Architecture:** Add a pure shared classifier in `@agent-trace/schema`, enrich CLI transcript events with structured actions, and normalize those actions into the existing Run/Event model. Enforce command-content policy both before the CLI posts transcript data and immediately before the Server serializes any Event, then expose the policy and historical cleanup through the existing maintenance UI.

**Tech Stack:** TypeScript 5.9, Zod, Hono, Drizzle ORM, SQLite, Next.js/React, existing smoke-test scripts.

## Global Constraints

- Work directly in the current workspace and current branch; do not create or switch branches.
- Do not use subagents.
- `commandCapture="metadata"` is the default and must prevent command text from reaching transcript payloads or SQLite.
- `commandCapture="full"` is explicit opt-in and preserves the current full-command detail behavior.
- Do not persist ordinary tool arguments, tool results, Assistant text, or file contents.
- Keep old `tools?: string[]` transcript payloads readable during version skew.
- Preserve current live-action precedence over transcript actions.
- Do not modify Hook/OTel duplicate counting or merge databases in this change.

---

### Task 1: Shared action classification and privacy contract

**Files:**
- Create: `packages/schema/src/action-classification.ts`
- Modify: `packages/schema/src/index.ts`
- Create: `packages/schema/src/action-classification.smoke.mjs`
- Modify: `packages/schema/package.json`

**Interfaces:**
- Produces `classifyAction(input: ActionClassificationInput): ActionClassification`.
- Produces `CommandCaptureMode = "metadata" | "full"` and a `privacySettingsSchema` that defaults `commandCapture` to `metadata`.
- Consumers are the CLI transcript parser and Server Hook/transcript normalizers.

- [ ] **Step 1: Write failing classifier and privacy-default tests**

```ts
assert.deepEqual(classifyAction({ toolName: "mcp__ardot__batch_edit" }), {
  category: "mcp",
  toolKind: "mcp",
  toolName: "mcp__ardot__batch_edit",
  mcpServer: "ardot",
  mcpTool: "batch_edit"
});
assert.equal(classifyAction({ toolName: "Bash", argumentKeys: ["command"] }).category, "command");
assert.equal(classifyAction({ toolName: "Read" }).category, "tool");
assert.equal(privacySettingsSchema.parse({ sensitiveKeys: [], replacement: "[REDACTED]" }).commandCapture, "metadata");
```

- [ ] **Step 2: Run the schema smoke test and verify missing exports fail**

Run: `pnpm --filter @agent-trace/schema test`

Expected: FAIL because `classifyAction` and `commandCapture` do not exist.

- [ ] **Step 3: Implement the pure classifier and Schema default**

The classifier must apply MCP → Skill → command → tool precedence and return only classification metadata. It must not accept argument values.

- [ ] **Step 4: Run schema build/test/typecheck**

Run: `pnpm --filter @agent-trace/schema build && pnpm --filter @agent-trace/schema test && pnpm --filter @agent-trace/schema typecheck`

Expected: PASS.

### Task 2: Structured offline transcript actions

**Files:**
- Modify: `packages/cli/src/transcript.ts`
- Modify: `packages/cli/src/transcript-collector.ts`
- Modify: `packages/cli/src/opencode-session.ts`
- Modify: `packages/cli/src/transcript.smoke.ts`

**Interfaces:**
- Produces `TranscriptAction` and `TranscriptEvent.actions?: TranscriptAction[]`.
- Parser signatures add `commandCapture: CommandCaptureMode = "metadata"` without breaking existing callers.
- metadata mode never returns a `command` property.

- [ ] **Step 1: Add failing WorkBuddy, Claude, Codex, MCP, and secret-sentinel fixtures**

```ts
const event = parseWorkBuddyTranscript(workBuddyWithBashAndMcp, "metadata", "metadata")
  .find((item) => item.kind === "turn")!;
assert.equal(event.actions?.[0]?.category, "command");
assert.equal(event.actions?.[0]?.command, undefined);
assert.equal(event.actions?.[1]?.mcpServer, "ardot");
assert.equal(JSON.stringify(event).includes("sk-offline-secret"), false);
```

Also assert `commandCapture="full"` returns the exact command and malformed JSON falls back without retaining its raw value.

- [ ] **Step 2: Run CLI transcript smoke and verify it fails**

Run: `pnpm --filter @agent-trace/cli exec tsx src/transcript.smoke.ts`

Expected: FAIL because parsed turns have only `tools`.

- [ ] **Step 3: Implement source-specific extraction and call/result pairing**

- WorkBuddy: pair `function_call`/`function_call_result` by `callId`.
- Claude: combine `tool_use` blocks by message ID and extract input field names.
- Codex: collect response-item calls and MCP end events until the next token-count turn.
- OpenCode: convert its current tools into structured tool actions without expanding stored content.

All parsers call `classifyAction`; only full mode reads a supported command field value into the returned action.

- [ ] **Step 4: Run CLI tests/typecheck**

Run: `pnpm --filter @agent-trace/cli test && pnpm --filter @agent-trace/cli typecheck`

Expected: PASS.

### Task 3: Normalize structured transcript actions

**Files:**
- Modify: `apps/server/src/transcript-scan.ts`
- Modify: `apps/server/src/transcript-api.smoke.ts`
- Modify: `apps/server/src/smoke.ts`

**Interfaces:**
- Consumes transcript `actions` and legacy `tools`.
- Produces existing `CreateTraceEvent` records with category-specific metadata and `commandContent`.

- [ ] **Step 1: Add a failing transcript API fixture**

Post a WorkBuddy transcript containing one metadata-only Bash action, one MCP action, and one ordinary tool. Assert the Run summary has `commandCount=1`, `mcpCount=1`, and `toolCount=1`, and that serialized events do not contain the command sentinel.

- [ ] **Step 2: Run the transcript API smoke test and verify failure**

Run: `pnpm --filter @agent-trace/server exec tsx src/transcript-api.smoke.ts`

Expected: FAIL because every action is currently normalized as `tool`.

- [ ] **Step 3: Implement action normalization with legacy fallback**

For new actions, set `category`, `toolName`, `toolKind`, MCP/Skill fields, status, duration, and optional full command. For legacy `tools`, preserve the current ordinary-tool behavior.

- [ ] **Step 4: Run focused Server tests**

Run: `pnpm --filter @agent-trace/server exec tsx src/transcript-api.smoke.ts && pnpm --filter @agent-trace/server exec tsx src/read-model.smoke.ts`

Expected: PASS.

### Task 4: Enforce command capture at Server storage boundary

**Files:**
- Modify: `apps/server/src/storage.ts`
- Modify: `apps/server/src/data-governance.smoke.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Produces `applyCommandCapturePolicy(event, privacy)` used by `createEvent`, `upsertEvent`, and transcript reconciliation.
- Produces `getStoredCommandStats()` and `purgeStoredCommands({ confirm: true })`.
- Adds `GET /maintenance/privacy/commands` and `POST /maintenance/privacy/commands/purge`.

- [ ] **Step 1: Add failing metadata/full/purge tests**

```ts
await storage.createEvent(commandEvent("sk-storage-secret"), database);
assert.equal(JSON.stringify(await storage.listEventsByRunId("run", database)).includes("sk-storage-secret"), false);
await storage.updatePrivacySettings({ sensitiveKeys: [], replacement: "[HIDDEN]", commandCapture: "full" }, database);
```

Then assert full mode stores the sentinel, stats report one Run/Event, and confirmed purge removes only the two command fields.

- [ ] **Step 2: Run governance smoke and verify failure**

Run: `pnpm --filter @agent-trace/server exec tsx src/data-governance.smoke.ts`

Expected: FAIL because the existing storage layer preserves commands.

- [ ] **Step 3: Implement centralized stripping and transactional purge**

metadata mode must remove top-level `command` from input and metadata, set `metadata.commandContent="omitted"` for command events, and leave other fields unchanged. Purge must require `confirm: true`, report counts without content, update JSON transactionally, and publish an event change.

- [ ] **Step 4: Run governance, API, export, and Server typecheck**

Run: `pnpm --filter @agent-trace/server exec tsx src/data-governance.smoke.ts && pnpm --filter @agent-trace/server exec tsx src/smoke.ts && pnpm --filter @agent-trace/server exec tsx src/run-export.smoke.ts && pnpm --filter @agent-trace/server typecheck`

Expected: PASS.

### Task 5: Apply privacy mode before transcript upload

**Files:**
- Modify: `packages/cli/src/usage.ts`
- Modify: `packages/cli/src/transcript-collector.ts`
- Modify: `packages/cli/src/smoke.ts`

**Interfaces:**
- Consumes `GET /maintenance/privacy` from the configured Collector.
- Produces a fail-closed `CommandCaptureMode`; request failures and unknown values return `metadata`.

- [ ] **Step 1: Add failing Collector privacy-fetch tests**

Cover `full`, `metadata`, HTTP failure, timeout, and invalid response. Assert all failure cases select metadata and no secret sentinel appears in the usage-scan request body.

- [ ] **Step 2: Run CLI smoke and verify failure**

Run: `pnpm --filter @agent-trace/cli exec tsx src/smoke.ts`

Expected: FAIL because usage scanning does not fetch command policy.

- [ ] **Step 3: Implement bounded privacy fetch and pass mode to transcript collection**

Reuse the existing Collector URL and bounded request style. A privacy lookup failure must not fail usage scanning.

- [ ] **Step 4: Run CLI tests/typecheck**

Run: `pnpm --filter @agent-trace/cli test && pnpm --filter @agent-trace/cli typecheck`

Expected: PASS.

### Task 6: Maintenance and Run-detail UI

**Files:**
- Modify: `apps/web/src/app/maintenance/page.tsx`
- Modify: `apps/web/src/app/maintenance/actions.ts`
- Modify: `apps/web/src/app/runs/[id]/page.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/maintenance/privacy-controls.smoke.ts`
- Create: `apps/web/src/app/runs/[id]/command-detail.smoke.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Privacy form submits `commandCapture` with existing fields.
- Purge form submits `{ confirm: true }` only after a browser confirmation control.
- Details render omitted-command text when `metadata.commandContent === "omitted"`.

- [ ] **Step 1: Add failing UI smoke assertions**

Assert bilingual omitted-command copy, metadata default selection, full-mode risk copy, and purge endpoint wiring.

- [ ] **Step 2: Run Web tests and verify failure**

Run: `pnpm --filter @agent-trace/web test`

Expected: FAIL because the controls and omitted-command message are absent.

- [ ] **Step 3: Implement minimal controls and detail rendering**

Keep the existing maintenance layout. Add a two-option select, visible full-mode warning, stored-command counts, and a destructive purge form with explicit confirmation checkbox. Do not render command values in the maintenance page.

- [ ] **Step 4: Run Web test/typecheck/build**

Run: `pnpm --filter @agent-trace/web test && pnpm --filter @agent-trace/web typecheck && pnpm --filter @agent-trace/web build`

Expected: PASS.

### Task 7: Documentation and full verification

**Files:**
- Modify: `docs/user-guide.md`
- Modify: `docs/privacy-security.md`
- Modify: `docs/architecture.md`
- Modify: `docs/testing.md`
- Modify: `CHANGELOG.md`
- Include: `docs/superpowers/plans/2026-08-08-safe-offline-action-classification.md`

**Interfaces:** None.

- [ ] **Step 1: Document exact defaults and limitations**

State that metadata is the default, full commands are opt-in and high risk, existing commands require explicit purge, transcript classification is source-dependent, and all processes should share one absolute `AGENT_TRACE_DB_PATH`.

- [ ] **Step 2: Run focused tests, then workspace verification**

Run: `pnpm --filter @agent-trace/schema test && pnpm --filter @agent-trace/cli test && pnpm --filter @agent-trace/server test && pnpm --filter @agent-trace/web test`

Run: `pnpm verify`

Expected: all commands PASS and `git diff --check` reports no errors.

- [ ] **Step 3: Inspect the final diff**

Run: `git status --short && git diff --stat && git diff --check`

Expected: only files listed in this plan and its approved design are changed; pre-existing unrelated untracked files remain untouched.

- [ ] **Step 4: Commit the implementation**

Stage only the intentional files and commit with:

```text
Add safe offline action classification
```
