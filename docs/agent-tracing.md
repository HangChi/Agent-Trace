# Agent Tracing

ToolTrace can ingest local lifecycle hooks from Codex and Claude Code and show
them in the same run timeline as SDK-instrumented agents.

## Quickstart

Start the local collector and dashboard:

```bash
pnpm --filter @tooltrace/cli build
node packages/cli/dist/index.js dev
```

Install global hooks in another terminal:

```bash
node packages/cli/dist/index.js install codex --scope user --redaction metadata
node packages/cli/dist/index.js install claude-code --scope user --redaction metadata
```

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

ToolTrace stores official usage numbers when the agent source provides them.
When official usage is missing, it estimates exposed Codex and Claude Code hook
prompt/output text locally with a tiktoken-compatible tokenizer and marks those
values as `estimated`.

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
When Codex telemetry exposes reasoning output tokens, ToolTrace stores them in
`metadata.tokenUsage.reasoningOutput`. If the payload does not provide an
official total, ToolTrace includes those reasoning tokens in the derived
`total`; if an official `total_tokens` value is present, that value remains
authoritative to avoid double counting.

For Claude Code, ToolTrace reads usage fields that are present in hook payloads.
Completed Claude Code `Agent` tool responses can include `totalTokens` and a
`usage` object with `input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, and `cache_read_input_tokens`; ToolTrace stores
those directly without recalculating them. When those fields are absent,
ToolTrace estimates exposed `UserPromptSubmit.prompt` input and
`Stop.last_assistant_message` output locally.
If Claude Code omits the model name from hook payloads, ToolTrace also
opportunistically reads the tail of the hook-provided `transcript_path` JSONL
file to recover the latest assistant model metadata. It does not persist
transcript content.

Fallback estimates only cover text that Codex and Claude Code hooks expose to
the collector, such as `UserPromptSubmit.prompt` and
`Stop.last_assistant_message`. They do not include hidden reasoning, unexposed
system context, conversation history, or tool payloads that remain redacted.

## Cost Estimates

The dashboard estimates API-equivalent cost from source-provided token usage.
For OpenAI models, the built-in table uses the current Standard API rates per
1M tokens. Cached input tokens use the cached-input rate, and generated tokens
use the output rate.

Reasoning tokens are treated as billable output tokens. Some OpenAI responses
report `output_tokens` with reasoning already included; some Codex telemetry
streams expose visible output and `reasoningOutput` separately. ToolTrace uses
`total - input` when an official or derived total is available, so it includes
separate reasoning tokens without double-counting responses where output already
contains reasoning.

Anthropic cache usage is priced with the provider's cache multipliers: 5-minute
cache writes at 1.25x input and cache reads at 0.1x input. You can override or
add model rates with `TOOLTRACE_MODEL_PRICES_JSON`. Model labels without a
public rate, such as workflow-specific Codex labels, remain shown as unpriced.

Set `TOOLTRACE_ENDPOINT` to target a non-default collector:

```bash
TOOLTRACE_ENDPOINT=http://localhost:4319 node examples/agent-hook-smoke.mjs
```

## Privacy Defaults

The first tracing mode is `metadata`. In this mode ToolTrace stores:

- agent source, such as `codex` or `claude-code`
- session, turn, prompt, and tool-use IDs when hooks provide them
- hook event names, tool names, status, duration, model, permission mode, and
  redaction level
- executed command text for command tools
- official token usage when the source event provides it, or local estimates
  when exposed hook prompt/output text is the only available source
- payload sizes or text lengths for prompts and non-command tool input/output

ToolTrace does not store these fields by default:

- raw prompts
- raw tool input or output
- file contents
- hidden model reasoning

Future debug modes may opt in to richer content capture, but that should remain
explicit and separate from the default metadata mode.

## Known Limits

- The hook integration records events that Codex and Claude Code expose through
  local hooks; it does not capture hidden reasoning.
- Cloud-hosted or web-only agent internals are not visible unless they emit
  events through a supported local hook or future telemetry adapter.
- Claude Code transcript parsing is best-effort and limited to model metadata.
- Token usage prefers source-provided official fields or Codex OTel. Hook-only
  prompt/output payloads from Codex or Claude Code use local estimates and are
  marked as estimated.
