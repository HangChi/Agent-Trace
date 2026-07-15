import unittest

from agent_trace import AgentTraceClient
from agent_trace.integrations.langchain import AgentTraceCallbackHandler
from agent_trace.integrations.openai import instrument_openai


class RecordingTransport:
    def __init__(self):
        self.calls = []

    def __call__(self, url, payload, timeout):
        self.calls.append((url, payload, timeout))


class AgentTraceSdkTest(unittest.TestCase):
    def test_nested_steps_inherit_parent_and_run_finishes(self):
        transport = RecordingTransport()
        client = AgentTraceClient(endpoint="http://collector", transport=transport)

        with client.start_run("research", run_id="run-1", metadata={"project": "alpha"}) as run:
            with run.trace_step("retrieval", "load-documents") as parent_id:
                with run.trace_tool("read-document", {"id": "doc-1"}) as child_id:
                    self.assertNotEqual(parent_id, child_id)

        run_create = transport.calls[0][1]
        events = [payload for url, payload, _ in transport.calls if url.endswith("/events")]
        run_update = transport.calls[-1][1]
        self.assertEqual(run_create["metadata"]["project"], "alpha")
        self.assertEqual(events[0]["type"], "tool_call")
        self.assertEqual(events[0]["parentId"], parent_id)
        self.assertEqual(events[1]["type"], "retrieval")
        self.assertEqual(run_update["status"], "success")

    def test_openai_and_langchain_adapters_emit_framework_events(self):
        transport = RecordingTransport()
        client = AgentTraceClient(endpoint="http://collector", transport=transport)

        with client.start_run("frameworks", run_id="run-2") as run:
            wrapped = instrument_openai(FakeOpenAI(), run)
            response = wrapped.chat.completions.create(model="gpt-5", messages=[])
            self.assertEqual(response.model, "gpt-5")

            callback = AgentTraceCallbackHandler(run)
            callback.on_tool_start({"name": "search"}, "query", run_id="tool-1")
            callback.on_tool_end("answer", run_id="tool-1")

        events = [payload for url, payload, _ in transport.calls if url.endswith("/events")]
        self.assertEqual(events[0]["type"], "llm_call")
        self.assertEqual(events[0]["metadata"]["model"], "gpt-5")
        self.assertEqual(events[0]["metadata"]["tokenUsage"]["total"], 10)
        self.assertEqual(events[1]["type"], "tool_call")
        self.assertEqual(events[1]["metadata"]["framework"], "langchain")


class FakeUsage:
    prompt_tokens = 6
    completion_tokens = 4
    total_tokens = 10


class FakeResponse:
    model = "gpt-5"
    usage = FakeUsage()


class FakeCompletions:
    def create(self, **kwargs):
        return FakeResponse()


class FakeChat:
    completions = FakeCompletions()


class FakeOpenAI:
    chat = FakeChat()


if __name__ == "__main__":
    unittest.main()
