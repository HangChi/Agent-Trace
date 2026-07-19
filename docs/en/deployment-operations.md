# Deployment and operations

## Supported models

- Source mode: the CLI starts the Hono Collector, Next.js Dashboard, and optional `tokscale` Usage Scanner.
- Windows desktop mode: Tauri runs an in-process Rust/Axum Collector, the same React Dashboard as the Web app compiled by Vite, and a native read-only scanner for Codex and Claude Code history.

The Collector has no authentication. Agent-Trace does not provide a public-network deployment profile.

## Requirements

Source mode requires Node.js `>=22.12.0` and pnpm `>=11.0.7 <12`; `.nvmrc`, `packageManager`, and CI select the supported versions. Desktop development also requires Rust stable. Building the Windows x64 NSIS installer requires MSVC C++ Build Tools and the Windows SDK.

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
pnpm desktop:dev
pnpm desktop:pack:win
pnpm desktop:build:win
```

`desktop:pack:win` creates a release executable without an installer. `desktop:build:win` writes the NSIS installer to `target/release/bundle/nsis`. The installer is per-user and uses the Microsoft bootstrapper when the Evergreen WebView2 Runtime is missing. The installed application does not contain Node.js, Electron, a Next server, CLI archives, or a `tokscale` sidecar.

Closing the main window hides it to the tray. The tray menu can reopen the window or exit the application. The current implementation has no single-instance lock; another desktop or source instance can reuse a compatible Collector already listening on the fixed port.

## Ports

| Service | Default | Behavior |
| --- | --- | --- |
| Collector | 4319 | Source and desktop modes reuse an existing service when `/health` identifies a compatible Agent-Trace Collector and report unrelated owners clearly. |
| Dashboard | 3000 | Used only by the source-mode Next.js Dashboard. The embedded Tauri Dashboard does not listen on a port. |

## Data locations

Source mode stores `agent-trace.db` in the current working directory unless `AGENT_TRACE_DB_PATH` is set.

Desktop mode stores `agent-trace.db` under Tauri's user-specific `app_data_dir`, unless `AGENT_TRACE_DB_PATH` is set. UI and Collector code are embedded and no runtime extraction directory is created. On first start, `AGENT_TRACE_LEGACY_DB_PATH` may identify an older compatible desktop database to import; standard legacy data directories are checked when it is not set. Imports do not overwrite or delete the source database.

## Environment variables

Source Collector and Dashboard:

- `AGENT_TRACE_DB_PATH`
- `AGENT_TRACE_SERVER_HOST`
- `AGENT_TRACE_SERVER_PORT`
- `AGENT_TRACE_WEB_PORT`
- `AGENT_TRACE_API_URL`
- `AGENT_TRACE_ENDPOINT`
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

Desktop compatibility:

- `AGENT_TRACE_DB_PATH`
- `AGENT_TRACE_LEGACY_DB_PATH`

Cost, integrations, and examples:

- `AGENT_TRACE_MODEL_PRICES_JSON`
- `AGENT_TRACE_USD_CNY_RATE`
- `AGENT_TRACE_EXCHANGE_RATE_URL`
- `CODEX_HOME`
- `CLAUDE_CONFIG_DIR`
- `AGENT_TRACE_EXAMPLE_TASK`
- `AGENT_TRACE_EXAMPLE_FAIL`

Matching `TOOLTRACE_*` names remain migration aliases on supported source-mode paths. New configurations should use `AGENT_TRACE_*`. The Chinese [operations reference](../deployment-operations.md#环境变量) documents defaults and precedence.

## Database backup

1. Stop the CLI or exit the desktop application from its tray menu.
2. Copy the database together with matching `-wal` and `-shm` files when present.
3. Restore using the same or a newer Agent-Trace version.

Do not copy only the main database file while the Collector is writing.

## Maintenance and capacity

- `GET /maintenance/storage`: database byte size and Run/Event/Usage/Tombstone counts.
- `POST /maintenance/prune`: delete history before a cutoff, optionally restricted by status.
- `POST /maintenance/compact`: checkpoint WAL and vacuum SQLite during a quiet local period.
- `pnpm --filter @agent-trace/server benchmark:capacity`: enforce the 100,000 Run / 1,000,000 Event budgets.
- `pnpm desktop:check:rust`: check the shared UI/Tauri contract, run Rust tests, and run workspace Clippy.
- `desktop-release-validation.yml`: build the current Tauri NSIS package and verify that exactly one installer is produced.

## Operational checks

- `/health`: Collector availability.
- `/usage/scanner`: last scan, diagnostics, and errors.
- `/usage/summary`: stored Usage Snapshot.
- Run list: SDK/Hook/OTel ingestion and read-model behavior.

Any non-loopback source deployment must add network isolation and access control outside Agent-Trace.

If either mode finds port 4319 occupied by a compatible Agent-Trace Collector, it reuses that Collector. Source mode then starts only its Next.js Dashboard and scanner; desktop mode starts only its embedded UI and does not open another database or native scanner. If the owning Collector exits, the desktop automatically claims 4319, starts its native scanner, and lets the embedded UI reconnect. An unrelated service is never reused; stop it or select another `AGENT_TRACE_SERVER_PORT` for source mode.
