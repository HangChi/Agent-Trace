from __future__ import annotations

import time
from typing import Any

from ..core import Run, _now


def instrument_openai(client: Any, run: Run) -> Any:
    """Return a transparent proxy that traces chat.completions.create calls."""
    return _OpenAIProxy(client, run)


class _OpenAIProxy:
    def __init__(self, client: Any, run: Run) -> None:
        self._client = client
        self.chat = _ChatProxy(client.chat, run)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


class _ChatProxy:
    def __init__(self, chat: Any, run: Run) -> None:
        self._chat = chat
        self.completions = _CompletionsProxy(chat.completions, run)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._chat, name)


class _CompletionsProxy:
    def __init__(self, completions: Any, run: Run) -> None:
        self._completions = completions
        self._run = run

    def create(self, **kwargs: Any) -> Any:
        started_at = _now()
        started = time.perf_counter()
        try:
            response = self._completions.create(**kwargs)
        except BaseException as error:
            self._run.record_event(
                "llm_call",
                "openai.chat.completions.create",
                status="error",
                error=error,
                metadata={"framework": "openai", "model": kwargs.get("model")},
                timestamp=started_at,
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
            raise

        usage = getattr(response, "usage", None)
        input_tokens = _value(usage, "prompt_tokens", "input_tokens") or 0
        output_tokens = _value(usage, "completion_tokens", "output_tokens") or 0
        total_tokens = _value(usage, "total_tokens") or input_tokens + output_tokens
        self._run.record_event(
            "llm_call",
            "openai.chat.completions.create",
            metadata={
                "framework": "openai",
                "provider": "openai",
                "model": getattr(response, "model", None) or kwargs.get("model"),
                "tokenUsage": {
                    "input": input_tokens,
                    "output": output_tokens,
                    "total": total_tokens,
                    "source": "openai"
                },
            },
            timestamp=started_at,
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
        return response

    def __getattr__(self, name: str) -> Any:
        return getattr(self._completions, name)


def _value(source: Any, *names: str) -> int | None:
    for name in names:
        value = source.get(name) if isinstance(source, dict) else getattr(source, name, None)
        if isinstance(value, (int, float)):
            return int(value)
    return None
