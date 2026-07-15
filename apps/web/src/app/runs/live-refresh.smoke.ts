import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./run-controls.tsx", import.meta.url), "utf8");

for (const marker of [
  "new EventSource(`${collectorUrl}/changes`)",
  'source.addEventListener("change", refresh)',
  'source.addEventListener("error", startFallback)',
  "window.setInterval(refresh, 15_000)"
]) {
  if (!source.includes(marker)) throw new Error(`Live refresh is missing: ${marker}`);
}

if (/setInterval\([^]*,\s*2_000\)/.test(source) || /intervalMs\s*=\s*2000/.test(source)) {
  throw new Error("Live refresh must not poll the full page every two seconds.");
}

console.log("Agent-Trace live refresh smoke test passed.");
