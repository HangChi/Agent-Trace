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

ToolTrace does not estimate token counts from text length. It only stores usage
numbers when the agent source provides them.

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
`metadata.tokenUsage`. The collector also accepts the same payload at `/v1/logs`
for OTLP-compatible local testing.

For Claude Code, ToolTrace reads usage fields that are present in hook payloads.
Completed Claude Code `Agent` tool responses can include `totalTokens` and a
`usage` object with `input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, and `cache_read_input_tokens`; ToolTrace stores
those directly without recalculating them.

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
- token usage when the source event provides official usage fields
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
- ToolTrace intentionally does not rely on unstable transcript file formats.
- Token and cost fields are shown only when provided by the source event or
  Codex OTel. Hook-only payloads may not include token usage.
