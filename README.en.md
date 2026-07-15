<p align="center">
  <img src="apps/desktop/assets/icon.svg" width="88" height="88" alt="Agent-Trace icon" />
</p>

# Agent-Trace

<p align="center">Local-first runtime observability, usage analysis, and diagnostics for AI agents.</p>

<p align="center">
  <a href="README.md">中文</a> ·
  <a href="docs/en/README.md">Documentation</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

Agent-Trace collects model calls, tool execution, tokens, API-equivalent cost, latency, errors, and local session history into SQLite. A web or Windows desktop dashboard presents runs, timelines, trace trees, and deterministic diagnostics. Core collection and display do not require a hosted backend.

## Highlights

- TypeScript SDK for explicit Run, LLM, and tool instrumentation.
- Global Codex and Claude Code Hooks for lifecycle and tool metadata.
- Codex OTLP/HTTP JSON ingestion for model and official token telemetry.
- Local `tokscale` scanning for multi-client sessions, tokens, and cost.
- Event filters, timelines, parent-child trace trees, failure inspection, and performance diagnostics.
- Local Hono collector, bilingual Next.js dashboard, and Windows Electron packaging.

## Requirements

- Node.js `>=22.12.0`; `.nvmrc` selects Node.js 22.
- pnpm `>=11.0.7 <12`; `packageManager` and CI pin 11.0.7.
- Windows x64 is required to build the desktop installer.

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js dev
```

Open <http://localhost:3000/runs>. The collector listens on <http://127.0.0.1:4319>.

Generate a sample Run in another terminal:

```bash
pnpm --filter simple-agent dev
```

> [!TIP]
> To avoid scanning local history on first start, use
> `node packages/cli/dist/index.js dev --usage-scan=false`.

## Instrumentation options

### TypeScript SDK

```ts
import { startRun } from "@agent-trace/sdk";

const run = startRun({
  name: "research-agent",
  input: { task: "Research MCP ecosystem" }
});

try {
  const result = await run.traceTool(
    "web_search",
    { query: "MCP ecosystem" },
    () => webSearch("MCP ecosystem")
  );
  await run.end(result);
} catch (error) {
  await run.fail(error);
  throw error;
}
```

Delivery defaults to `http://localhost:4319` with a 1000 ms timeout. Tracing failures do not change the wrapped function's result or exception semantics.

### Codex / Claude Code Hooks

```bash
node packages/cli/dist/index.js install codex
node packages/cli/dist/index.js install claude-code
```

The installer only manages Agent-Trace-marked entries and creates a timestamped backup before changing configuration.

### Local usage and sessions

```bash
node packages/cli/dist/index.js usage --once
node packages/cli/dist/index.js usage clients --home <path>
```

For sensitive projects, set `AGENT_TRACE_HISTORY_CONTENT=metadata` before the first scan to avoid storing prompt previews.

## Workspace

| Path | Responsibility |
| --- | --- |
| `apps/server` | Hono collector, SQLite, integrations, and read models |
| `apps/web` | Next.js dashboard |
| `apps/desktop` | Electron main process and Windows packaging |
| `packages/schema` | Shared Zod contracts and TypeScript types |
| `packages/sdk-js` | JavaScript/TypeScript tracing SDK |
| `packages/cli` | Development orchestration, Hooks, and usage scanning |
| `examples` | SDK and Hook smoke examples |

## Verification

```bash
pnpm verify
```

This runs build, test, type checking, lint, and documentation consistency checks.

## Data, privacy, and cost

> [!WARNING]
> The collector has no authentication and must remain on a loopback interface. Do not expose it directly to an untrusted network.

- Data is stored in local SQLite by default.
- The SDK stores caller-provided input/output and does not redact it automatically.
- Hooks use metadata redaction, but shell commands may still contain sensitive arguments.
- Local history may store cleaned prompt previews unless metadata-only mode is selected.
- All displayed costs are API-equivalent estimates, not subscription invoices.

Read the [privacy and security guide](docs/en/privacy-security.md) before processing sensitive data.

## Documentation

- [English documentation index](docs/en/README.md)
- [User guide](docs/en/user-guide.md)
- [Collector API](docs/en/api-reference.md)
- [Deployment and operations](docs/en/deployment-operations.md)
- [Privacy and security](docs/en/privacy-security.md)
- [System architecture (Chinese)](docs/architecture.md)
- [Domain glossary](CONTEXT.md)
- [Architecture decision records](docs/adr/README.md)
