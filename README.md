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
docs/
  architecture.md  MVP architecture notes
```

## Useful Commands

```bash
pnpm --filter @tooltrace/schema build
pnpm --filter @tooltrace/server db:init
pnpm --filter @tooltrace/server dev
pnpm --filter @tooltrace/web dev
pnpm --filter @tooltrace/sdk smoke
pnpm --filter simple-agent dev
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
- `GET /runs`
- `GET /runs/:id/events`

## Contribution Workflow

- Keep commits meaningful and conventional, for example `feat(sdk): add traceTool wrapper`.
- Keep PRs small. One PR should implement one feature or change one behavior.
- PR descriptions should include function, implementation notes, and testing steps.
- Do not commit SQLite database files, build output, local environment files, or `.next` caches.
