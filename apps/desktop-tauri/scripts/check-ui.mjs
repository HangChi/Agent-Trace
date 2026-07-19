import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

const root = new URL("../ui/", import.meta.url);
const files = ["core.js", "views-runs.js", "views-admin.js", "app.js"];
const index = await readFile(new URL("index.html", root), "utf8");
const styles = await readFile(new URL("styles.css", root), "utf8");
const tauriSource = await readFile(new URL("../src-tauri/src/lib.rs", root), "utf8");

for (const file of files) {
  const source = await readFile(new URL(file, root), "utf8");
  new Script(source, { filename: file });
  if (!index.includes(`src="${file}"`)) throw new Error(`${file} is not included by index.html`);
}

const combined = await Promise.all(files.map(file => readFile(new URL(file, root), "utf8"))).then(values => values.join("\n"));
for (const route of ["/runs", "/runs/compare", "/token-trace", "/analytics", "/evaluations", "/sandbox", "/maintenance"]) {
  if (!combined.includes(route)) throw new Error(`Static dashboard route missing: ${route}`);
}
for (const forbidden of ["next/", "node_modules", "require(", "localhost:3000"]) {
  if (combined.includes(forbidden) || index.includes(forbidden)) throw new Error(`Node/Next runtime dependency found: ${forbidden}`);
}
if (/<(script|link)[^>]+(?:src|href)=["']https?:\/\//i.test(index)) throw new Error("External UI asset found");
if (!tauriSource.includes("default_window_icon()") || !tauriSource.includes(".icon(icon.clone())")) {
  throw new Error("The Windows tray must use the application icon.");
}
if (!/\.run-name\s*\{[^}]*overflow:\s*hidden[^}]*white-space:\s*nowrap/s.test(styles)) {
  throw new Error("Desktop Run titles must remain on one readable line.");
}

console.log(`Static dashboard contract OK (${files.length} scripts, 7 routes).`);
