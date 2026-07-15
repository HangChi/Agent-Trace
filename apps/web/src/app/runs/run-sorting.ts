import type { DashboardRunSort } from "@agent-trace/schema";

export type SortableRunColumn = Extract<
  DashboardRunSort,
  "tokens" | "cost" | "startedAt" | "duration"
>;

type RunSortState = {
  sort: DashboardRunSort | null;
  order: "asc" | "desc" | null;
};

export function getRunSortControl(
  current: RunSortState,
  column: SortableRunColumn
) {
  const defaultSort = current.sort === null;
  const active = current.sort === column || (defaultSort && column === "startedAt");
  const direction = defaultSort && column === "startedAt"
    ? "descending" as const
    : current.sort === column
      ? current.order === "asc" ? "ascending" as const : "descending" as const
      : "none" as const;
  const next = defaultSort && column === "startedAt"
    ? { sort: column, order: "asc" as const }
    : current.sort === column && current.order === "asc"
      ? { sort: null, order: null }
      : {
          sort: column,
          order: current.sort === column ? "asc" as const : "desc" as const
        };

  return {
    active,
    default: defaultSort && column === "startedAt",
    direction,
    next
  };
}
