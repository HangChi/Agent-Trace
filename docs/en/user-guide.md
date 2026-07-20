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
- Project, environment, version, tags, note, and favorite editing.

### Maintenance and privacy

Use **Maintenance** in the header to inspect capacity, prune or compact local data, allow tombstoned Run ids to be collected again, and configure case-insensitive sensitive field names that are replaced before subsequent Run, Event, and Transcript writes.

## Analytics, budgets, and evaluations

Use **Analytics** in the header to group the last 30 days by project, environment, model, or source. UTC daily/monthly budgets can limit cost, tokens, and Run count; current violations are computed from live data.

When comparing 2–5 Runs, the first Run is the baseline. Events are matched by type, name, and occurrence. New failures, missing baseline Events, or duration/token growth above 20% are regressions.

Use **Evaluations** to create weighted datasets and cases, then attach multidimensional scores to existing Runs. Submitting the same case/Run pair replaces its result; quality is a normalized weighted average.

## Python SDK

```bash
pip install -e packages/sdk-python
```

```python
from agent_trace import AgentTraceClient

client = AgentTraceClient()
with client.start_run("research-agent", metadata={"project": "demo"}) as run:
    with run.trace_step("retrieval", "load-documents"):
        documents = load_documents()
```

`instrument_openai(client, run)` wraps OpenAI chat completions, while `AgentTraceCallbackHandler(run)` implements LangChain callback method names without adding a runtime dependency. Generic OTLP/HTTP JSON exporters can send traces to `http://127.0.0.1:4319/v1/traces`.

## TypeScript SDK

```ts
import { startRun } from "@agent-trace/sdk";

const run = startRun({
  name: "research-agent",
  input: { task: "Research MCP" },
  metadata: { project: "agent-trace", environment: "test", tags: ["sdk"] }
});

try {
  const result = await run.traceLLM(
    "plan",
    { prompt: "Create a plan" },
    () => callModel()
  );
  await run.traceStep("retrieval", "load-documents", {}, async () => {
    await run.traceTool("read-document", { id: "doc-1" }, () => readDocument("doc-1"));
  });
  await run.end(result);
} catch (error) {
  await run.fail(error);
  throw error;
}
```

`startRun` accepts optional Run metadata, `endpoint`, and `deliveryTimeoutMs`. `traceStep` accepts any shared Event type, and nested SDK steps automatically inherit the active parent Event unless `parentId` is explicit. The default endpoint is `http://localhost:4319`; the default timeout is 1000 ms. Delivery errors are swallowed so instrumentation does not change the Agent result.

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
- After upgrading from an older version, rerun `install claude-code` to replace legacy hooks that may contain CMD syntax; custom hooks are not changed.
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

## Safe replay and debug sandbox

Choose **Safe replay** on a Run detail page, or open **Replay** from the header and enter a source Run id. Select an Event, optionally override JSON input and mock output, simulate an error or delay, and set a timeout from 100 to 30000 ms. Blank overrides reuse the source Event data.

Tasks can be queued, running, completed, failed, cancelled, or timed out. A completed task links to its new replay Run and to a source-versus-replay comparison. Queued and running tasks can be cancelled; cancellation and timeout terminate the worker and clean the temporary directory.

Replay only runs the built-in fixed mock worker. It does not run user code, shell commands, or real tool calls. Task and generated Run/Event records remain in local SQLite. See [privacy and security](privacy-security.md) for the full boundary.

See [deployment and operations](deployment-operations.md) for ports, paths, environment variables, and backups.
