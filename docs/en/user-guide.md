# Agent-Trace user guide

## Requirements

- Node.js `>=22.12.0`; `.nvmrc` selects Node.js 22.
- pnpm `>=11.0.7 <12`; reproducible installs and CI pin 11.0.7.
- Windows x64 for desktop installer builds.

## Start from source

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js dev
```

Open <http://localhost:3000/runs>. The Collector listens on <http://127.0.0.1:4319>.

Disable the default local history scanner when needed:

```bash
node packages/cli/dist/index.js dev --usage-scan=false
```

## CLI commands

The built executable can be replaced with `node packages/cli/dist/index.js` inside the repository.

| Command | Purpose |
| --- | --- |
| `agent-trace dev` | Start Collector, Dashboard, and the optional Usage Scanner. |
| `agent-trace usage --once` | Run one local usage scan. |
| `agent-trace usage --watch` | Scan repeatedly. |
| `agent-trace usage clients --home <path>` | Inspect `tokscale` client diagnostics. |
| `agent-trace usage sync --clients <clients> --home <path>` | Synchronize supported client caches. |
| `agent-trace install codex` | Install Codex Hooks and OTel settings. |
| `agent-trace install claude-code` | Install Claude Code Hooks. |
| `agent-trace uninstall codex` | Remove Agent-Trace-managed Codex entries. |
| `agent-trace uninstall claude-code` | Remove Agent-Trace-managed Claude Code entries. |

Run `agent-trace <command> --help` for the current options. The Chinese [user guide](../user-guide.md) contains the complete option tables.

## Dashboard

### Run list

- Bounded pagination and manual or optional automatic refresh.
- Search plus status, source, model, and date filters; repeated clicks on Tokens, cost, or duration cycle through descending, ascending, and the default sort. Started cycles through ascending and the default (started descending).
- Tracked/all Run modes.
- Source, status, model, Token, duration, cost, and start time.
- Single and bulk deletion.
- Select 2–5 Runs for a baseline comparison of status, duration, Events, tokens, and cost.
- Fourteen-day volume, success-rate, duration, token, and cost trends.
- Usage ledger and Scanner diagnostics.
- Chinese/English language and light/dark theme.

Deleting a Run removes it from Agent-Trace SQLite and cascades to its Events. It does not delete source history from Codex, Claude Code, OpenCode, or other clients; a later scan may reconstruct the session.

### Run detail

- Keyword, status, event type, category, and visibility filters.
- Timeline and parent-child trace tree.
- Raw Run/Event fields.
- Failure inspection and deterministic insights for repeated actions, retry loops, slow steps, token hotspots, and failure cascades.
- Direct navigation from an insight to any related Event, including across pagination and hidden visibility.
- Metadata-redacted JSON export without prompts, input/output, commands, paths, session ids, or error text.

## TypeScript SDK

```ts
import { startRun } from "@agent-trace/sdk";

const run = startRun({
  name: "research-agent",
  input: { task: "Research MCP" }
});

try {
  const result = await run.traceLLM(
    "plan",
    { prompt: "Create a plan" },
    () => callModel()
  );
  await run.end(result);
} catch (error) {
  await run.fail(error);
  throw error;
}
```

`startRun` accepts an optional `endpoint` and `timeoutMs`. The default endpoint is `http://localhost:4319`; the default timeout is 1000 ms. Delivery errors are swallowed so instrumentation does not change the Agent result.

## Install global Hooks

```bash
node packages/cli/dist/index.js install codex
node packages/cli/dist/index.js install claude-code
```

Important behavior:

- Scope is currently user-only.
- Redaction is currently metadata-only.
- Codex accepts `--surface cli|desktop`.
- Existing user configuration is preserved.
- A timestamped `.agent-trace-backup.*` file is created before changes.
- Reinstalling replaces only Agent-Trace-managed entries.
- Restart Codex after changing OTel settings.

Uninstall:

```bash
node packages/cli/dist/index.js uninstall codex
node packages/cli/dist/index.js uninstall claude-code
```

## Scan local usage and sessions

```bash
node packages/cli/dist/index.js usage --once
node packages/cli/dist/index.js usage --watch --interval-ms 15000
node packages/cli/dist/index.js usage clients --home <path> --json
```

Prompt content modes:

- `preview` (default): store a cleaned prompt preview of at most 240 characters.
- `metadata`: store timestamps, token counts, tools, and session metadata without prompt text.

For sensitive projects:

```powershell
$env:AGENT_TRACE_HISTORY_CONTENT = "metadata"
node packages/cli/dist/index.js usage --once
```

Switching to metadata mode does not remove previews already stored in SQLite.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Collector does not start | Port 4319 and `AGENT_TRACE_SERVER_PORT`. |
| Dashboard does not load | Port 3000 and `AGENT_TRACE_API_URL`. |
| Hooks produce no Runs | Collector URL, managed Hook entries, Codex restart, and `examples/agent-hook-smoke.mjs`. |
| Scanner is stale | `AGENT_TRACE_USAGE_SCAN`, `usage clients`, client sync, and the real user home. |
| Cost is missing | Scanner `costUsd` or an exact `AGENT_TRACE_MODEL_PRICES_JSON` entry. |
| Sensitive preview exists | Stop services, delete the relevant Run/database, then switch to metadata mode. |

See [deployment and operations](deployment-operations.md) for ports, paths, environment variables, and backups.
