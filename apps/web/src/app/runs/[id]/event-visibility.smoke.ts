import assert from "node:assert/strict";

import { getEventVisibilityPresentation } from "./event-visibility.js";

const counts = {
  total: 2275,
  display: 992,
  hidden: 1283
};

assert.deepEqual(getEventVisibilityPresentation("display", counts, "zh"), {
  modeLabel: "默认事件 992",
  description: "默认展示命令、工具、Skill、MCP 和 Token 事件。",
  toggleLabel: "查看已隐藏事件: 1,283",
  nextVisibility: "hidden"
});

assert.deepEqual(getEventVisibilityPresentation("hidden", counts, "zh"), {
  modeLabel: "已隐藏事件 1,283",
  description: "当前仅显示被默认视图隐藏的 Transcript 和辅助事件。",
  toggleLabel: "返回默认事件: 992",
  nextVisibility: "display"
});

assert.deepEqual(getEventVisibilityPresentation("all", counts, "zh"), {
  modeLabel: "全部事件 2,275",
  description: "当前显示全部事件，包括 1,283 条默认隐藏事件。",
  toggleLabel: "返回默认事件: 992",
  nextVisibility: "display"
});

assert.equal(
  getEventVisibilityPresentation("all", counts, "en").toggleLabel,
  "Back to default events: 992"
);

console.log("Agent-Trace event visibility smoke test passed.");
