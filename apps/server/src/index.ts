import { startCollector } from "./start.js";

const collector = await startCollector();

if (collector === null) {
  setInterval(() => undefined, 60_000);
}
