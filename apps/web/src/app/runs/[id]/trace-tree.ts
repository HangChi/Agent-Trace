import type { DashboardTraceEvent } from "@agent-trace/schema";

export type TraceTreeNode = {
  event: DashboardTraceEvent;
  children: TraceTreeNode[];
};

type IndexedNode = {
  node: TraceTreeNode;
  index: number;
  timestampMs: number | undefined;
};

export function buildTraceForest(events: readonly DashboardTraceEvent[]): TraceTreeNode[] {
  const eventIndexById = new Map<string, number>();
  const nodes = events.map<IndexedNode>((event, index) => {
    if (!eventIndexById.has(event.id)) {
      eventIndexById.set(event.id, index);
    }

    return {
      node: { event, children: [] },
      index,
      timestampMs: parseTimestampMs(event.timestamp)
    };
  });
  const parentIndexes = events.map((event) =>
    event.parentId === undefined ? undefined : eventIndexById.get(event.parentId)
  );
  const cycleMembers = findCycleMembers(parentIndexes);
  const roots: IndexedNode[] = [];

  for (const entry of nodes) {
    const parentIndex = parentIndexes[entry.index];

    if (parentIndex === undefined || cycleMembers.has(entry.index)) {
      roots.push(entry);
    } else {
      nodes[parentIndex]!.node.children.push(entry.node);
    }
  }

  const indexedByNode = new Map(nodes.map((entry) => [entry.node, entry]));
  const compareNodes = (left: TraceTreeNode, right: TraceTreeNode) =>
    compareIndexedNodes(indexedByNode.get(left)!, indexedByNode.get(right)!);

  for (const entry of nodes) {
    entry.node.children.sort(compareNodes);
  }

  roots.sort(compareIndexedNodes);

  return roots.map((entry) => entry.node);
}

function findCycleMembers(parentIndexes: Array<number | undefined>) {
  const states = parentIndexes.map(() => 0);
  const stack: number[] = [];
  const stackPositions = new Map<number, number>();
  const cycleMembers = new Set<number>();

  function visit(index: number) {
    states[index] = 1;
    stackPositions.set(index, stack.length);
    stack.push(index);

    const parentIndex = parentIndexes[index];

    if (parentIndex !== undefined) {
      if (states[parentIndex] === 0) {
        visit(parentIndex);
      } else if (states[parentIndex] === 1) {
        const cycleStart = stackPositions.get(parentIndex)!;

        for (const member of stack.slice(cycleStart)) {
          cycleMembers.add(member);
        }
      }
    }

    stack.pop();
    stackPositions.delete(index);
    states[index] = 2;
  }

  for (let index = 0; index < parentIndexes.length; index += 1) {
    if (states[index] === 0) {
      visit(index);
    }
  }

  return cycleMembers;
}

function compareIndexedNodes(left: IndexedNode, right: IndexedNode) {
  if (left.timestampMs === undefined && right.timestampMs !== undefined) {
    return 1;
  }

  if (left.timestampMs !== undefined && right.timestampMs === undefined) {
    return -1;
  }

  if (
    left.timestampMs !== undefined &&
    right.timestampMs !== undefined &&
    left.timestampMs !== right.timestampMs
  ) {
    return left.timestampMs - right.timestampMs;
  }

  return left.index - right.index;
}

function parseTimestampMs(value: string) {
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    const digits = BigInt(trimmed);
    let milliseconds: number;

    if (digits >= 100_000_000_000_000_000n) {
      milliseconds = Number(digits / 1_000_000n);
    } else if (digits >= 100_000_000_000_000n) {
      milliseconds = Number(digits / 1_000n);
    } else if (digits >= 100_000_000_000n) {
      milliseconds = Number(digits);
    } else if (digits >= 1_000_000_000n) {
      milliseconds = Number(digits * 1_000n);
    } else {
      return undefined;
    }

    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }

  const milliseconds = new Date(trimmed).getTime();

  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}
