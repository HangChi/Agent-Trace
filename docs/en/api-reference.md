# Agent-Trace Collector API

The machine-readable contract is [OpenAPI 3.1](../openapi.yaml). The full field-by-field narrative is available in the Chinese [API reference](../api-reference.md).

## Basics

- Base URL: `http://127.0.0.1:4319`
- Format: JSON
- Authentication: none
- Rate limiting: none
- Deployment: loopback only by default

The Collector must not be exposed directly to an untrusted network. CORS restrictions are not authentication.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Collector health |
| GET | `/changes` | SSE change notifications |
| POST | `/runs` | Create a Run |
| PATCH | `/runs/:id` | Update a Run |
| PATCH | `/runs/:id/organization` | Update project metadata and annotations |
| POST | `/events` | Create an Event |
| POST | `/integrations/codex/hook` | Ingest Codex Hook data |
| POST | `/integrations/claude-code/hook` | Ingest Claude Code Hook data |
| POST | `/integrations/codex/otel/v1/logs` | Ingest Codex OTLP/HTTP JSON |
| POST | `/v1/logs` | Desktop-compatible OTLP path |
| POST | `/integrations/usage-scan` | Ingest Usage and Transcript snapshots |
| GET | `/usage/summary` | Aggregate local usage |
| GET | `/usage/scanner` | Scanner status |
| GET | `/runs` | Paginated Run read model |
| DELETE | `/runs` | Delete multiple Runs |
| GET | `/runs/:id` | Get one Run |
| GET | `/runs/:id/events` | Paginated Event read model |
| GET | `/runs/:id/insights` | Deterministic full-Trace insights |
| DELETE | `/runs/:id` | Delete one Run |
| DELETE | `/runs/:id/tombstone` | Allow a deleted Run id to be collected again |
| GET | `/maintenance/storage` | Database size and row counts |
| GET | `/maintenance/tombstones` | List deleted Run tombstones |
| GET | `/maintenance/privacy` | Read pre-storage redaction settings |
| PUT | `/maintenance/privacy` | Update pre-storage redaction settings |
| POST | `/maintenance/prune` | Retention cleanup by date and status |
| POST | `/maintenance/compact` | Checkpoint WAL and vacuum SQLite |

## Error behavior

Validation and query failures use a machine-readable body:

```json
{
  "error": "invalid_run"
}
```

Schema failures may include `issues`. Common statuses are `400` for invalid input and `404` for a missing Run.

Integration endpoints return `202` even when normalization fails. Check the body:

```json
{
  "ok": true,
  "stored": false,
  "error": "Unsupported hook payload"
}
```

This behavior prevents observability failures from blocking the upstream Agent.

## Pagination and compatibility

`GET /runs` accepts:

- `includeUntracked=1|true`
- `page` (minimum 1)
- `pageSize` (default 50, maximum 200)
- `q`, `status`, `source`, `model`, `project`, `environment`, `tag`, and `favorite`
- `startedAfter`, `startedBefore`, `minCostUsd`, and `maxCostUsd`
- `sort=startedAt|name|status|duration|tokens|cost`
- `order=asc|desc`
- `legacy=1|true`

`GET /runs/:id/events` accepts `visibility`, `page`, `pageSize`, `q`, `status`, `type`, `category`, and `legacy`.

Default responses are bounded page objects. `legacy=1|true` returns old, unbounded arrays and should only be used during client migration.

`GET /runs/:id/export` downloads a metadata-redacted JSON snapshot. It preserves status, timestamps, Event topology, durations, tokens, cost, and safe agent/model/tool metadata. Run/Event ids are stable SHA-256-derived pseudonyms; names, prompts, input/output, commands, paths, session ids, error messages, and stacks are omitted.

`GET /analytics/runs/compare?ids=run_1,run_2` compares 2–5 Runs in request order. It returns status, start time, duration, Event and failed-Event counts, tokens, and cost. `GET /analytics/runs/trends?days=14` returns continuous UTC daily points for 1–90 days, including zero-value days.

Event pagination performs filtering, facets, aggregates, ordering, and pagination in SQLite. Full-Trace diagnostics use the separate `/runs/:id/insights` route. Dashboard live refresh listens to `/changes`; it falls back to a 15-second poll only when SSE is unavailable.

Deleting a Run creates a tombstone, preventing Hook, OTel, and Transcript Scanner ingestion from recreating it. Delete `/runs/:id/tombstone` before intentionally collecting that id again. Maintenance routes expose capacity, retention cleanup, compaction, tombstone listing, and persistent field-name redaction for subsequent writes.

## Examples

```bash
curl http://127.0.0.1:4319/health
curl "http://127.0.0.1:4319/runs?page=1&pageSize=20"
curl "http://127.0.0.1:4319/runs/run_123"
```

```ts
const response = await fetch("http://127.0.0.1:4319/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: "run_123",
    name: "research-agent",
    status: "running",
    input: { task: "Research MCP" }
  })
});

if (!response.ok) {
  throw new Error(await response.text());
}
```
