import assert from "node:assert/strict";

import { getRunSortControl } from "./run-sorting.js";

assert.deepEqual(
  getRunSortControl({ sort: null, order: null }, "startedAt"),
  {
    active: true,
    default: true,
    direction: "descending",
    next: { sort: "startedAt", order: "asc" }
  }
);

assert.deepEqual(
  getRunSortControl({ sort: "startedAt", order: "asc" }, "startedAt"),
  {
    active: true,
    default: false,
    direction: "ascending",
    next: { sort: null, order: null }
  }
);

for (const column of ["tokens", "cost", "duration"] as const) {
  assert.deepEqual(
    getRunSortControl({ sort: null, order: null }, column),
    {
      active: false,
      default: false,
      direction: "none",
      next: { sort: column, order: "desc" }
    }
  );

  assert.deepEqual(
    getRunSortControl({ sort: column, order: "desc" }, column),
    {
      active: true,
      default: false,
      direction: "descending",
      next: { sort: column, order: "asc" }
    }
  );

  assert.deepEqual(
    getRunSortControl({ sort: column, order: "asc" }, column),
    {
      active: true,
      default: false,
      direction: "ascending",
      next: { sort: null, order: null }
    }
  );
}

console.log("Agent-Trace run sorting smoke test passed.");
