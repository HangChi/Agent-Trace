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
| POST | `/runs` | Create a Run |
| PATCH | `/runs/:id` | Update a Run |
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
| DELETE | `/runs/:id` | Delete one Run |

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
- `legacy=1|true`

`GET /runs/:id/events` accepts `visibility`, `page`, `pageSize`, `q`, `status`, `type`, `category`, and `legacy`.

Default responses are bounded page objects. `legacy=1|true` returns old, unbounded arrays and should only be used during client migration.

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
