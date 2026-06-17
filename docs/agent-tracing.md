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
- Raw prompts and raw tool commands are not persisted.

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
- payload sizes or text lengths for prompts and tool input/output

ToolTrace does not store these fields by default:

- raw prompts
- command text
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
- Token and cost fields are shown when provided by the source event. Hook-only
  payloads may not include token usage.
