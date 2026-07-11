# Codex History and Cost Reliability Design

## Goal

Make Agent-Trace reliably show all locally discoverable Codex session history, reject token-like numbers found in ordinary tool output, and display estimated API-equivalent cost using the same `tokscale` pricing result that produced the session usage row.

## Confirmed Cost Meaning

Displayed cost is an estimate of the equivalent API usage cost. It is not a Codex subscription invoice and does not claim that the user was billed separately for those tokens. Scanner-provided `costUsd` remains authoritative and should be labelled as estimated in the interface.

## Observed Failures

- The local Codex home contains 177 active JSONL files and 12 archived JSONL files, while the running collector contains only recent OTel runs and no usage-scan snapshot.
- A direct `tokscale` scan returns 182 Codex session rows with token and cost data, proving that discovery and pricing work when the scanner runs.
- The development scanner can exit before its first scan when it relies on stale package-manager executable shims. That failure is logged outside the dashboard, so the UI continues to show only recent live traces.
- Hook normalization recursively examines arbitrary `tool_response` content for fields such as `totalTokens`. A command that printed a usage report was therefore interpreted as an official LLM usage event, adding 1,419,637,430 false tokens to one run.
- Without a successful session snapshot, the dashboard cannot use scanner cost and reports models such as `gpt-5.6-sol` as unpriced even though `tokscale` can price them.

## Chosen Approach

Keep the existing separate usage scanner and `tokscale` integration. Make its supported local launch paths automatic and independent of fragile `.bin` command shims, tighten hook usage parsing at the trust boundary, and continue using session snapshots to take precedence over event estimates.

This is preferred over embedding `tokscale` inside the collector because it preserves the current package boundary and desktop packaging model. It is preferred over browser-triggered scanning because history collection must continue when the dashboard is not focused.

## Scanner Lifecycle

- Desktop startup continues to launch one managed usage watcher after collector readiness.
- The local CLI development orchestrator enables usage scanning by default. An explicit disable option remains available for environments that intentionally do not scan the local home.
- Development startup invokes the scanner through a resolved script/runtime path rather than a package-manager `.bin` shim whose generated path can become stale after moving or restoring a workspace.
- The watcher performs an immediate complete scan, then repeats every 15 seconds without overlapping cycles.
- A scan is marked complete only after primary scanning, Codex active/archive reconciliation, normalization, and supplemental scanning succeed.
- Scanner failure remains non-fatal to the collector and dashboard, but the parent process reports startup/exit failure clearly so a missing history feed is diagnosable.

## History Data Flow

1. `tokscale` scans all supported clients by default with session/model grouping.
2. Codex reconciliation indexes both `~/.codex/sessions` and `~/.codex/archived_sessions` and deduplicates equivalent active/archive histories.
3. Histories not represented by the primary scan are passed through an isolated supplemental `tokscale` scan.
4. Normalized rows retain session ID, model, provider, input, output, cache read/write, reasoning metadata, total tokens, messages, timestamps, and scanner cost.
5. The collector atomically replaces the previous complete usage-scan snapshot while preserving hook and OTel events.
6. For a run with a session-level scan snapshot, dashboard token and cost summaries use that snapshot instead of adding live event estimates.

No prompts, assistant responses, tool payloads, source files, or raw JSONL are posted to the collector.

## Trusted Token Usage Parsing

Token usage must come from a trusted protocol location, not merely from a matching property name.

- OTel usage events continue to parse explicit OpenTelemetry/model usage structures.
- Top-level hook payload usage fields continue to support documented provider payloads.
- Claude Code `Agent`/subagent tool responses may contribute official usage only from their known structured response shape. Their explicit aggregate total can be retained when accompanied by that recognized usage structure.
- Ordinary tool input, command output, MCP output, and generic `tool_response` objects are excluded from recursive token discovery.
- A bare `totalTokens`, `inputTokens`, or similar field inside arbitrary output never becomes LLM usage.
- Prompt and final-answer estimates remain estimates and cannot override a session-level scan snapshot.

## Cost Calculation

- A positive scanner `costUsd` is authoritative for the model/session row.
- Scanner costs use `tokscale` pricing resolution, including its current LiteLLM/OpenRouter data, aliases, tier suffix handling, cache prices, and supported model overrides.
- Cached input, uncached input, output, and cache creation are billed once according to scanner token semantics.
- The dashboard does not infer a nearby model price when neither `tokscale` nor an exact configured override provides a price.
- The UI labels calculated values as estimated API-equivalent cost.

## Existing Bad Data

The fix does not delete command, tool, MCP, hook, or OTel events. After the first successful complete scan, the deterministic session snapshot takes summary precedence and replaces the false 1.42-billion-token aggregate for the affected session. Future ordinary tool outputs cannot create equivalent false usage events.

## Error Handling

- Missing or malformed history files produce diagnostics without stopping other histories.
- A failed or partial scan never prunes the last successful snapshot.
- Pricing lookup failure leaves only that row unpriced and does not discard its token history.
- Scanner startup failure is reported without preventing the collector and dashboard from running.
- Scan cycles do not overlap.

## Verification

- A `PostToolUse` command response containing `totalTokens: 1419637430` produces a tool event with no token usage.
- A recognized Claude `Agent` response with structured usage still records its official total.
- A complete scan over representative active and archived Codex fixtures restores every unique history exactly once.
- The local scanner result includes historical Codex rows and a priced `gpt-5.6-sol` row.
- A session-level scan snapshot overrides poisoned or estimated hook/OTel token totals without removing trace events.
- Scanner cost reaches run and model summaries and the UI renders it as estimated cost rather than `unpriced`.
- CLI, server, web, and desktop smoke tests pass, followed by repository typecheck, build, and `git diff --check`.
