# Agent-Trace Python SDK

Zero-dependency, fail-open tracing for Python agents. It supports nested Run steps, sync and async decorators, an OpenAI client wrapper, and a LangChain-compatible callback handler.

```python
from agent_trace import AgentTraceClient

client = AgentTraceClient()
with client.start_run("research-agent", metadata={"project": "demo"}) as run:
    with run.trace_step("retrieval", "load-documents"):
        documents = load_documents()
```
