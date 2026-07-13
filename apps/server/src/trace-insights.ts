import type {
  DashboardTraceEvent,
  DashboardTraceInsight,
  DashboardTraceInsightKind
} from "@agent-trace/schema";

const actionCategories = new Set(["command", "tool", "mcp", "skill"]);
const insightKindOrder: DashboardTraceInsightKind[] = [
  "repeated_action",
  "retry_loop",
  "slow_step",
  "token_hotspot",
  "failure_cascade"
];

type OrderedEvent = { event: DashboardTraceEvent; inputIndex: number };
type ActionEvent = OrderedEvent & { actionName: string };

export function analyzeTraceInsights(events: DashboardTraceEvent[]): DashboardTraceInsight[] {
  const hasSessionScan = events.some(hasSessionScanTokenUsage);
  const orderedEvents = getEffectiveEvents(events)
    .map((event, inputIndex): OrderedEvent => ({ event, inputIndex }))
    .sort(compareEvents);
  const actions = orderedEvents
    .map((item): ActionEvent | undefined => {
      const actionName = getActionName(item.event);
      return actionName ? { ...item, actionName } : undefined;
    })
    .filter((item): item is ActionEvent => item !== undefined);
  const insights: DashboardTraceInsight[] = [];

  for (let start = 0; start < actions.length; ) {
    const currentAction = actions[start];
    if (!currentAction) break;
    let end = start + 1;
    while (actions[end]?.actionName === currentAction.actionName) {
      end += 1;
    }

    const group = actions.slice(start, end);
    if (group.length >= 3) {
      insights.push({
        kind: "repeated_action",
        severity: "warning",
        eventIds: group.map(({ event }) => event.id),
        title: "Repeated action",
        evidence: { actionName: currentAction.actionName, count: group.length }
      });

      const failedAttempts = group
        .slice(0, -1)
        .filter(({ event }) => event.status === "error").length;
      if (group.at(-1)?.event.status === "success" && failedAttempts >= 2) {
        insights.push({
          kind: "retry_loop",
          severity: "warning",
          eventIds: group.map(({ event }) => event.id),
          title: "Retry loop",
          evidence: {
            actionName: currentAction.actionName,
            attempts: group.length,
            failedAttempts
          }
        });
      }
    }

    start = end;
  }

  for (const { event } of orderedEvents) {
    if (event.durationMs !== undefined && event.durationMs >= 10_000) {
      insights.push({
        kind: "slow_step",
        severity: "warning",
        eventIds: [event.id],
        title: "Slow step",
        evidence: { durationMs: event.durationMs, thresholdMs: 10_000 }
      });
    }
  }

  const tokenEvents = getTokenEvents(orderedEvents, hasSessionScan);
  const runTokens = tokenEvents.reduce(
    (sum, { event }) => sum + getPositiveEventTokens(event),
    0
  );
  if (runTokens > 0) {
    for (const { event } of tokenEvents) {
      const tokens = getPositiveEventTokens(event);
      const share = tokens / runTokens;
      if (tokens >= 1_000 && share >= 0.5) {
        insights.push({
          kind: "token_hotspot",
          severity: "info",
          eventIds: [event.id],
          title: "Token hotspot",
          evidence: { eventTokens: tokens, runTokens, share }
        });
      }
    }
  }

  const cascade = findFailureCascade(orderedEvents);
  if (cascade) {
    insights.push(cascade);
  }

  const orderById = new Map(orderedEvents.map(({ event }, index) => [event.id, index]));
  return insights.sort((left, right) => {
    const byEvent =
      (orderById.get(left.eventIds[0] ?? "") ?? 0) -
      (orderById.get(right.eventIds[0] ?? "") ?? 0);
    return byEvent || insightKindOrder.indexOf(left.kind) - insightKindOrder.indexOf(right.kind);
  });
}

function getEffectiveEvents(events: DashboardTraceEvent[]) {
  const hasLiveActions = events.some(
    (event) =>
      event.metadata?.source !== "transcript" &&
      actionCategories.has(event.metadata?.category ?? "")
  );

  return hasLiveActions
    ? events.filter((event) => event.metadata?.source !== "transcript")
    : events;
}

function getTokenEvents(events: OrderedEvent[], hasSessionScan: boolean) {
  if (!hasSessionScan) return events;

  return events.filter(({ event }) => hasSessionScanTokenUsage(event));
}

function hasSessionScanTokenUsage(event: DashboardTraceEvent) {
  return (
    event.metadata?.tokenUsage?.sourceKind === "scan" &&
    event.metadata.tokenUsage.scope === "session"
  );
}

function compareEvents(left: OrderedEvent, right: OrderedEvent) {
  const leftMs = Date.parse(left.event.timestamp);
  const rightMs = Date.parse(right.event.timestamp);
  const leftValid = Number.isFinite(leftMs);
  const rightValid = Number.isFinite(rightMs);

  if (leftValid && rightValid && leftMs !== rightMs) return leftMs - rightMs;
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  return left.inputIndex - right.inputIndex;
}

function getActionName(event: DashboardTraceEvent) {
  const metadata = event.metadata;
  const category = metadata?.category;
  if (!actionCategories.has(category ?? "") && event.type !== "tool_call") return undefined;

  if (category === "command") return metadata?.command ?? event.name;
  if (category === "tool") return metadata?.toolName ?? event.name;
  if (category === "skill") return metadata?.skillName ?? event.name;
  if (category === "mcp") {
    return metadata?.mcpServer && metadata.mcpTool
      ? `${metadata.mcpServer}.${metadata.mcpTool}`
      : event.name;
  }

  if (metadata?.command) return metadata.command;
  if (metadata?.toolName) return metadata.toolName;
  if (metadata?.skillName) return metadata.skillName;
  if (metadata?.mcpServer && metadata.mcpTool) {
    return `${metadata.mcpServer}.${metadata.mcpTool}`;
  }
  return event.name;
}

function getPositiveEventTokens(event: DashboardTraceEvent) {
  const total = event.metadata?.tokenUsage?.total;
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : 0;
}

function findFailureCascade(orderedEvents: OrderedEvent[]): DashboardTraceInsight | undefined {
  const errors = orderedEvents.filter(({ event }) => event.status === "error");

  for (let rootIndex = 0; rootIndex < errors.length; rootIndex += 1) {
    const root = errors[rootIndex]?.event;
    if (!root) continue;
    const subsequent = errors.slice(rootIndex + 1, rootIndex + 3).map(({ event }) => event);

    if (subsequent.length >= 2) {
      const eventIds = [root.id, ...subsequent.map((event) => event.id)];
      return {
        kind: "failure_cascade",
        severity: "error",
        eventIds,
        title: "Failure cascade",
        evidence: { errorCount: eventIds.length }
      };
    }
  }

  return undefined;
}
