# Agent Tracing

Agent-Trace can ingest local lifecycle hooks from Codex and Claude Code and show
them in the same run timeline as SDK-instrumented agents.

## Quickstart

Start the local collector and dashboard:

```bash
pnpm --filter @agent-trace/cli build
node packages/cli/dist/index.js dev
```

To also scan local agent usage snapshots while the dashboard runs:

```bash
node packages/cli/dist/index.js dev --usage-scan
node packages/cli/dist/index.js dev --usage-scan --usage-sync --usage-home C:\Users\alice
```

The packaged desktop app starts this scanner automatically after its collector
is ready. It performs an initial complete scan and then refreshes every 15
seconds. Set `AGENT_TRACE_USAGE_SCAN=0` (`false` and `off` are also accepted) to
disable automatic desktop scanning.

The scanner passes the local user home directory to `tokscale` by default. If
your shell or app runtime points `HOME` at a sandbox or another user, pass the
real home explicitly:

```bash
node packages/cli/dist/index.js dev --usage-scan --usage-home /Users/alice
node packages/cli/dist/index.js dev --usage-scan --usage-home C:\Users\alice
```

Before a scan, you can inspect which local data sources `tokscale` can see:

```bash
node packages/cli/dist/index.js usage clients --home C:\Users\alice
node packages/cli/dist/index.js usage clients --home C:\Users\alice --json
```

For cache-backed clients, Agent-Trace can ask `tokscale` to sync before
scanning. It does not run browser login flows automatically. If a client needs
login, the CLI and dashboard show the command to run manually:

```bash
node packages/cli/dist/index.js usage sync --clients cursor,antigravity,trae,warp --home C:\Users\alice
node packages/cli/dist/index.js usage --once --sync --home C:\Users\alice
```

Install global hooks in another terminal:

```bash
node packages/cli/dist/index.js install codex --scope user --redaction metadata --surface cli
node packages/cli/dist/index.js install claude-code --scope user --redaction metadata
```

Codex Desktop and CLI share the same Codex config. Use
`install codex --surface desktop` when the shared config is currently used by
Codex Desktop; the last installed surface is the one Agent-Trace reports.

Run Codex or Claude Code normally, then open:

```text
http://localhost:3000/runs
```

Uninstall the hooks with:

```bash
node packages/cli/dist/index.js uninstall codex
node packages/cli/dist/index.js uninstall claude-code
```

## Smoke Test

You can verify hook ingestion without launching either agent. Start the local
collector, then run:

```bash
node examples/agent-hook-smoke.mjs
```

The smoke script posts representative Codex and Claude Code hook payloads to:

- `POST /integrations/codex/hook`
- `POST /integrations/claude-code/hook`

It then reads `/runs/:id/events` and verifies:

- Codex `SessionStart` becomes a `run_started` event.
- Codex `PostToolUse` becomes a successful `tool_call` event.
- Claude Code `PostToolUseFailure` becomes an error `tool_call` event.
- Raw prompts are not persisted.
- Executed shell commands are persisted so the dashboard can show what ran.

## Token Usage

Agent-Trace stores official usage numbers when the agent source provides them.
When official usage is missing, it estimates exposed Codex and Claude Code hook
prompt/output text locally with a tiktoken-compatible tokenizer and marks those
values as `estimated`.

For the most accurate local session totals, Agent-Trace can also run a
`tokscale` usage scan and ingest the summary rows at
`POST /integrations/usage-scan`. By default Agent-Trace does not pass a tokscale
client filter, so the scan includes every client supported by the installed
tokscale version. Pass `--clients` only when a narrower scan is intentional.

```bash
node packages/cli/dist/index.js usage --once
node packages/cli/dist/index.js usage --watch --interval-ms 15000
node packages/cli/dist/index.js usage --once --home C:\Users\alice
node packages/cli/dist/index.js usage --once --sync --home C:\Users\alice
```

Usage scan snapshots are stored as session-scoped token events with
`metadata.tokenUsage.sourceKind = "scan"` and `scope = "session"`. When a scan
snapshot exists for a run, the dashboard summary prefers that session total over
hook-only text estimates to avoid double counting.
For Codex, `tokscale` rollout session IDs are normalized back to the Codex UUID
run ID, so historical scan rows merge into existing hook/OTel timelines instead
of creating duplicate runs.

Agent-Trace also reconciles JSONL under both `~/.codex/sessions` and
`~/.codex/archived_sessions`. It fingerprints only timestamps, model context,
and token-count metadata. Copies created by restore/archive workflows collapse
into one logical history. A unique non-empty history omitted by the primary
scan is copied to an isolated temporary home and parsed by tokscale, preserving
the same token and pricing authority without parsing, retaining, or uploading
conversation text.

Usage scans may also send scanner diagnostics. The collector stores these on
`run_usage_scan_status` as JSON metadata: client, status, message count, path
existence, warning, and action hint. Prompt text, assistant responses, file
contents, and raw source logs are not sent.

The official usage parser recognizes the common response shapes from mainstream
providers:

- OpenAI-compatible APIs, including OpenAI, xAI, DeepSeek, Mistral, and similar
  chat-completion responses: `input_tokens`/`output_tokens` or
  `prompt_tokens`/`completion_tokens`, `total_tokens`, cached prompt details,
  and reasoning token details.
- Anthropic Claude: `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, and `cache_read_input_tokens`.
- Google Gemini: `usageMetadata.promptTokenCount`,
  `candidatesTokenCount`, `cachedContentTokenCount`, `toolUsePromptTokenCount`,
  `thoughtsTokenCount`, and `totalTokenCount`.
- Cohere: `usage.tokens.input_tokens` and `usage.tokens.output_tokens`, falling
  back to `usage.billed_units` when raw token counts are not present.
- Amazon Bedrock Converse: `inputTokens`, `outputTokens`, `totalTokens`,
  `cacheReadInputTokens`, and `cacheWriteInputTokens`.

For Codex, prefer the official OpenTelemetry log export when you need accurate
token usage. Configure Codex with an OTLP/HTTP JSON log exporter that points at
the local collector:

```toml
[otel]
log_user_prompt = false
exporter = { otlp-http = {
  endpoint = "http://localhost:4319/integrations/codex/otel/v1/logs",
  protocol = "json"
}}
```

Codex OTel `response.completed`/SSE usage fields are normalized into
`metadata.tokenUsage` as official usage. The collector also accepts the same
payload at `/v1/logs` for OTLP-compatible local testing.
When Codex telemetry exposes reasoning output tokens, Agent-Trace stores them in
`metadata.tokenUsage.reasoningOutput`. If the payload does not provide an
official total, Agent-Trace includes those reasoning tokens in the derived
`total`; if an official `total_tokens` value is present, that value remains
authoritative to avoid double counting.

For Claude Code, Agent-Trace reads usage fields that are present in hook payloads.
Completed Claude Code `Agent` tool responses can include `totalTokens` and a
`usage` object with `input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, and `cache_read_input_tokens`; Agent-Trace stores
those directly without recalculating them. When a Claude Code `Stop` hook omits
usage fields but provides `transcript_path`, Agent-Trace reads the tail of that
JSONL transcript and prefers the latest assistant `message.usage` over local
text estimates. If Claude Code omits the model name from hook payloads,
Agent-Trace also uses the transcript tail to recover the latest assistant model
metadata. It does not persist transcript content.

When hook payloads and transcript usage are both absent, Agent-Trace estimates
exposed `UserPromptSubmit.prompt` input and `Stop.last_assistant_message`
output locally.

Fallback estimates only cover text that Codex and Claude Code hooks expose to
the collector, such as `UserPromptSubmit.prompt` and
`Stop.last_assistant_message`. They do not include hidden reasoning, unexposed
system context, conversation history, or tool payloads that remain redacted.
For exact preflight counts without provider usage fields, use each provider's
official token-counting endpoint or SDK where available.

## Cost Estimates

The dashboard prefers costs supplied by usage scans, because `tokscale` can keep
its pricing data current outside the Agent-Trace release cycle. If a scan row
contains `costUsd`, that stored cost is shown directly and converted to CNY when
an exchange rate is available.

When no stored cost is available, Agent-Trace only calculates cost for models
that have an exact `AGENT_TRACE_MODEL_PRICES_JSON` or
`TOOLTRACE_MODEL_PRICES_JSON` entry. Unconfigured models are shown as unpriced
instead of being guessed from stale built-in rates.

```bash
AGENT_TRACE_MODEL_PRICES_JSON='{"my-model":{"provider":"openai","input":1,"cachedInput":0.1,"output":5}}'
```

Reasoning tokens from scan rows are displayed separately but are not added on
top of the scanner-provided `totalTokens`; the scanner/provider total remains
authoritative.

When a scan row has no cost and an exact configured price is available,
Agent-Trace treats scanner `input` as uncached input and bills cached input
separately. Official provider usage keeps its provider-native inclusive-input
semantics. This prevents cache tokens from being subtracted or billed twice.

Set `AGENT_TRACE_ENDPOINT` to target a non-default collector:

```bash
AGENT_TRACE_ENDPOINT=http://localhost:4319 node examples/agent-hook-smoke.mjs
```

## Privacy Defaults

The first tracing mode is `metadata`. In this mode Agent-Trace stores:

- agent source, such as `codex` or `claude-code`
- session, turn, prompt, and tool-use IDs when hooks provide them
- hook event names, tool names, status, duration, model, permission mode, and
  redaction level
- executed command text for command tools
- official token usage when the source event provides it, or local estimates
  when exposed hook prompt/output text is the only available source
- usage-scan summary rows from `tokscale`, including client, session, model,
  aggregate token counts, aggregate USD cost, message count, and timestamps
- usage-scan diagnostics from `tokscale clients`, including client, status,
  aggregate message count, local path existence, warning, and action hint
- payload sizes or text lengths for prompts and non-command tool input/output

Agent-Trace does not store these fields by default:

- raw prompts
- raw tool input or output
- file contents
- hidden model reasoning
- raw `tokscale` source logs or transcript contents

Future debug modes may opt in to richer content capture, but that should remain
explicit and separate from the default metadata mode.

## Known Limits

- The hook integration records events that Codex and Claude Code expose through
  local hooks; it does not capture hidden reasoning.
- Cloud-hosted or web-only agent internals are not visible unless they emit
  events through a supported local hook or future telemetry adapter.
- Claude Code transcript parsing is best-effort and limited to assistant model
  metadata and explicit `message.usage` token fields.
- Token usage prefers source-provided official fields or Codex OTel. Hook-only
  prompt/output payloads from Codex or Claude Code use local estimates and are
  marked as estimated.
- Usage scanning depends on local `tokscale` support for each agent. If
  `tokscale` cannot read a client database or log directory, Agent-Trace keeps
  showing hook and SDK data without failing the dashboard.
- If usage scanning returns no rows but local history exists, check the home
  directory used by the process and pass `--home` or `--usage-home` explicitly.
- If Cursor has no rows, check `agent-trace usage clients --home <path>`.
  Cursor usage needs Tokscale's cache files. Run `tokscale cursor login`, then
  `tokscale cursor sync --json --home <path>`, and scan again.
- "Not detected" usually means one of three things: this machine has no local
  records for that agent, the agent requires login/sync before local caches are
  available, or `tokscale` does not currently support local parsing for that
  source.
