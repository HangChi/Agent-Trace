import type { DashboardTraceEvent } from "@agent-trace/schema";

export type CommandPresentation =
  | { state: "stored"; command: string; toolName?: string }
  | { state: "omitted"; toolName?: string }
  | { state: "metadata"; toolName?: string }
  | { state: "none" };

export function getCommandPresentation(event: DashboardTraceEvent): CommandPresentation {
  const command = event.metadata?.command ?? getObjectString(event.input, "command");
  const toolName = event.metadata?.toolName;

  if (command) return { state: "stored", command, toolName };
  if (event.metadata?.commandContent === "omitted") return { state: "omitted", toolName };
  if (event.metadata?.category === "command" || event.metadata?.toolKind === "command") {
    return { state: "metadata", toolName };
  }

  return { state: "none" };
}

function getObjectString(value: unknown, key: string) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = (value as Record<string, unknown>)[key];
  return typeof result === "string" && result.length > 0 ? result : undefined;
}
