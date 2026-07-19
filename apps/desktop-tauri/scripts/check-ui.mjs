import { readFile } from "node:fs/promises";

const desktopRoot = new URL("../", import.meta.url);
const sharedRoot = new URL("../../../packages/dashboard-ui/src/", import.meta.url);
const [main, shared, theme, config, packageJson, index, tauriSource, buildSource, iconSvg] = await Promise.all([
  readFile(new URL("src/main.tsx", desktopRoot), "utf8"),
  readFile(new URL("dashboard-app.tsx", sharedRoot), "utf8"),
  readFile(new URL("theme.css", sharedRoot), "utf8"),
  readFile(new URL("src-tauri/tauri.conf.json", desktopRoot), "utf8"),
  readFile(new URL("package.json", desktopRoot), "utf8"),
  readFile(new URL("index.html", desktopRoot), "utf8"),
  readFile(new URL("src-tauri/src/lib.rs", desktopRoot), "utf8"),
  readFile(new URL("src-tauri/build.rs", desktopRoot), "utf8"),
  readFile(new URL("assets/icon.svg", desktopRoot), "utf8")
]);

if (!main.includes("@agent-trace/dashboard-ui") || !main.includes('routerMode="hash"')) {
  throw new Error("Tauri must mount the shared dashboard with hash routing.");
}
for (const route of ["/runs", "/runs/compare", "/token-trace", "/analytics", "/evaluations", "/sandbox", "/maintenance"]) {
  if (!shared.includes(route)) throw new Error(`Shared desktop route missing: ${route}`);
}
if (!shared.includes('pageSize: "20"')) throw new Error("Desktop Run pagination must match Web at 20 rows.");
if (!shared.includes('if (all) query.set("includeUntracked", "true")')) {
  throw new Error("Desktop must hide untracked Runs by default and expose an explicit show-all mode.");
}
for (const marker of ["normalizeRunTitle", "ErrorState", "LoadingState", "Retry", "重试"]) {
  if (!shared.includes(marker)) throw new Error(`Shared desktop behavior missing: ${marker}`);
}
for (const marker of ["--at-bg", "--at-primary", ".dark", ".at-table", ".at-filter"]) {
  if (!theme.includes(marker)) throw new Error(`Shared theme marker missing: ${marker}`);
}
for (const [label, pattern] of [
  ["15px body text", /body \{[^}]*font-size: 15px/],
  ["12px table headers", /\.at-table th \{[^}]*font-size: 12px/],
  ["11px supporting text", /\.at-subtle \{[^}]*font-size: 11px/],
  ["11px badges", /\.at-badge \{[^}]*font-size: 11px/],
  ["14px Run names", /\.at-run-name \{[^}]*font-size: 14px/]
]) {
  if (!pattern.test(theme)) throw new Error(`Shared desktop typography missing: ${label}`);
}
for (const marker of [".at-token-tabs", ".at-token-calendar", ".at-usage-rank"]) {
  if (!theme.includes(marker)) throw new Error(`Shared desktop Token-Trace style missing: ${marker}`);
}
for (const forbidden of ["next/", "localhost:3000", "electron"] ) {
  if (main.includes(forbidden) || shared.includes(forbidden) || index.includes(forbidden)) {
    throw new Error(`Unsupported desktop runtime dependency found: ${forbidden}`);
  }
}
if (!config.includes('"frontendDist": "../dist"') || !config.includes('"beforeBuildCommand": "pnpm build:ui"')) {
  throw new Error("Tauri must bundle the Vite dist directory.");
}
if (!packageJson.includes('"build:ui": "vite build"') || !index.includes('/src/main.tsx')) {
  throw new Error("Desktop Vite entry is incomplete.");
}
if (!tauriSource.includes("default_window_icon()") || !tauriSource.includes(".icon(icon.clone())")) {
  throw new Error("The Windows tray must use the application icon.");
}
if (!buildSource.includes('cargo:rerun-if-changed=../assets/icon.ico')) {
  throw new Error("The Tauri build must refresh Windows resources when the application icon changes.");
}
if (!shared.includes("<BrandIcon") || shared.includes("<Workflow size={20}")) {
  throw new Error("The shared header must use the original branching Agent-Trace logo.");
}
for (const marker of ['#4f46e5', 'd="M15 32h12c7 0 7-12 15-12h7M27 32c7 0 7 12 15 12h7"', '#67e8f9']) {
  if (!iconSvg.includes(marker)) throw new Error(`Desktop application icon must use the original Agent-Trace artwork: ${marker}`);
}

console.log("Shared Tauri dashboard contract OK (8 pages, tracked-by-default, local assets)." );
