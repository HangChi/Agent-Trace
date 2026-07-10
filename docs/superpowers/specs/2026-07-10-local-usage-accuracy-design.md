# Local Usage Accuracy Design

## Goal

Make Agent-Trace automatically read all local usage supported by `tokscale`, reconcile Codex records from both `~/.codex/sessions` and `~/.codex/archived_sessions`, avoid duplicate restored or archived sessions, and display authoritative token totals and prices.

## Current Problems

- The CLI derives a missing total as input + output + cache read + cache write + reasoning. Codex/OpenAI reasoning tokens are already included in output, so this double-counts reasoning.
- The default hard-coded client list omits clients added by `tokscale`, so a default scan is not exhaustive.
- The desktop application starts only the collector and dashboard; it does not start the usage scanner.
- Scan snapshots are only upserted. A successful later scan cannot remove stale scan events that no longer exist locally.
- Configured-price fallback treats scanner input like provider-official input. Scanner input excludes cached input, while provider-official input normally includes it, so cached input can be subtracted or billed as output incorrectly.
- Codex has records in both active and archived directories. Restored sessions can appear as different files and session IDs while containing the same token event history.

## Architecture

The existing `tokscale` integration remains the authoritative parser and pricing source. A default scan omits the `--client` filter so every client supported by the installed `tokscale` version is included. Explicit `--clients` and environment configuration still narrow the scan.

A focused Codex reconciliation module indexes JSONL files under both active and archived roots. It reads only session metadata, model context, timestamps, and token-count events. It builds a semantic content fingerprint from the ordered token/model event sequence while excluding the session ID and conversation text. Files with the same fingerprint form one logical history group. A group is covered when any member session ID appears in the main `tokscale` result. Uncovered non-empty groups are presented to a supplemental isolated `tokscale` scan so parsing and pricing still come from the same authority.

The desktop app packages the CLI runtime and starts `usage --watch` after the collector is healthy. The scanner performs one initial complete scan and then runs every 15 seconds without overlapping executions. `AGENT_TRACE_USAGE_SCAN=0` disables automatic desktop scanning.

## Token Semantics

- An explicit source total is authoritative.
- Without an explicit total, scanner totals are `input + output + cacheRead + cacheWrite`.
- Reasoning tokens are tracked for display but are never added on top of output.
- Scanner `input` is uncached input. Official provider `input` may include cached input. Configured-price fallback branches on `sourceKind` so each representation is billed correctly.

## Cost Semantics

Scanner-provided `costUsd` is authoritative. Supplemental Codex records also go through `tokscale`, including its pricing database. Agent-Trace does not infer prices from similar model names. If neither scanner cost nor an exact configured model price exists, the UI reports the model as unpriced.

## Snapshot Replacement

Each complete scan posts a complete snapshot marker. The collector applies it transactionally: upsert current scan events, remove older scan events absent from the successful snapshot, and delete runs only when they were created solely by usage scanning and have no remaining events. Hook and OTel events are never deleted. A failed or partial scan does not prune the last successful snapshot.

## Error Handling

- Scanner failure does not block desktop startup.
- Malformed or unreadable Codex files produce diagnostics and do not stop other clients.
- Temporary supplemental scan directories are removed in `finally` cleanup.
- Missing prices remain explicitly unpriced.
- A scan cycle already in progress causes the next scheduled cycle to be skipped.

## Privacy

Codex reconciliation never posts prompts, assistant responses, tool payloads, file contents, or raw JSONL. Only normalized usage rows and diagnostics reach the collector, matching the existing metadata-only behavior.

## Verification

- A scanner row with input 100, output 20, cache read 10, cache write 5, and reasoning 7 totals 135, not 142.
- Default scanning invokes `tokscale` without a client filter; explicit clients still produce one.
- Duplicate active/archive histories produce one logical usage record.
- A unique archived history omitted by the main scan is included by the supplemental scan.
- Stored scanner cost wins over configured fallback.
- Scan fallback pricing bills uncached and cached input exactly once.
- A complete replacement removes stale scan-only events without touching hook/OTel events.
- Desktop startup launches one non-overlapping usage watcher after collector readiness.
