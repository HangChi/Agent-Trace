import type {
  AnalyticsBudgetAlert,
  AnalyticsDimension,
  DashboardRunEventChange,
  DashboardRunEventRegression
} from "@agent-trace/schema";

import type { Locale } from "./i18n";

type LocalizedLabel = Record<Locale, string>;

const analyticsDimensions: Record<AnalyticsDimension, LocalizedLabel> = {
  project: { zh: "项目", en: "Project" },
  environment: { zh: "环境", en: "Environment" },
  model: { zh: "模型", en: "Model" },
  source: { zh: "来源", en: "Source" }
};

const budgetPeriods: Record<"daily" | "monthly", LocalizedLabel> = {
  daily: { zh: "每日", en: "Daily" },
  monthly: { zh: "每月", en: "Monthly" }
};

const budgetMetrics: Record<AnalyticsBudgetAlert["metric"], LocalizedLabel> = {
  costUsd: { zh: "成本", en: "Cost" },
  tokens: { zh: "Token 数", en: "Tokens" },
  runs: { zh: "Run 数", en: "Runs" }
};

const eventChanges: Record<DashboardRunEventChange, LocalizedLabel> = {
  added: { zh: "新增", en: "Added" },
  removed: { zh: "缺失", en: "Removed" },
  status: { zh: "状态变化", en: "Status" },
  duration: { zh: "耗时变化", en: "Duration" },
  tokens: { zh: "Token 变化", en: "Tokens" }
};

const eventRegressions: Record<DashboardRunEventRegression, LocalizedLabel> = {
  status: { zh: "新增失败", en: "New failure" },
  missing: { zh: "基准事件缺失", en: "Missing baseline event" },
  duration: { zh: "耗时超阈值", en: "Duration threshold" },
  tokens: { zh: "Token 超阈值", en: "Token threshold" }
};

const traceEventTypes: Record<string, LocalizedLabel> = {
  run_started: { zh: "Run 开始", en: "Run started" },
  run_ended: { zh: "Run 结束", en: "Run ended" },
  step_started: { zh: "步骤开始", en: "Step started" },
  step_ended: { zh: "步骤", en: "Step" },
  llm_call: { zh: "模型调用", en: "Model call" },
  tool_call: { zh: "工具调用", en: "Tool call" },
  retrieval: { zh: "检索", en: "Retrieval" },
  memory_update: { zh: "记忆更新", en: "Memory update" },
  error: { zh: "错误", en: "Error" }
};

export function analyticsDimensionLabel(locale: Locale, value: AnalyticsDimension) {
  return analyticsDimensions[value][locale];
}

export function budgetPeriodLabel(locale: Locale, value: "daily" | "monthly") {
  return budgetPeriods[value][locale];
}

export function budgetMetricLabel(locale: Locale, value: AnalyticsBudgetAlert["metric"]) {
  return budgetMetrics[value][locale];
}

export function eventChangeLabel(locale: Locale, value: DashboardRunEventChange) {
  return eventChanges[value][locale];
}

export function eventRegressionLabel(locale: Locale, value: DashboardRunEventRegression) {
  return eventRegressions[value][locale];
}

export function traceEventTypeLabel(locale: Locale, value: string) {
  const known = traceEventTypes[value];
  if (known) return known[locale];
  if (locale === "zh") return value;
  const readable = value.replaceAll("_", " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}
