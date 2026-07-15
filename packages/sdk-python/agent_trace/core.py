from __future__ import annotations

import contextvars
import functools
import inspect
import json
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Callable, Iterator, Mapping
from urllib import request
from urllib.parse import quote

Transport = Callable[[str, dict[str, Any], float], None]


class AgentTraceClient:
    def __init__(
        self,
        endpoint: str = "http://localhost:4319",
        timeout: float = 1.0,
        transport: Transport | None = None,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout
        self._transport = transport or _http_transport

    def start_run(
        self,
        name: str,
        *,
        run_id: str | None = None,
        input: Any = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> "Run":
        return Run(
            client=self,
            run_id=run_id or str(uuid.uuid4()),
            name=name,
            input=input,
            metadata=dict(metadata or {}),
        )

    def _send(self, path: str, payload: dict[str, Any]) -> None:
        try:
            self._transport(f"{self.endpoint}{path}", payload, self.timeout)
        except Exception:
            # Instrumentation must never change the agent result.
            pass


class Run:
    def __init__(
        self,
        *,
        client: AgentTraceClient,
        run_id: str,
        name: str,
        input: Any,
        metadata: dict[str, Any],
    ) -> None:
        self.client = client
        self.id = run_id
        self.name = name
        self._closed = False
        self._parent = contextvars.ContextVar[str | None](
            f"agent_trace_parent_{run_id}", default=None
        )
        payload: dict[str, Any] = {
            "id": run_id,
            "name": name,
            "status": "running",
            "startedAt": _now(),
            "metadata": metadata,
        }
        if input is not None:
            payload["input"] = input
        self.client._send("/runs", payload)

    def __enter__(self) -> "Run":
        return self

    def __exit__(self, error_type: Any, error: BaseException | None, traceback: Any) -> bool:
        if error is None:
            self.end()
        else:
            self.fail(error)
        return False

    @contextmanager
    def trace_step(
        self,
        event_type: str,
        name: str,
        input: Any = None,
        *,
        metadata: Mapping[str, Any] | None = None,
        parent_id: str | None = None,
    ) -> Iterator[str]:
        event_id = str(uuid.uuid4())
        parent = parent_id if parent_id is not None else self._parent.get()
        token = self._parent.set(event_id)
        started_at = _now()
        started = time.perf_counter()
        error: BaseException | None = None
        try:
            yield event_id
        except BaseException as caught:
            error = caught
            raise
        finally:
            self._parent.reset(token)
            self.record_event(
                event_type,
                name,
                event_id=event_id,
                parent_id=parent,
                input=input,
                status="error" if error else "success",
                error=error,
                metadata=metadata,
                timestamp=started_at,
                duration_ms=round((time.perf_counter() - started) * 1000),
            )

    def trace_tool(
        self,
        name: str,
        input: Any = None,
        *,
        metadata: Mapping[str, Any] | None = None,
        parent_id: str | None = None,
    ) -> Iterator[str]:
        return self.trace_step(
            "tool_call", name, input, metadata=metadata, parent_id=parent_id
        )

    def trace_llm(
        self,
        name: str,
        input: Any = None,
        *,
        metadata: Mapping[str, Any] | None = None,
        parent_id: str | None = None,
    ) -> Iterator[str]:
        return self.trace_step(
            "llm_call", name, input, metadata=metadata, parent_id=parent_id
        )

    def trace(self, event_type: str, name: str | None = None) -> Callable[..., Any]:
        def decorate(function: Callable[..., Any]) -> Callable[..., Any]:
            event_name = name or function.__name__
            if inspect.iscoroutinefunction(function):
                @functools.wraps(function)
                async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                    with self.trace_step(event_type, event_name):
                        return await function(*args, **kwargs)

                return async_wrapper

            @functools.wraps(function)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                with self.trace_step(event_type, event_name):
                    return function(*args, **kwargs)

            return wrapper

        return decorate

    def record_event(
        self,
        event_type: str,
        name: str,
        *,
        event_id: str | None = None,
        parent_id: str | None = None,
        input: Any = None,
        output: Any = None,
        status: str = "success",
        error: BaseException | None = None,
        metadata: Mapping[str, Any] | None = None,
        timestamp: str | None = None,
        duration_ms: int | None = None,
    ) -> str:
        event_id = event_id or str(uuid.uuid4())
        payload: dict[str, Any] = {
            "id": event_id,
            "runId": self.id,
            "type": event_type,
            "name": name,
            "status": status,
            "timestamp": timestamp or _now(),
            "metadata": dict(metadata or {}),
        }
        effective_parent = parent_id if parent_id is not None else self._parent.get()
        if effective_parent:
            payload["parentId"] = effective_parent
        if input is not None:
            payload["input"] = input
        if output is not None:
            payload["output"] = output
        if duration_ms is not None:
            payload["durationMs"] = max(0, duration_ms)
        if error is not None:
            payload["error"] = {"message": str(error)}
        self.client._send("/events", payload)
        return event_id

    def end(self, output: Any = None) -> None:
        if self._closed:
            return
        payload: dict[str, Any] = {"status": "success", "endedAt": _now()}
        if output is not None:
            payload["output"] = output
        self.client._send(f"/runs/{quote(self.id, safe='')}", payload)
        self._closed = True

    def fail(self, error: BaseException) -> None:
        if self._closed:
            return
        self.client._send(
            f"/runs/{quote(self.id, safe='')}",
            {"status": "error", "endedAt": _now(), "error": str(error)},
        )
        self._closed = True


def _http_transport(url: str, payload: dict[str, Any], timeout: float) -> None:
    method = "PATCH" if "/runs/" in url else "POST"
    body = json.dumps(payload, default=str).encode("utf-8")
    outgoing = request.Request(
        url,
        data=body,
        method=method,
        headers={"content-type": "application/json"},
    )
    with request.urlopen(outgoing, timeout=timeout):
        pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
