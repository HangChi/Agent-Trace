import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = [
  "runs/page.tsx",
  "runs/[id]/page.tsx",
  "runs/compare/page.tsx",
  "token-trace/page.tsx",
  "analytics/page.tsx",
  "evaluations/page.tsx",
  "sandbox/page.tsx",
  "maintenance/page.tsx"
];

for (const route of routes) {
  const source = readFileSync(new URL(route, import.meta.url), "utf8");
  assert.match(source, /DashboardApp/, `${route} must render the shared dashboard`);
}

const shared = readFileSync(
  new URL("../../../../packages/dashboard-ui/src/dashboard-app.tsx", import.meta.url),
  "utf8"
);
assert.match(shared, /pageSize: "20"/, "shared Run list must use 20 rows per page");
assert.match(shared, /if \(all\) query\.set\("includeUntracked", "true"\)/, "show-all must be explicit");
assert.match(shared, /normalizeRunTitle/, "shared Run titles must remove attachment markup");
for (const path of ["/runs", "/token-trace", "/analytics", "/evaluations", "/sandbox", "/maintenance"]) {
  assert.ok(shared.includes(path), `shared dashboard is missing ${path}`);
}

console.log(`Web shared dashboard contract OK (${routes.length} route wrappers).`);
