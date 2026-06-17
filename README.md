# ToolTrace

[中文](README.zh-CN.md)

Local-first DevTools for AI agents.

ToolTrace records LLM calls, tool invocations, token usage, latency, outputs, and errors during an agent run, then shows the execution as a timeline.

## Why

AI agents fail in strange ways:

- They call the wrong tool.
- They repeat the same action.
- They exceed token budgets.
- They hide intermediate tool errors.
- They produce the right answer for the wrong reason.

ToolTrace helps you see what actually happened.

## Quickstart

Install dependencies:

```bash
pnpm install
```

Start the local collector and dashboard:

```bash
pnpm --filter @tooltrace/cli build
node packages/cli/dist/index.js dev
```

In another terminal, run the demo agent:

```bash
pnpm --filter @tooltrace/schema build
pnpm --filter @tooltrace/sdk build
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
import { startRun } from "@tooltrace/sdk";

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

Instead of editing config files by hand, ToolTrace can install global tracing hooks for Codex and Claude Code. The hooks forward lifecycle, prompt, and tool events to the local collector.

```bash
pnpm --filter @tooltrace/cli build

node packages/cli/dist/index.js install codex --scope user --redaction metadata
node packages/cli/dist/index.js install claude-code --scope user --redaction metadata
```

Remove them again with:

```bash
node packages/cli/dist/index.js uninstall codex
node packages/cli/dist/index.js uninstall claude-code
```

- `install codex` writes a ToolTrace-managed block into `~/.codex/hooks.json`.
- `install claude-code` writes a ToolTrace-managed block into `~/.claude/settings.json`.
- A timestamped `.tooltrace-backup.<timestamp>` file is created before any change.
- Re-running install is idempotent, and uninstall removes only ToolTrace-managed entries, leaving your own hooks untouched.
- `CODEX_HOME` and `CLAUDE_CONFIG_DIR` override the config directories; `TOOLTRACE_COLLECTOR_URL` (or `--collector-url`) overrides the collector base URL.
- By default, hooks use metadata redaction. ToolTrace stores event names, tool names, executed shell commands, IDs, statuses, durations, models, official token usage when provided, and payload sizes for non-command tool input/output. It does not store raw prompts, full non-command tool input/output, file contents, or hidden reasoning.
- For accurate Codex token usage, configure the official Codex OTel JSON log exporter to `http://localhost:4319/integrations/codex/otel/v1/logs`; ToolTrace does not estimate tokens from text length.

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
  cli/             tooltrace dev command
examples/
  simple-agent/    fake agent demo
  agent-hook-smoke.mjs  Codex/Claude Code hook ingestion smoke
docs/
  architecture.md  MVP architecture notes
  agent-tracing.md Codex and Claude Code tracing guide
```

## Useful Commands

```bash
pnpm --filter @tooltrace/schema build
pnpm --filter @tooltrace/server db:init
pnpm --filter @tooltrace/server dev
pnpm --filter @tooltrace/web dev
pnpm --filter @tooltrace/sdk smoke
pnpm --filter simple-agent dev
node examples/agent-hook-smoke.mjs
```

Generate a failing demo run for the failure inspector:

```bash
TOOLTRACE_EXAMPLE_FAIL=1 pnpm --filter simple-agent dev
```

On Windows PowerShell:

```powershell
$env:TOOLTRACE_EXAMPLE_FAIL = "1"
pnpm --filter simple-agent dev
```

## API

- `GET /health`
- `POST /runs`
- `PATCH /runs/:id`
- `POST /events`
- `POST /integrations/codex/hook`
- `POST /integrations/claude-code/hook`
- `GET /runs`
- `GET /runs/:id/events`
- `DELETE /runs/:id`

## Contribution Workflow

- Keep commits meaningful and conventional, for example `feat(sdk): add traceTool wrapper`.
- Keep PRs small. One PR should implement one feature or change one behavior.
- PR descriptions should include function, implementation notes, and testing steps.
- Do not commit SQLite database files, build output, local environment files, or `.next` caches.
