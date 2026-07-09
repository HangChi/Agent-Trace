# Agent-Trace

[中文](README.md)

Local-first DevTools for AI agents.

Agent-Trace records LLM calls, tool invocations, token usage, latency, outputs, and errors during an agent run, then shows the execution as a timeline.

## Why

AI agents fail in strange ways:

- They call the wrong tool.
- They repeat the same action.
- They exceed token budgets.
- They hide intermediate tool errors.
- They produce the right answer for the wrong reason.

Agent-Trace helps you see what actually happened.

## Quickstart

Install dependencies:

```bash
pnpm install
```

Start the local collector and dashboard:

```bash
pnpm --filter @agent-trace/cli build
node packages/cli/dist/index.js dev
```

To also scan local agent token/cost usage with `tokscale` while the dashboard
runs:

```bash
node packages/cli/dist/index.js dev --usage-scan --usage-clients codex,claude,opencode,cursor,antigravity,kimi,qwen,copilot
```

During local development, you can also run the CLI from source:

```bash
pnpm --filter @agent-trace/cli exec tsx src/index.ts dev
```

In another terminal, run the demo agent:

```bash
pnpm --filter @agent-trace/schema build
pnpm --filter @agent-trace/sdk build
pnpm --filter simple-agent dev
```

Open the dashboard:

```text
http://localhost:3000/runs
```

The collector API runs on:

```text
http://localhost:4319
```

## SDK Example

```ts
import { startRun } from "@agent-trace/sdk";

const run = startRun({
  name: "research-agent",
  input: { task: "Research MCP ecosystem" }
});

try {
  const plan = await run.traceLLM(
    "planner",
    { prompt: "Research MCP ecosystem" },
    () => callLLM(),
    {
      provider: "openai",
      model: "gpt-4.1",
      tokenUsage: { input: 120, output: 40, total: 160 }
    }
  );

  const results = await run.traceTool(
    "web_search",
    { query: "MCP ecosystem" },
    () => webSearch("MCP ecosystem")
  );

  await run.end({ plan, results });
} catch (error) {
  await run.fail(error);
  throw error;
}
```

Tracing failures are swallowed by the SDK so the user's agent flow is not changed by collector availability.

## Global Tracing Hooks

Instead of editing config files by hand, Agent-Trace can install global tracing hooks for Codex and Claude Code. The hooks forward lifecycle, prompt, and tool events to the local collector.

```bash
pnpm --filter @agent-trace/cli build

node packages/cli/dist/index.js install codex --scope user --redaction metadata --surface cli
# If this shared Codex config is used by Codex Desktop, reinstall with:
# node packages/cli/dist/index.js install codex --scope user --redaction metadata --surface desktop
node packages/cli/dist/index.js install claude-code --scope user --redaction metadata
```

Remove them again with:

```bash
node packages/cli/dist/index.js uninstall codex
node packages/cli/dist/index.js uninstall claude-code
```

- `install codex` writes an Agent-Trace-managed block into `~/.codex/hooks.json`.
- `install claude-code` writes an Agent-Trace-managed block into `~/.claude/settings.json`.
- A timestamped `.agent-trace-backup.<timestamp>` file is created before any change.
- Re-running install is idempotent, and uninstall removes only Agent-Trace-managed entries, leaving your own hooks untouched.
- Codex Desktop and CLI share the same Codex config. Use `install codex --surface cli` or `install codex --surface desktop`; the last installed surface is the one Agent-Trace reports until you reinstall with the other value.
- `CODEX_HOME` and `CLAUDE_CONFIG_DIR` override the config directories; `AGENT_TRACE_COLLECTOR_URL` (or `--collector-url`) overrides the collector base URL.
- By default, hooks use metadata redaction. Agent-Trace stores event names, tool names, executed shell commands, IDs, statuses, durations, models, official token usage when provided, local token estimates when official usage is missing, and payload sizes for non-command tool input/output. It does not store raw prompts, full non-command tool input/output, file contents, or hidden reasoning.
- For the most accurate Codex token usage, configure the official Codex OTel JSON log exporter to `http://localhost:4319/integrations/codex/otel/v1/logs`; hook-only prompt/output token counts from Codex or Claude Code are estimated locally and marked as estimated.
- For accurate cross-agent session totals, run `agent-trace usage --once` or `agent-trace usage --watch --interval-ms 15000`. This posts `tokscale` summary rows for Codex, Claude Code, OpenCode, Cursor, Antigravity, Kimi, Qwen, and GitHub Copilot CLI to `POST /integrations/usage-scan` without sending raw prompts, responses, files, or source logs.
- Cost display prefers scanner-provided `costUsd`. Without scan cost, Agent-Trace only calculates cost for exact `AGENT_TRACE_MODEL_PRICES_JSON` entries; other models are shown as unpriced instead of guessed from stale built-in rates.

To verify hook ingestion without running Codex or Claude Code, start the local collector and run:

```bash
node examples/agent-hook-smoke.mjs
```

See [Agent Tracing](docs/agent-tracing.md) for privacy defaults, smoke testing, and known limitations.

## Workspace

```text
apps/
  server/          Hono collector API and SQLite storage
  web/             Next.js dashboard
packages/
  schema/          shared trace contracts and runtime validation
  sdk-js/          JS/TS tracing SDK
  cli/             agent-trace dev command
examples/
  simple-agent/    fake agent demo
  agent-hook-smoke.mjs  Codex/Claude Code hook ingestion smoke
docs/
  architecture.md  MVP architecture notes
  agent-tracing.md Codex and Claude Code tracing guide
```

## Useful Commands

```bash
pnpm --filter @agent-trace/schema build
pnpm --filter @agent-trace/server db:init
pnpm --filter @agent-trace/server dev
pnpm --filter @agent-trace/web dev
pnpm --filter @agent-trace/cli exec tsx src/index.ts usage --once
pnpm --filter @agent-trace/sdk smoke
pnpm --filter simple-agent dev
node examples/agent-hook-smoke.mjs
```

Generate a failing demo run for the failure inspector:

```bash
AGENT_TRACE_EXAMPLE_FAIL=1 pnpm --filter simple-agent dev
```

On Windows PowerShell:

```powershell
$env:AGENT_TRACE_EXAMPLE_FAIL = "1"
pnpm --filter simple-agent dev
```

## API

- `GET /health`
- `POST /runs`
- `PATCH /runs/:id`
- `POST /events`
- `POST /integrations/codex/hook`
- `POST /integrations/codex/otel/v1/logs`
- `POST /integrations/claude-code/hook`
- `POST /integrations/usage-scan`
- `GET /runs`
- `GET /runs/:id/events`
- `DELETE /runs/:id`

## Contribution Workflow

- Keep commits meaningful and conventional, for example `feat(sdk): add traceTool wrapper`.
- Keep PRs small. One PR should implement one feature or change one behavior.
- PR descriptions should include function, implementation notes, and testing steps.
- Do not commit SQLite database files, build output, local environment files, or `.next` caches.
