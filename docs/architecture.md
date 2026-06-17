# ToolTrace MVP Architecture

ToolTrace is a local-first agent debugging loop:

```text
User agent
  -> @tooltrace/sdk
  -> Hono collector API
  -> SQLite
  -> Next.js dashboard
```

## Packages

`@tooltrace/schema` defines shared run and trace event contracts. It exports TypeScript types and Zod schemas so SDK, server, and future integrations can agree on the same payload shape.

`@tooltrace/server` owns local persistence and HTTP ingestion. It stores runs and events in SQLite, with JSON fields for input, output, error, and metadata. The API validates request bodies with the shared schema package before writing data. It also accepts Codex OTLP/HTTP JSON logs for official token usage ingestion.

`@tooltrace/sdk` is the user-facing instrumentation layer. It exposes `startRun`, `traceLLM`, `traceTool`, `end`, and `fail`. Step wrappers capture duration, successful output, and thrown errors.

`@tooltrace/web` is the local dashboard. It renders the runs list, run timeline, JSON step detail, token and duration summaries, and the first-pass failure inspector.

`@tooltrace/cli` provides `tooltrace dev`, which initializes SQLite and starts the collector plus dashboard.

## Data Model

A run represents one agent execution. Events represent steps inside the run:

- `llm_call`
- `tool_call`
- `retrieval`
- `memory_update`
- `error`
- lifecycle events such as `run_started` and `run_ended`

Each event can include a `parentId`, which keeps the model ready for tree-shaped traces while the first UI presents a chronological timeline.

## Local Defaults

- Collector: `http://localhost:4319`
- Dashboard: `http://localhost:3000`
- Database: `tooltrace.db`, or `TOOLTRACE_DB_PATH` when set

No data is uploaded by default.

## Current Scope

The MVP intentionally does not include LangChain integration, MCP auto-instrumentation beyond agent hook metadata, auth, team dashboards, or hosted storage. Those are future layers after the local dashboard loop feels solid.
