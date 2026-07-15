from __future__ import annotations

import time
from typing import Any

from ..core import Run, _now


class AgentTraceCallbackHandler:
    """Dependency-free callback handler compatible with LangChain callback method names."""

    def __init__(self, run: Run) -> None:
        self.run = run
        self._active: dict[str, dict[str, Any]] = {}

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: Any,
        parent_run_id: Any = None,
        **_: Any,
    ) -> None:
        self._start(run_id, parent_run_id, "tool_call", serialized.get("name") or "tool", input_str)

    def on_tool_end(self, output: Any, *, run_id: Any, **_: Any) -> None:
        self._end(run_id, output)

    def on_tool_error(self, error: BaseException, *, run_id: Any, **_: Any) -> None:
        self._end(run_id, error=error)

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: Any,
        parent_run_id: Any = None,
        **_: Any,
    ) -> None:
        self._start(run_id, parent_run_id, "llm_call", serialized.get("name") or "llm", prompts)

    def on_llm_end(self, response: Any, *, run_id: Any, **_: Any) -> None:
        self._end(run_id, response)

    def on_llm_error(self, error: BaseException, *, run_id: Any, **_: Any) -> None:
        self._end(run_id, error=error)

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs: Any,
        *,
        run_id: Any,
        parent_run_id: Any = None,
        **_: Any,
    ) -> None:
        self._start(run_id, parent_run_id, "step_ended", serialized.get("name") or "chain", inputs)

    def on_chain_end(self, outputs: Any, *, run_id: Any, **_: Any) -> None:
        self._end(run_id, outputs)

    def on_chain_error(self, error: BaseException, *, run_id: Any, **_: Any) -> None:
        self._end(run_id, error=error)

    def _start(
        self,
        run_id: Any,
        parent_run_id: Any,
        event_type: str,
        name: str,
        input: Any,
    ) -> None:
        self._active[str(run_id)] = {
            "event_id": f"langchain:{run_id}",
            "parent_id": f"langchain:{parent_run_id}" if parent_run_id else None,
            "event_type": event_type,
            "name": name,
            "input": input,
            "timestamp": _now(),
            "started": time.perf_counter(),
        }

    def _end(self, run_id: Any, output: Any = None, error: BaseException | None = None) -> None:
        active = self._active.pop(str(run_id), None)
        if active is None:
            return
        self.run.record_event(
            active["event_type"],
            active["name"],
            event_id=active["event_id"],
            parent_id=active["parent_id"],
            input=active["input"],
            output=output,
            status="error" if error else "success",
            error=error,
            metadata={"framework": "langchain"},
            timestamp=active["timestamp"],
            duration_ms=round((time.perf_counter() - active["started"]) * 1000),
        )
