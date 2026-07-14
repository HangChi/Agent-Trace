# Agent-Trace

[中文](README.md) · [Documentation](docs/README.md)

Agent-Trace is a local-first observability tool for AI agents. It collects agent runs, model and tool events, token usage, latency, errors, and local session summaries into SQLite, then presents them in a web or Windows desktop dashboard.

## Highlights

- TypeScript SDK for explicit run, LLM, and tool instrumentation.
- Global lifecycle hooks for Codex and Claude Code.
- Codex OTel JSON ingestion for model and token telemetry.
- Local usage and session scanning through `tokscale`.
- Run summaries, filtering, timelines, trace trees, failure inspection, and deterministic diagnostics.
- Local Hono collector, bilingual Next.js dashboard, and Electron desktop packaging.

## Quick start

The repository does not declare a minimum Node.js version. Install a Node.js release compatible with the current dependencies and pnpm 11.0.7, then run:

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js dev
```

Open <http://localhost:3000/runs>. The collector listens on <http://127.0.0.1:4319> by default.

Generate a sample run in another terminal:

```bash
pnpm --filter simple-agent dev
```

The detailed documentation is maintained in Chinese. Start with the [documentation index](docs/README.md), [user guide](docs/user-guide.md), [architecture](docs/architecture.md), or [API reference](docs/api-reference.md).

Cost values shown by Agent-Trace are API-equivalent estimates, not subscription invoices or proof of billing.
