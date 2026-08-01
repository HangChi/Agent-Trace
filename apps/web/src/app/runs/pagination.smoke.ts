import { strict as assert } from "node:assert";

import { getPaginationItems } from "./pagination.js";
import { navigateRunsPage, refreshRunsPage } from "./run-navigation.js";

assert.deepEqual(getPaginationItems(1, 3), [1, 2, 3]);
assert.deepEqual(getPaginationItems(1, 10), [1, 2, 3, 4, 5, "ellipsis", 10]);
assert.deepEqual(getPaginationItems(5, 10), [1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
assert.deepEqual(getPaginationItems(10, 10), [1, "ellipsis", 6, 7, 8, 9, 10]);

let assignedUrl = "";
let reloadCount = 0;
const location = {
  assign(url: string) {
    assignedUrl = url;
  },
  reload() {
    reloadCount += 1;
  }
};

navigateRunsPage(location, "/runs?page=2");
refreshRunsPage(location);

assert.equal(assignedUrl, "/runs?page=2");
assert.equal(reloadCount, 1);

console.log("Agent-Trace pagination smoke test passed.");
