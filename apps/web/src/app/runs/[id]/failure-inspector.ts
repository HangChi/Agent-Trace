import type { DashboardEventPage } from "@agent-trace/schema";

type EventErrorSummary = DashboardEventPage["summary"]["errorEvents"][number];

export type InspectableEvent = Pick<
  EventErrorSummary,
  "error" | "metadata" | "name" | "status" | "type"
>;

export type FailureInsight = {
  eventName: string;
  eventType: string;
  title: string;
  reason: string;
  suggestion: string;
};

export function inspectFailures(events: InspectableEvent[]): FailureInsight[] {
  return events.flatMap((event) => {
    if (event.status !== "error") {
      return [];
    }

    const message = event.error?.message ?? "";
    const normalizedMessage = message.toLowerCase();
    const base = {
      eventName: event.name,
      eventType: event.type
    };

    if (normalizedMessage.includes("timeout") || normalizedMessage.includes("timed out")) {
      return [
        {
          ...base,
          title: "Tool Timeout",
          reason: "The step failed while waiting for an external operation to finish.",
          suggestion: "Increase the timeout, add retry logic, or provide a fallback tool."
        }
      ];
    }

    if (normalizedMessage.includes("json") || normalizedMessage.includes("parse")) {
      return [
        {
          ...base,
          title: "Invalid JSON",
          reason: "The model or tool returned content that could not be parsed as JSON.",
          suggestion: "Use schema validation and ask the model to return strict JSON."
        }
      ];
    }

    if (
      normalizedMessage.includes("token") ||
      normalizedMessage.includes("context length") ||
      normalizedMessage.includes("maximum context")
    ) {
      return [
        {
          ...base,
          title: "Token Budget Pressure",
          reason: "The step likely exceeded the model or prompt context budget.",
          suggestion: "Summarize earlier context, trim retrieved evidence, or split the task into smaller runs."
        }
      ];
    }

    return [
      {
        ...base,
        title: "Unknown Error",
        reason: message || "The step failed without a recognizable error signature.",
        suggestion: "Inspect the input, output, stack trace, and preceding steps."
      }
    ];
  });
}
