import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const requiredScripts = ["test", "lint"];

export function parseWorkspacePackagePatterns(source) {
  const patterns = [];
  let readingPackages = false;

  for (const line of source.split(/\r?\n/)) {
    if (!readingPackages) {
      if (/^packages:\s*$/.test(line)) {
        readingPackages = true;
      }
      continue;
    }

    const match = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (match) {
      const value = match[1];
      if (value.startsWith('"') && value.endsWith('"')) {
        patterns.push(JSON.parse(value));
      } else if (value.startsWith("'") && value.endsWith("'")) {
        patterns.push(value.slice(1, -1).replaceAll("''", "'"));
      } else {
        patterns.push(value.replace(/\s+#.*$/, ""));
      }
      continue;
    }

    if (/^\S/.test(line)) {
      break;
    }
  }

  for (const pattern of patterns) {
    const segments = pattern.split("/");
    const directorySegments = segments.slice(0, -1);
    const isSupported =
      segments.at(-1) === "*" &&
      directorySegments.length > 0 &&
      !path.posix.isAbsolute(pattern) &&
      !/^[A-Za-z]:/.test(pattern) &&
      directorySegments.every(
        (segment) =>
          segment !== "" &&
          segment !== "." &&
          segment !== ".." &&
          !/[*?[\]{}!\\]/.test(segment),
      );

    if (!isSupported) {
      throw new Error(
        `Unsupported workspace package pattern: ${pattern}; expected a relative directory glob ending in /*`,
      );
    }
  }

  return patterns;
}

export async function discoverWorkspaceManifests(workspaceRoot) {
  const workspaceYaml = await readFile(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    "utf8",
  );
  const patterns = parseWorkspacePackagePatterns(workspaceYaml);
  const manifests = [];

  for (const pattern of patterns) {
    const packageRoot = pattern.split("/").slice(0, -1);
    const rootPath = path.join(workspaceRoot, ...packageRoot);
    let entries;
    try {
      entries = await readdir(rootPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath = path.join(rootPath, entry.name, "package.json");

      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifests.push({ manifest, manifestPath });
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  if (manifests.length === 0) {
    throw new Error(
      `No workspace package manifests found for pnpm-workspace.yaml patterns: ${patterns.join(", ")}`,
    );
  }

  return manifests;
}

export async function runWorkspaceScriptAudit(workspaceRoot) {
  const manifests = await discoverWorkspaceManifests(workspaceRoot);
  const failures = [];

  for (const { manifest, manifestPath } of manifests) {
    for (const scriptName of requiredScripts) {
      const script = manifest.scripts?.[scriptName];
      if (typeof script !== "string" || script.trim() === "") {
        failures.push(
          `${path.relative(workspaceRoot, manifestPath)}: missing non-empty ${scriptName} script`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`workspace script audit passed (${manifests.length} packages)`);
  }
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  await runWorkspaceScriptAudit(path.resolve(import.meta.dirname, ".."));
}
