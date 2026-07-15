import type { DashboardEventVisibility } from "@agent-trace/schema";

import type { Locale } from "~/lib/i18n";

type EventVisibilityCounts = {
  total: number;
  display: number;
  hidden: number;
};

export function getEventVisibilityPresentation(
  visibility: DashboardEventVisibility,
  counts: EventVisibilityCounts,
  locale: Locale
) {
  const total = formatCount(counts.total, locale);
  const display = formatCount(counts.display, locale);
  const hidden = formatCount(counts.hidden, locale);

  if (visibility === "hidden") {
    return {
      modeLabel: locale === "zh" ? `已隐藏事件 ${hidden}` : `Hidden events ${hidden}`,
      description: locale === "zh"
        ? "当前仅显示被默认视图隐藏的 Transcript 和辅助事件。"
        : "Showing only Transcript and auxiliary events hidden by the default view.",
      toggleLabel: locale === "zh"
        ? `返回默认事件: ${display}`
        : `Back to default events: ${display}`,
      nextVisibility: "display" as const
    };
  }

  if (visibility === "all") {
    return {
      modeLabel: locale === "zh" ? `全部事件 ${total}` : `All events ${total}`,
      description: locale === "zh"
        ? `当前显示全部事件，包括 ${hidden} 条默认隐藏事件。`
        : `Showing all events, including ${hidden} hidden by default.`,
      toggleLabel: locale === "zh"
        ? `返回默认事件: ${display}`
        : `Back to default events: ${display}`,
      nextVisibility: "display" as const
    };
  }

  return {
    modeLabel: locale === "zh" ? `默认事件 ${display}` : `Default events ${display}`,
    description: locale === "zh"
      ? "默认展示命令、工具、Skill、MCP 和 Token 事件。"
      : "Showing command, tool, Skill, MCP, and Token events by default.",
    toggleLabel: locale === "zh"
      ? `查看已隐藏事件: ${hidden}`
      : `View hidden events: ${hidden}`,
    nextVisibility: "hidden" as const
  };
}

function formatCount(value: number, locale: Locale) {
  return value.toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
}
