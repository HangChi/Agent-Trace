# Deployment and operations

## Supported models

- Source mode: the CLI starts the Hono Collector, Next.js Dashboard, and optional Usage Scanner.
- Windows desktop mode: Electron manages packaged Server, Web, and CLI runtimes.

Requirements are Node.js `>=22.12.0` and pnpm `>=11.0.7 <12`; reproducible installs and CI pin 11.0.7. The desktop installer is configured for Windows x64 and NSIS.

## Source mode

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js dev
```

- Collector: `http://127.0.0.1:4319`
- Dashboard: `http://localhost:3000/runs`
- Health: `GET http://127.0.0.1:4319/health`

## Windows desktop

```bash
pnpm build
pnpm desktop:dev
pnpm desktop:pack:win
pnpm desktop:build:win
```

Artifacts are written to `apps/desktop/release`. The installer is per-user and currently removes Electron `userData` during uninstall, including the database and preferences.

## Ports

| Process | Default | Behavior |
| --- | --- | --- |
| Collector | 4319 | Fixed configured port; desktop startup fails when occupied. |
| Dashboard | 3000 | Desktop searches 3000–3099 unless explicitly configured. |

## Data locations

Source mode:

- Database: `agent-trace.db` in the current working directory.
- Override: `AGENT_TRACE_DB_PATH`.

Desktop mode:

- Database: Electron `userData/agent-trace.db`.
- Preferences: `userData/preferences.json`.
- Extracted runtimes: `userData/runtime/`.

## Environment variables

Collector and Dashboard:

- `AGENT_TRACE_DB_PATH`
- `AGENT_TRACE_SERVER_HOST`
- `AGENT_TRACE_SERVER_PORT`
- `AGENT_TRACE_WEB_PORT`
- `AGENT_TRACE_API_URL`
- `AGENT_TRACE_ENDPOINT`
- `AGENT_TRACE_DESKTOP_PREFERENCES_PATH`
- `AGENT_TRACE_RUNNING_STALE_MINUTES`
- `AGENT_TRACE_STALE_RUN_MINUTES`

Usage and history:

- `AGENT_TRACE_USAGE_SCAN`
- `AGENT_TRACE_USAGE_CLIENTS`
- `AGENT_TRACE_USAGE_HOME`
- `TOKSCALE_HOME`
- `AGENT_TRACE_HISTORY_CONTENT`
- `AGENT_TRACE_TOKSCALE_BIN`
- `AGENT_TRACE_COLLECTOR_URL`

Cost:

- `AGENT_TRACE_MODEL_PRICES_JSON`
- `AGENT_TRACE_USD_CNY_RATE`
- `AGENT_TRACE_EXCHANGE_RATE_URL`

Integrations and examples:

- `CODEX_HOME`
- `CLAUDE_CONFIG_DIR`
- `AGENT_TRACE_EXAMPLE_TASK`
- `AGENT_TRACE_EXAMPLE_FAIL`

The matching `TOOLTRACE_*` names remain migration aliases on supported paths. New deployments should use `AGENT_TRACE_*`. See the Chinese [operations reference](../deployment-operations.md#环境变量) for defaults and precedence.

## Database backup

1. Stop the CLI or exit the desktop application.
2. Copy the database together with matching `-wal` and `-shm` files when present.
3. Restore using the same or a newer Agent-Trace version.

Do not copy only the main database file while the Collector is writing.

## Maintenance and capacity

- `GET /maintenance/storage`: database byte size and Run/Event/Usage/Tombstone counts.
- `POST /maintenance/prune`: delete history before a cutoff, optionally restricted by status.
- `POST /maintenance/compact`: checkpoint WAL and vacuum SQLite during a quiet local period.
- `pnpm --filter @agent-trace/server benchmark:capacity`: enforce the 100,000 Run / 1,000,000 Event latency, heap, and database-size budgets.
- `pnpm --filter @agent-trace/desktop test:e2e`: launch and stop the real Electron/Collector/Dashboard lifecycle.
- `desktop-release-validation.yml`: install the previous NSIS release, upgrade, launch, exit, and uninstall.

## Operational checks

- `/health`: Collector availability.
- `/usage/scanner`: last scan, diagnostics, and errors.
- `/usage/summary`: stored Usage Snapshot.
- Run list: SDK/Hook/OTel ingestion and read model.

The Collector has no authentication. Any non-loopback deployment must add network isolation and access control outside Agent-Trace.
