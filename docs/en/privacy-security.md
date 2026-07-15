# Privacy and security

For vulnerability reporting and incident response, read the repository [security policy](../../SECURITY.md).

## Security model

Agent-Trace is designed for a single-machine development environment. The Collector listens on `127.0.0.1` by default and stores data in local SQLite. It has no authentication, authorization, or tenant isolation.

CORS only controls browser access. It does not protect non-browser clients and must not be treated as authentication.

## Collection boundaries

| Source | Stored | Not stored by default |
| --- | --- | --- |
| TypeScript SDK | Caller-provided input/output, errors, latency, metadata | No automatic redaction; omitted data is not inferred |
| Codex/Claude Hooks | Lifecycle/session IDs, source, working directory, tool/skill/MCP names, shell commands, status, latency, model, controlled payload sizes | Raw user prompts, normal tool payloads/results, files, full final answer, hidden reasoning |
| Codex OTel | Normalized session, model, tool, command, token, and status metadata | User prompt logging is configured off |
| Usage Scanner | Client/session/model/provider, tokens, messages, time, cost, diagnostics | Full source logs are not submitted directly |
| Transcript preview | Cleaned prompt preview, time, tokens, tools, session metadata | Assistant prose, full tool results, file contents |
| Transcript metadata | Time, tokens, tools, session metadata | Prompt text |

## Redaction

Hooks currently use metadata redaction. Shell commands remain visible because they are diagnostic evidence; commands can still contain paths, arguments, or secrets.

Dashboard redacted export is a separate sharing-safety layer. It omits Run/Event names, prompts, input/output, commands, paths, session ids, error text, and stacks, and replaces original ids with stable pseudonyms. Review agent, model, tool, MCP, and Skill names against the recipient and project policy before sharing.

The SDK serializes values supplied by the caller. Remove credentials, personal data, and protected content before passing input/output to the SDK.

## Prompt preview mode

- `preview` (default): stores a cleaned preview up to 240 characters.
- `metadata`: stores no prompt text.

```powershell
$env:AGENT_TRACE_HISTORY_CONTENT = "metadata"
node packages/cli/dist/index.js usage --once
```

Changing modes does not remove previews already stored in SQLite.

## External network access

Core tracing and local display do not require an Agent-Trace cloud service. External access may occur when:

- installing dependencies or building Electron packages;
- explicitly running a supported `tokscale sync`;
- fetching the default USD/CNY exchange rate.

Set a positive `AGENT_TRACE_USD_CNY_RATE` to disable exchange-rate requests.

## Cost interpretation

`official`, `scan`, and `estimate` identify the usage source. Displayed cost is an API-equivalent estimate and is not a subscription invoice or proof of billing.

## Deletion and retention

Deleting a Run removes it and its Events from Agent-Trace SQLite and stores a Run tombstone. It does not modify Codex, Claude Code, OpenCode, or other source history, but Hook, OTel, and Transcript Scanner ingestion will not recreate the Run while the tombstone exists. `DELETE /runs/:id/tombstone` explicitly allows collection again.

Use `GET /maintenance/storage` for capacity counters, `POST /maintenance/prune` for date/status retention cleanup, and `POST /maintenance/compact` to reclaim SQLite space. Pruning keeps tombstones by default.

To clear all local Agent-Trace data, stop all writers before removing the database and matching WAL/SHM files. This action is irreversible.
