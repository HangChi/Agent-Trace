import assert from "node:assert/strict";

import {
  analyticsDimensionLabel,
  budgetMetricLabel,
  budgetPeriodLabel,
  eventChangeLabel,
  eventRegressionLabel,
  traceEventTypeLabel
} from "./p1-labels.js";

assert.deepEqual(
  (["project", "environment", "model", "source"] as const).map((value) =>
    analyticsDimensionLabel("zh", value)
  ),
  ["项目", "环境", "模型", "来源"]
);
assert.deepEqual(
  (["project", "environment", "model", "source"] as const).map((value) =>
    analyticsDimensionLabel("en", value)
  ),
  ["Project", "Environment", "Model", "Source"]
);

assert.equal(budgetPeriodLabel("zh", "daily"), "每日");
assert.equal(budgetPeriodLabel("en", "monthly"), "Monthly");
assert.equal(budgetMetricLabel("zh", "costUsd"), "成本");
assert.equal(budgetMetricLabel("en", "tokens"), "Tokens");

assert.equal(eventChangeLabel("zh", "added"), "新增");
assert.equal(eventChangeLabel("en", "removed"), "Removed");
assert.equal(eventRegressionLabel("zh", "status"), "新增失败");
assert.equal(eventRegressionLabel("en", "duration"), "Duration threshold");
assert.equal(traceEventTypeLabel("zh", "llm_call"), "模型调用");
assert.equal(traceEventTypeLabel("en", "tool_call"), "Tool call");

console.log("Agent-Trace P1 labels smoke test passed.");
