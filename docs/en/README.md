# Agent-Trace documentation

[中文文档](../README.md)

These pages describe the implemented Agent-Trace behavior. Shared Schema, Collector routes, CLI Help, and automated tests are the source of truth when behavior and prose differ.

## Start here

| Goal | Document |
| --- | --- |
| Install, run, and instrument an Agent | [User guide](user-guide.md) |
| Call the Collector | [API reference](api-reference.md) · [OpenAPI](../openapi.yaml) |
| Deploy source or Windows desktop builds | [Deployment and operations](deployment-operations.md) |
| Understand collected data | [Privacy and security](privacy-security.md) |
| Understand the implementation | [Architecture (Chinese)](../architecture.md) |
| Contribute changes | [Contributing](../../CONTRIBUTING.md) |
| Report a vulnerability | [Security policy](../../SECURITY.md) |
| Review long-lived decisions | [Architecture decisions](../adr/README.md) |

## Core terms

- **Run**: one Agent execution or locally reconstructed session.
- **Event**: one lifecycle, model, tool, retrieval, memory, or error action within a Run.
- **Collector**: local Hono process that normalizes and stores data.
- **Dashboard**: Next.js interface that reads bounded Collector read models.
- **Usage Snapshot**: session-level token and cost aggregation from `tokscale`.
- **Transcript Event**: prompt/turn metadata or cleaned preview extracted from local history.

The complete vocabulary is maintained in the [domain glossary](../../CONTEXT.md).
