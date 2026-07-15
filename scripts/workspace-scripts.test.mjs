import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("web declares its TypeScript smoke runner", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../apps/web/package.json", import.meta.url), "utf8"),
  );

  assert.equal(manifest.devDependencies?.tsx, "^4.21.0");
});

test("web runs its TypeScript smokes directly", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../apps/web/package.json", import.meta.url), "utf8"),
  );

  const testScript = manifest.scripts?.test ?? "";
  const requiredSmokes = [
    "src/lib/cost.smoke.ts",
    "src/lib/i18n.smoke.ts",
    "src/app/runs/pagination.smoke.ts",
    "src/app/runs/scanner-status.smoke.ts",
    "src/app/runs/live-refresh.smoke.ts",
    "src/app/runs/[id]/trace-tree.smoke.ts",
    "src/app/runs/[id]/trace-navigation.smoke.ts",
  ];

  for (const smoke of requiredSmokes) {
    assert.match(testScript, new RegExp(`(?:^|&&\\s*)tsx ${escapeRegExp(smoke)}(?:\\s*&&|$)`));
  }
});

test("server runs the trace insights smoke", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../apps/server/package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    manifest.scripts?.test,
    "tsx src/migrations.smoke.ts && tsx src/normalizers/provider-token-adapter.smoke.ts && tsx src/change-feed.smoke.ts && tsx src/smoke.ts && tsx src/start.smoke.ts && tsx src/read-model.smoke.ts && tsx src/trace-insights.smoke.ts && tsx src/usage-api.smoke.ts && tsx src/usage-storage.smoke.ts && tsx src/transcript-api.smoke.ts && tsx src/data-governance.smoke.ts && tsx src/run-export.smoke.ts && tsx src/run-analytics.smoke.ts",
  );
});

test("root test runs the focused workspace audit tests", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    manifest.scripts?.test,
    "node scripts/workspace-scripts.smoke.mjs && node --test scripts/workspace-scripts.test.mjs && pnpm -r test",
  );
});

test("root verification bootstraps the schema build", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const buildSchema = "pnpm --filter @agent-trace/schema build";

  assert.equal(manifest.scripts?.prepare, buildSchema);
  assert.equal(manifest.scripts?.pretest, buildSchema);
});

test("parses quoted workspace package globs", async () => {
  const audit = await import("./workspace-scripts.smoke.mjs");
  const yaml = `packages:
  - "apps/*"
  - 'packages/*'
  - "examples/*"
verifyDepsBeforeRun: false
`;

  assert.deepEqual(audit.parseWorkspacePackagePatterns?.(yaml), [
    "apps/*",
    "packages/*",
    "examples/*",
  ]);
});

test("rejects unsupported workspace package patterns clearly", async () => {
  const { parseWorkspacePackagePatterns } = await import(
    "./workspace-scripts.smoke.mjs"
  );

  assert.throws(
    () => parseWorkspacePackagePatterns('packages:\n  - "apps/**"\n'),
    /Unsupported workspace package pattern: apps\/\*\*/,
  );
});

test("discovers manifests from pnpm workspace package globs", async (t) => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "agent-trace-workspace-"),
  );
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  await writeFile(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    'packages:\n  - "apps/*"\n  - "packages/*"\n  - "examples/*"\n',
  );

  for (const packagePath of ["apps/web", "packages/sdk-js"]) {
    const directory = path.join(workspaceRoot, ...packagePath.split("/"));
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: packagePath }),
    );
  }

  const audit = await import("./workspace-scripts.smoke.mjs");
  const manifests = await audit.discoverWorkspaceManifests?.(workspaceRoot);

  assert.deepEqual(
    manifests?.map(({ manifestPath }) =>
      path.relative(workspaceRoot, manifestPath).replaceAll(path.sep, "/"),
    ),
    ["apps/web/package.json", "packages/sdk-js/package.json"],
  );
});

test("fails clearly when workspace globs find no manifests", async (t) => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "agent-trace-empty-workspace-"),
  );
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  await writeFile(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    'packages:\n  - "apps/*"\n',
  );
  await mkdir(path.join(workspaceRoot, "apps", "empty"), {
    recursive: true,
  });

  const { discoverWorkspaceManifests } = await import(
    "./workspace-scripts.smoke.mjs"
  );

  await assert.rejects(
    discoverWorkspaceManifests(workspaceRoot),
    /No workspace package manifests found.*apps\/\*/,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
