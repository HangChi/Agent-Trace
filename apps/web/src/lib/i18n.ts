import type { Route } from "next";
import type { DashboardTraceInsight, DashboardTraceInsightKind } from "@agent-trace/schema";

export type Locale = "zh" | "en";

type SearchParamValue = string | string[] | undefined;

export function parseLocale(value: SearchParamValue): Locale {
  const raw = Array.isArray(value) ? value[0] : value;

  return raw === "en" ? "en" : "zh";
}

export function localizedHref(path: string, locale: Locale): Route {
  const queryIndex = path.indexOf("?");
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : path.slice(queryIndex + 1);
  const params = new URLSearchParams(query);

  if (locale === "en") {
    params.set("lang", "en");
  } else {
    params.delete("lang");
  }

  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ""}` as Route;
}

export const languageLabels: Record<Locale, string> = {
  zh: "\u4e2d\u6587",
  en: "English"
};

export const copy = {
  zh: {
    common: {
      collector: "Collector",
      shown: "\u663e\u793a",
      rows: "\u6761",
      tokens: "Tokens",
      jsonDetail: "\u67e5\u770b JSON \u8be6\u60c5",
      themeToggle: "\u5207\u6362\u4e3b\u9898",
      themeLight: "\u5207\u6362\u5230\u6d45\u8272\u4e3b\u9898",
      themeDark: "\u5207\u6362\u5230\u6df1\u8272\u4e3b\u9898",
      unavailable: "Collector \u4e0d\u53ef\u7528\uff1a"
    },
    runs: {
      consoleLabel: "\u8fd0\u884c\u63a7\u5236\u53f0",
      title: "Agent \u8ffd\u8e2a\u53f0",
      subtitle:
        "\u8ffd\u8e2a Codex\u3001Claude Code\u3001OpenCode\u3001Cursor\u3001Antigravity\u3001Trae\u3001Warp\u3001Cline\u3001Zed\u3001Kiro\u3001Grok\u3001Gemini \u548c\u672c\u5730 Agent \u7684\u547d\u4ee4\u3001\u5de5\u5177\u3001skill\u3001MCP \u548c token\u3002",
      allRuns: "\u5168\u90e8\u8fd0\u884c",
      agentSource: "Agent \u6765\u6e90",
      running: "\u8fdb\u884c\u4e2d",
      errors: "\u5f02\u5e38",
      recent: "\u6700\u8fd1\u8fd0\u884c",
      latest: "\u672c\u5730 collector \u6355\u83b7\u5230\u7684\u6700\u65b0\u8ffd\u8e2a\u8bb0\u5f55\u3002",
      perPage: "\u6bcf\u9875 {count} \u6761",
      paginationSummary: "\u7b2c {page} / {totalPages} \u9875 \u00b7 \u672c\u9875 {currentCount} \u6761 \u00b7 \u6bcf\u9875 {pageSize} \u6761",
      tableRun: "\u8fd0\u884c",
      tableSource: "\u6765\u6e90",
      tableStatus: "\u72b6\u6001",
      tableModel: "\u6a21\u578b",
      tableTracked: "\u8ffd\u8e2a\u5185\u5bb9",
      tableTokens: "Tokens",
      tableCost: "\u6210\u672c",
      tableStarted: "\u5f00\u59cb\u65f6\u95f4",
      tableDuration: "\u8017\u65f6",
      tableError: "\u9519\u8bef",
      tableActions: "\u64cd\u4f5c",
      refresh: "\u5237\u65b0",
      refreshing: "\u5237\u65b0\u4e2d...",
      showAllRuns: "\u663e\u793a\u5168\u90e8\u8bb0\u5f55",
      hideEmptyRuns: "\u9690\u85cf\u7a7a\u8bb0\u5f55",
      selectAll: "\u9009\u62e9\u5168\u90e8\u8fd0\u884c\u8bb0\u5f55",
      selectRun: "\u9009\u62e9\u8fd0\u884c\u8bb0\u5f55",
      selectedRuns: "\u5df2\u9009\u62e9 {count} \u6761",
      clearSelection: "\u6e05\u9664\u9009\u62e9",
      bulkDelete: "\u6279\u91cf\u5220\u9664",
      bulkDeleteConfirmPrompt: "\u786e\u8ba4\u6279\u91cf\u5220\u9664\uff1f",
      bulkDeleteConfirm:
        "\u786e\u5b9a\u5220\u9664\u5df2\u9009\u62e9\u7684 {count} \u6761\u8fd0\u884c\u8bb0\u5f55\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002",
      bulkDeleteFailed: "\u6279\u91cf\u5220\u9664\u5931\u8d25\uff1a",
      delete: "\u5220\u9664",
      deleting: "\u5220\u9664\u4e2d...",
      confirmPrompt: "\u786e\u8ba4\u5220\u9664\uff1f",
      confirm: "\u786e\u8ba4",
      cancel: "\u53d6\u6d88",
      confirmDelete:
        "\u786e\u5b9a\u5220\u9664\u8fd9\u6761\u8fd0\u884c\u8bb0\u5f55\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002",
      deleteFailed: "\u5220\u9664\u5931\u8d25\uff1a",
      costUnpriced: "\u4ef7\u683c\u672a\u77e5",
      costEstimated: "\u4f30\u7b97",
      costUsdOnly: "\u6c47\u7387\u4e0d\u53ef\u7528",
      usageTitle: "\u672c\u5730\u7528\u91cf\u8d26\u672c",
      usageHelp: "\u6309\u5ba2\u6237\u7aef\u548c\u6a21\u578b\u6c47\u603b Scanner \u4fdd\u5b58\u7684 Token \u4e0e API \u7b49\u4ef7\u4f30\u7b97\u6210\u672c\u3002",
      usageClients: "\u5ba2\u6237\u7aef",
      usageModels: "\u6a21\u578b",
      usageEstimatedCost: "\u4f30\u7b97\u6210\u672c",
      usageEmpty: "\u5c1a\u65e0\u7528\u91cf\u6570\u636e\u3002",
      usageUnavailable: "\u7528\u91cf\u6c47\u603b\u6682\u4e0d\u53ef\u7528\u3002",
      scannerStatus: "\u626b\u63cf\u5668\u72b6\u6001",
      scannerStatusHelp:
        "\u663e\u793a tokscale \u68c0\u6d4b\u5230\u7684\u672c\u5730 agent \u8bb0\u5f55\u3001\u7f13\u5b58\u548c\u9700\u8981 login/sync \u7684\u9879\u3002",
      scannerClient: "\u5ba2\u6237\u7aef",
      scannerState: "\u72b6\u6001",
      scannerMessages: "\u6d88\u606f",
      scannerPath: "\u8def\u5f84",
      scannerAction: "\u64cd\u4f5c",
      scannerNoPath: "\u672a\u68c0\u6d4b\u5230",
      scannerShowAll: "\u663e\u793a\u5168\u90e8",
      scannerShowDetected: "\u4ec5\u663e\u793a\u68c0\u6d4b\u5230\u7684",
      desktopSettings: "\u8bbe\u7f6e",
      desktopCloseBehavior: "\u5173\u95ed\u6309\u94ae\u884c\u4e3a",
      desktopCloseBehaviorDescription: "\u9009\u62e9\u70b9\u51fb\u7a97\u53e3\u5173\u95ed\u6309\u94ae\u65f6\u6267\u884c\u7684\u52a8\u4f5c\u3002",
      desktopCloseAsk: "\u6bcf\u6b21\u8be2\u95ee",
      desktopCloseAskDetail: "\u5173\u95ed\u65f6\u5148\u663e\u793a\u9009\u62e9\u7a97\u3002",
      desktopCloseExit: "\u9000\u51fa\u7a0b\u5e8f",
      desktopCloseExitDetail: "\u5173\u95ed\u7a97\u53e3\u5e76\u505c\u6b62\u672c\u5730\u670d\u52a1\u3002",
      desktopCloseMinimize: "\u6700\u5c0f\u5316\u5230\u6258\u76d8",
      desktopCloseMinimizeDetail: "\u9690\u85cf\u7a97\u53e3\uff0c\u672c\u5730\u670d\u52a1\u7ee7\u7eed\u8fd0\u884c\u3002",
      desktopSettingsUnavailable: "\u684c\u9762\u7aef\u8bbe\u7f6e\u5f53\u524d\u4e0d\u53ef\u7528\u3002",
      desktopSettingsSaving: "\u4fdd\u5b58\u4e2d...",
      desktopSettingsSaved: "\u5df2\u4fdd\u5b58",
      desktopSettingsFailed: "\u8bbe\u7f6e\u4fdd\u5b58\u5931\u8d25\u3002",
      emptyTitle: "\u8fd8\u6ca1\u6709\u6355\u83b7\u5230\u8fd0\u884c",
      emptyBody:
        "\u542f\u52a8\u672c\u5730 collector \u540e\uff0c\u4f7f\u7528\u5df2\u63a5\u5165 hook \u7684 Agent \u5373\u53ef\u5728\u8fd9\u91cc\u770b\u5230\u8bb0\u5f55\u3002"
    },
    detail: {
      title: "\u8ffd\u8e2a\u8be6\u60c5",
      back: "\u8fd4\u56de\u8fd0\u884c\u5217\u8868",
      backToTop: "\u8fd4\u56de\u9876\u90e8",
      steps: "\u6b65\u9aa4",
      errors: "\u5f02\u5e38",
      timeline: "\u8ffd\u8e2a\u65f6\u95f4\u7ebf",
      timelineHelp:
        "\u9ed8\u8ba4\u53ea\u5c55\u793a\u547d\u4ee4\u3001\u5de5\u5177\u3001skill\u3001MCP \u548c token \u4e8b\u4ef6\u3002",
      tree: "\u8ffd\u8e2a\u6811",
      treeHelp:
        "\u6309\u7236\u4e8b\u4ef6\u5173\u7cfb\u7ec4\u7ec7\u7b26\u5408\u5f53\u524d\u7b5b\u9009\u7684\u5168\u90e8\u4e8b\u4ef6\uff1b\u7f3a\u5931\u7236\u4e8b\u4ef6\u6216\u5faa\u73af\u5173\u7cfb\u663e\u793a\u4e3a\u6839\u8282\u70b9\u3002",
      timelineView: "\u65f6\u95f4\u7ebf",
      treeView: "\u6811\u72b6",
      summary: "\u8fd0\u884c\u6458\u8981",
      runStatus: "\u8fd0\u884c\u72b6\u6001",
      startedAt: "\u5f00\u59cb\u65f6\u95f4",
      endedAt: "\u7ed3\u675f\u65f6\u95f4",
      runData: "Run \u539f\u59cb\u6570\u636e",
      surface: "\u8fd0\u884c\u7aef",
      session: "\u4f1a\u8bdd",
      redaction: "\u9690\u79c1\u7ea7\u522b",
      totalDuration: "\u603b\u8017\u65f6",
      failedSteps: "\u5931\u8d25\u6b65\u9aa4",
      tokenUsage: "Token \u7528\u91cf",
      automaticDiagnostics: "\u81ea\u52a8\u8bca\u65ad",
      insightTitles: {
        repeated_action: "\u91cd\u590d\u64cd\u4f5c",
        retry_loop: "\u91cd\u8bd5\u5faa\u73af",
        slow_step: "\u6162\u6b65\u9aa4",
        token_hotspot: "Token \u70ed\u70b9",
        failure_cascade: "\u5931\u8d25\u7ea7\u8054"
      },
      insightEvidence: {
        repeated_action: "{actionName} \u8fde\u7eed\u6267\u884c\u4e86 {count} \u6b21\u3002",
        retry_loop: "{actionName} \u5171\u5c1d\u8bd5 {attempts} \u6b21\uff0c\u5176\u4e2d\u5931\u8d25 {failedAttempts} \u6b21\u3002",
        slow_step: "\u8017\u65f6 {durationMs} \u6beb\u79d2\uff0c\u8fbe\u5230 {thresholdMs} \u6beb\u79d2\u9608\u503c\u3002",
        token_hotspot: "\u4f7f\u7528 {eventTokens} / {runTokens} \u4e2a\u8fd0\u884c Token\uff08{share}\uff09\u3002",
        failure_cascade: "\u68c0\u6d4b\u5230 {errorCount} \u4e2a\u5173\u8054\u9519\u8bef\u3002"
      },
      insightSeverities: {
        info: "\u4fe1\u606f",
        warning: "\u8b66\u544a",
        error: "\u9519\u8bef"
      },
      failureInspector: "\u5931\u8d25\u8bca\u65ad",
      noFailures: "\u5f53\u524d\u8fd0\u884c\u6ca1\u6709\u68c0\u6d4b\u5230\u5931\u8d25\u6b65\u9aa4\u3002",
      step: "\u6b65\u9aa4",
      hiddenEvents: "\u5df2\u9690\u85cf\u5176\u4ed6\u4e8b\u4ef6",
      showHiddenEvents: "\u663e\u793a\u5df2\u9690\u85cf\u4e8b\u4ef6",
      hideOtherEvents: "\u9690\u85cf\u5176\u4ed6\u4e8b\u4ef6",
      emptyTitle: "\u8fd9\u4e2a\u8fd0\u884c\u8fd8\u6ca1\u6709\u53ef\u5c55\u793a\u4e8b\u4ef6",
      emptyBody:
        "Collector \u5df2\u4fdd\u5b58\u4e8b\u4ef6\uff0c\u4f46\u8fd8\u6ca1\u6709\u547d\u4ee4\u3001\u5de5\u5177\u3001skill\u3001MCP \u6216 token \u8bb0\u5f55\u3002",
      emptyFilterTitle: "\u6ca1\u6709\u5339\u914d\u7b5b\u9009\u6761\u4ef6\u7684\u4e8b\u4ef6",
      emptyFilterBody: "\u8bd5\u7740\u8c03\u6574\u641c\u7d22\u3001\u72b6\u6001\u3001\u7c7b\u578b\u6216\u5206\u7c7b\u6761\u4ef6\u3002",
      filterSearch: "\u641c\u7d22",
      filterSearchPlaceholder: "\u6309\u540d\u79f0\u3001\u547d\u4ee4\u3001\u5de5\u5177\u6216 ID \u641c\u7d22",
      filterStatus: "\u72b6\u6001",
      filterType: "\u7c7b\u578b",
      filterCategory: "\u5206\u7c7b",
      filterAll: "\u5168\u90e8",
      applyFilters: "\u7b5b\u9009",
      clearFilters: "\u6e05\u9664",
      previousPage: "\u4e0a\u4e00\u9875",
      nextPage: "\u4e0b\u4e00\u9875"
    }
  },
  en: {
    common: {
      collector: "Collector",
      shown: "Showing",
      rows: "runs",
      tokens: "Tokens",
      jsonDetail: "View JSON details",
      themeToggle: "Toggle theme",
      themeLight: "Switch to light theme",
      themeDark: "Switch to dark theme",
      unavailable: "Collector unavailable: "
    },
    runs: {
      consoleLabel: "Run console",
      title: "Agent Trace Console",
      subtitle:
        "Track Codex, Claude Code, OpenCode, Cursor, Antigravity, Trae, Warp, Cline, Zed, Kiro, Grok, Gemini, and local agent commands, tools, skills, MCP calls, and tokens.",
      allRuns: "All runs",
      agentSource: "Agent source",
      running: "Running",
      errors: "Errors",
      recent: "Recent runs",
      latest: "Latest traces captured by the local collector.",
      perPage: "{count} per page",
      paginationSummary: "Page {page} of {totalPages} \u00b7 {currentCount} on this page \u00b7 {pageSize} per page",
      tableRun: "Run",
      tableSource: "Source",
      tableStatus: "Status",
      tableModel: "Model",
      tableTracked: "Tracked content",
      tableTokens: "Tokens",
      tableCost: "Cost",
      tableStarted: "Started",
      tableDuration: "Duration",
      tableError: "Error",
      tableActions: "Actions",
      refresh: "Refresh",
      refreshing: "Refreshing...",
      showAllRuns: "Show all runs",
      hideEmptyRuns: "Hide empty runs",
      selectAll: "Select all runs",
      selectRun: "Select run",
      selectedRuns: "{count} selected",
      clearSelection: "Clear selection",
      bulkDelete: "Delete selected",
      bulkDeleteConfirmPrompt: "Delete selected runs?",
      bulkDeleteConfirm: "Delete the {count} selected runs? This action cannot be undone.",
      bulkDeleteFailed: "Batch delete failed: ",
      delete: "Delete",
      deleting: "Deleting...",
      confirmPrompt: "Delete?",
      confirm: "Confirm",
      cancel: "Cancel",
      confirmDelete: "Delete this run? This action cannot be undone.",
      deleteFailed: "Delete failed: ",
      costUnpriced: "unpriced",
      costEstimated: "estimated",
      costUsdOnly: "rate unavailable",
      usageTitle: "Local usage ledger",
      usageHelp: "Token totals and API-equivalent estimated cost saved by the scanner, grouped by client and model.",
      usageClients: "Clients",
      usageModels: "Models",
      usageEstimatedCost: "Estimated cost",
      usageEmpty: "No usage data yet.",
      usageUnavailable: "Usage summary is unavailable.",
      scannerStatus: "Scanner status",
      scannerStatusHelp:
        "Shows local agent records, caches, and clients that need login/sync as reported by tokscale.",
      scannerClient: "Client",
      scannerState: "State",
      scannerMessages: "Messages",
      scannerPath: "Path",
      scannerAction: "Action",
      scannerNoPath: "not detected",
      scannerShowAll: "Show all",
      scannerShowDetected: "Detected only",
      desktopSettings: "Settings",
      desktopCloseBehavior: "Close button behavior",
      desktopCloseBehaviorDescription: "Choose what happens when the window close button is clicked.",
      desktopCloseAsk: "Ask every time",
      desktopCloseAskDetail: "Show the close choice dialog first.",
      desktopCloseExit: "Exit app",
      desktopCloseExitDetail: "Close the window and stop local services.",
      desktopCloseMinimize: "Minimize to tray",
      desktopCloseMinimizeDetail: "Hide the window while local services keep running.",
      desktopSettingsUnavailable: "Desktop settings are unavailable.",
      desktopSettingsSaving: "Saving...",
      desktopSettingsSaved: "Saved",
      desktopSettingsFailed: "Settings could not be saved.",
      emptyTitle: "No runs captured yet",
      emptyBody: "Start the local collector and use an agent with hooks installed to populate this table."
    },
    detail: {
      title: "Trace detail",
      back: "Back to runs",
      backToTop: "Back to top",
      steps: "Steps",
      errors: "Errors",
      timeline: "Trace timeline",
      timelineHelp: "Shows commands, tools, skills, MCP calls, and token events by default.",
      tree: "Trace tree",
      treeHelp:
        "Groups all events matching the current filters by parent relationship; missing parents and cycles appear as roots.",
      timelineView: "Timeline",
      treeView: "Tree",
      summary: "Run summary",
      runStatus: "Run status",
      startedAt: "Started",
      endedAt: "Ended",
      runData: "Raw run data",
      surface: "Surface",
      session: "Session",
      redaction: "Redaction",
      totalDuration: "Total duration",
      failedSteps: "Failed steps",
      tokenUsage: "Token usage",
      automaticDiagnostics: "Automatic diagnostics",
      insightTitles: {
        repeated_action: "Repeated action",
        retry_loop: "Retry loop",
        slow_step: "Slow step",
        token_hotspot: "Token hotspot",
        failure_cascade: "Failure cascade"
      },
      insightEvidence: {
        repeated_action: "{actionName} repeated {count} times.",
        retry_loop: "{actionName} took {attempts} attempts, including {failedAttempts} failed attempts.",
        slow_step: "Duration {durationMs} ms reached the {thresholdMs} ms threshold.",
        token_hotspot: "{eventTokens} of {runTokens} run tokens ({share}).",
        failure_cascade: "{errorCount} related errors were detected."
      },
      insightSeverities: {
        info: "Info",
        warning: "Warning",
        error: "Error"
      },
      failureInspector: "Failure inspector",
      noFailures: "No failed steps detected for this run.",
      step: "Step",
      hiddenEvents: "Other events hidden",
      showHiddenEvents: "Show hidden events",
      hideOtherEvents: "Hide other events",
      emptyTitle: "No displayable events captured for this run",
      emptyBody: "The collector has stored events, but no command, tool, skill, MCP, or token record is available yet.",
      emptyFilterTitle: "No events match the filters",
      emptyFilterBody: "Adjust the search, status, type, or category filters.",
      filterSearch: "Search",
      filterSearchPlaceholder: "Search by name, command, tool, or ID",
      filterStatus: "Status",
      filterType: "Type",
      filterCategory: "Category",
      filterAll: "All",
      applyFilters: "Filter",
      clearFilters: "Clear",
      previousPage: "Previous",
      nextPage: "Next"
    }
  }
} as const;

export function formatTraceInsightTitle(kind: DashboardTraceInsightKind, locale: Locale) {
  return copy[locale].detail.insightTitles[kind];
}

export function formatTraceInsightEvidence(insight: DashboardTraceInsight, locale: Locale) {
  const numberFormat = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en");
  const evidence = Object.fromEntries(
    Object.entries(insight.evidence).map(([key, value]) => [
      key,
      typeof value === "number" ? numberFormat.format(value) : value
    ])
  );

  if (typeof insight.evidence.share === "number") {
    evidence.share = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en", {
      style: "percent",
      maximumFractionDigits: 1
    }).format(insight.evidence.share);
  }

  return Object.entries(evidence).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    copy[locale].detail.insightEvidence[insight.kind] as string
  );
}

export function formatAgent(agent: string, locale: Locale) {
  const labels: Record<string, string> = {
    codex: "Codex",
    "claude-code": "Claude Code",
    opencode: "OpenCode",
    cursor: "Cursor",
    antigravity: "Antigravity",
    kimi: "Kimi",
    qwen: "Qwen",
    "github-copilot": "GitHub Copilot CLI",
    trae: "Trae",
    warp: "Warp",
    cline: "Cline",
    zed: "Zed",
    kiro: "Kiro",
    grok: "Grok",
    codebuddy: "CodeBuddy",
    workbuddy: "WorkBuddy",
    openclaw: "OpenClaw",
    hermes: "Hermes",
    kilo: "Kilo",
    kilocode: "KiloCode",
    roocode: "RooCode",
    goose: "Goose",
    gemini: "Gemini",
    pi: "Pi",
    zcode: "ZCode",
    "usage-scan": locale === "zh" ? "\u7528\u91cf\u626b\u63cf" : "Usage Scan",
    manual: locale === "zh" ? "\u624b\u52a8" : "Manual"
  };

  return labels[agent] ?? agent;
}

export function formatStatus(status: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    zh: {
      success: "\u6210\u529f",
      error: "\u5f02\u5e38",
      running: "\u8fdb\u884c\u4e2d"
    },
    en: {
      success: "Success",
      error: "Error",
      running: "Running"
    }
  };

  return labels[locale][status] ?? status;
}

export function formatSurface(surface: string | undefined, locale: Locale) {
  if (!surface) {
    return undefined;
  }

  const labels: Record<Locale, Record<string, string>> = {
    zh: {
      cli: "\u7ec8\u7aef/CLI",
      desktop: "\u684c\u9762\u7aef",
      web: "\u7f51\u9875\u7aef",
      local: "\u672c\u5730\u626b\u63cf",
      unknown: "\u672a\u6807\u8bb0\u7aef"
    },
    en: {
      cli: "CLI",
      desktop: "Desktop",
      web: "Web",
      local: "Local scan",
      unknown: "Unmarked"
    }
  };

  return labels[locale][surface] ?? surface;
}

export function formatRedaction(redaction: string | undefined, locale: Locale) {
  if (!redaction) {
    return undefined;
  }

  if (redaction !== "metadata") {
    return redaction;
  }

  return locale === "zh" ? "\u5143\u6570\u636e\u6a21\u5f0f" : "Metadata mode";
}

export function formatEventType(type: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    zh: {
      run_started: "\u8fd0\u884c\u5f00\u59cb",
      run_ended: "\u8fd0\u884c\u7ed3\u675f",
      step_started: "\u6b65\u9aa4\u5f00\u59cb",
      step_ended: "\u6b65\u9aa4\u7ed3\u675f",
      tool_call: "\u5de5\u5177\u8c03\u7528",
      llm_call: "\u6a21\u578b\u8c03\u7528",
      retrieval: "\u68c0\u7d22",
      memory_update: "\u8bb0\u5fc6\u66f4\u65b0",
      error: "\u5f02\u5e38"
    },
    en: {
      run_started: "Run started",
      run_ended: "Run ended",
      step_started: "Step started",
      step_ended: "Step ended",
      tool_call: "Tool call",
      llm_call: "Model call",
      retrieval: "Retrieval",
      memory_update: "Memory update",
      error: "Error"
    }
  };

  return labels[locale][type] ?? type;
}

export function formatDateTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

export function formatClockTime(value: string, locale: Locale) {
  const ms = parseTraceTimestampMs(value);

  if (ms === undefined) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(ms));
}

export function runningDurationLabel(locale: Locale) {
  return locale === "zh" ? "\u8fdb\u884c\u4e2d" : "running";
}

function parseTraceTimestampMs(value: string) {
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    const parsed = parseNumericTimestampMs(trimmed);

    return isReasonableTimestampMs(parsed) ? parsed : undefined;
  }

  const ms = new Date(trimmed).getTime();

  return isReasonableTimestampMs(ms) ? ms : undefined;
}

function parseNumericTimestampMs(value: string) {
  const digits = BigInt(value);

  if (digits <= 0n) {
    return Number.NaN;
  }

  if (digits >= 100_000_000_000_000_000n) {
    return Number(digits / 1_000_000n);
  }

  if (digits >= 100_000_000_000_000n) {
    return Number(digits / 1_000n);
  }

  if (digits >= 100_000_000_000n) {
    return Number(digits);
  }

  if (digits >= 1_000_000_000n) {
    return Number(digits * 1_000n);
  }

  return Number.NaN;
}

function isReasonableTimestampMs(value: number) {
  return Number.isFinite(value) && value >= 946_684_800_000;
}
