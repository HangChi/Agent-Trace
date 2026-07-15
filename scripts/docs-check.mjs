import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const documentationFiles = [
  "README.md",
  "README.en.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CONTEXT.md",
  "SECURITY.md",
  ...(await listFiles("docs", (file) => file.endsWith(".md"))),
];

await checkRelativeMarkdownLinks(documentationFiles);
await checkApiRoutes();
await checkDocumentedEnvironmentVariables();
await checkCliCommands();

console.log(
  `documentation checks passed (${documentationFiles.length} Markdown files, API routes, environment variables, CLI commands)`,
);

async function checkRelativeMarkdownLinks(files) {
  const failures = [];

  for (const relativeFile of files) {
    const content = await readText(relativeFile);
    const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;

    for (const match of content.matchAll(linkPattern)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];

      if (!rawTarget || /^(?:[a-z]+:|#)/i.test(rawTarget)) continue;

      const targetPath = decodeURIComponent(rawTarget.split("#", 1)[0]);
      const resolved = path.resolve(workspaceRoot, path.dirname(relativeFile), targetPath);

      try {
        await stat(resolved);
      } catch {
        failures.push(`${relativeFile} -> ${rawTarget}`);
      }
    }
  }

  assertEmpty(failures, "Broken relative Markdown links");
}

async function checkApiRoutes() {
  const source = await readText("apps/server/src/app.ts");
  const apiReference = await readText("docs/api-reference.md");
  const openApi = await readText("docs/openapi.yaml");
  const sourceRoutes = new Set(
    [...source.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)].map(
      ([, method, route]) => `${method.toUpperCase()} ${route}`,
    ),
  );
  const documentedRoutes = new Set(
    [...apiReference.matchAll(/^\|\s*(GET|POST|PATCH|PUT|DELETE)\s*\|\s*`([^`]+)`/gm)].map(
      ([, method, route]) => `${method} ${route}`,
    ),
  );
  const openApiRoutes = parseOpenApiRoutes(openApi);

  assertSameSet(sourceRoutes, documentedRoutes, "Collector routes vs API route table");
  assertSameSet(
    new Set([...sourceRoutes].map((route) => route.replace(/:([A-Za-z0-9_]+)/g, "{$1}"))),
    openApiRoutes,
    "Collector routes vs OpenAPI paths",
  );
}

async function checkDocumentedEnvironmentVariables() {
  const sourceFiles = [
    ...(await listFiles("apps", isRuntimeSource)),
    ...(await listFiles("packages", isRuntimeSource)),
    ...(await listFiles("examples", isRuntimeSource)),
  ];
  const sourceVariables = new Set();

  for (const file of sourceFiles) {
    const content = await readText(file);

    for (const match of content.matchAll(/\bAGENT_TRACE_[A-Z0-9_]+\b/g)) {
      sourceVariables.add(match[0]);
    }
  }

  const documentation = [
    await readText("README.md"),
    await readText("docs/user-guide.md"),
    await readText("docs/deployment-operations.md"),
  ].join("\n");
  const missing = [...sourceVariables].filter((name) => !documentation.includes(`${name}`));

  assertEmpty(missing, "Runtime AGENT_TRACE_* variables missing from documentation");
}

async function checkCliCommands() {
  const source = await readText("packages/cli/src/index.ts");
  const userGuide = await readText("docs/user-guide.md");
  const mainHelp = source.slice(source.indexOf("function printHelp()"), source.indexOf("function printInstallHelp()"));
  const commands = new Set(
    [...mainHelp.matchAll(/^\s{2}agent-trace\s+([a-z-]+)/gm)].map(([, command]) => command),
  );
  const missing = [...commands].filter((command) => !userGuide.includes(`agent-trace ${command}`));

  assertEmpty(missing, "CLI commands missing from the user guide");
}

function parseOpenApiRoutes(source) {
  const routes = new Set();
  let currentPath;

  for (const line of source.split(/\r?\n/)) {
    const pathMatch = line.match(/^  (\/[^:]+(?:\{[^}]+\}[^:]*)?):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }

    const methodMatch = line.match(/^    (get|post|patch|put|delete):\s*$/);
    if (currentPath && methodMatch) {
      routes.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  }

  return routes;
}

async function listFiles(relativeDirectory, predicate) {
  const absoluteDirectory = path.join(workspaceRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true, recursive: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(workspaceRoot, path.join(entry.parentPath, entry.name)))
    .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`) && predicate(file))
    .sort();
}

function isRuntimeSource(file) {
  return /\.(?:[cm]?[jt]s|tsx)$/.test(file) && !/\.(?:smoke|test)\.[cm]?[jt]s$/.test(file);
}

async function readText(relativeFile) {
  return readFile(path.join(workspaceRoot, relativeFile), "utf8");
}

function assertSameSet(expected, actual, label) {
  const failures = [
    ...[...expected].filter((value) => !actual.has(value)).map((value) => `missing: ${value}`),
    ...[...actual].filter((value) => !expected.has(value)).map((value) => `extra: ${value}`),
  ];

  assertEmpty(failures, label);
}

function assertEmpty(values, label) {
  if (values.length > 0) {
    throw new Error(`${label}:\n- ${values.join("\n- ")}`);
  }
}
