import type { Route } from "next";

export type Locale = "zh" | "en";

type SearchParamValue = string | string[] | undefined;

export function parseLocale(value: SearchParamValue): Locale {
  const raw = Array.isArray(value) ? value[0] : value;

  return raw === "en" ? "en" : "zh";
}

export function localizedHref(path: string, locale: Locale): Route {
  if (locale === "zh") {
    return path as Route;
  }

  return `${path}${path.includes("?") ? "&" : "?"}lang=en` as Route;
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
      unavailable: "Collector \u4e0d\u53ef\u7528\uff1a"
    },
    runs: {
      title: "Agent \u8ffd\u8e2a\u53f0",
      subtitle: "\u8ffd\u8e2a Codex\u3001Claude Code \u548c\u672c\u5730 Agent \u7684\u8fd0\u884c\u4e0e Hook \u4e8b\u4ef6\u3002",
      allRuns: "\u5168\u90e8\u8fd0\u884c",
      agentSource: "Agent \u6765\u6e90",
      running: "\u8fdb\u884c\u4e2d",
      errors: "\u5f02\u5e38",
      recent: "\u6700\u8fd1\u8fd0\u884c",
      latest: "\u672c\u5730 collector \u6355\u83b7\u5230\u7684\u6700\u65b0\u8ffd\u8e2a\u8bb0\u5f55\u3002",
      tableRun: "\u8fd0\u884c",
      tableSource: "\u6765\u6e90",
      tableStatus: "\u72b6\u6001",
      tableStarted: "\u5f00\u59cb\u65f6\u95f4",
      tableDuration: "\u8017\u65f6",
      tableError: "\u9519\u8bef",
      tableActions: "\u64cd\u4f5c",
      refresh: "\u5237\u65b0",
      refreshing: "\u5237\u65b0\u4e2d\u2026",
      delete: "\u5220\u9664",
      deleting: "\u5220\u9664\u4e2d\u2026",
      confirmPrompt: "\u786e\u8ba4\u5220\u9664\uff1f",
      confirm: "\u786e\u8ba4",
      cancel: "\u53d6\u6d88",
      confirmDelete: "\u786e\u5b9a\u5220\u9664\u8fd9\u6761\u8fd0\u884c\u8bb0\u5f55\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002",
      deleteFailed: "\u5220\u9664\u5931\u8d25\uff1a",
      emptyTitle: "\u8fd8\u6ca1\u6709\u6355\u83b7\u5230\u8fd0\u884c",
      emptyBody: "\u542f\u52a8\u672c\u5730 collector \u540e\uff0c\u4f7f\u7528\u5df2\u63a5\u5165 hook \u7684 Agent \u5373\u53ef\u5728\u8fd9\u91cc\u770b\u5230\u8bb0\u5f55\u3002"
    },
    detail: {
      back: "\u8fd4\u56de\u8fd0\u884c\u5217\u8868",
      steps: "\u6b65\u9aa4",
      errors: "\u5f02\u5e38",
      timeline: "\u4e8b\u4ef6\u65f6\u95f4\u7ebf",
      timelineHelp: "\u6309\u53d1\u751f\u987a\u5e8f\u67e5\u770b\u6a21\u578b\u8c03\u7528\u3001\u5de5\u5177\u8c03\u7528\u3001Hook\u3001\u8f93\u51fa\u548c\u5f02\u5e38\u3002",
      summary: "\u8fd0\u884c\u6458\u8981",
      surface: "\u8fd0\u884c\u7aef",
      session: "\u4f1a\u8bdd",
      redaction: "\u9690\u79c1\u7ea7\u522b",
      totalDuration: "\u603b\u8017\u65f6",
      failedSteps: "\u5931\u8d25\u6b65\u9aa4",
      tokenUsage: "Token \u7528\u91cf",
      failureInspector: "\u5931\u8d25\u8bca\u65ad",
      noFailures: "\u5f53\u524d\u8fd0\u884c\u6ca1\u6709\u68c0\u6d4b\u5230\u5931\u8d25\u6b65\u9aa4\u3002",
      step: "\u6b65\u9aa4",
      emptyTitle: "\u8fd9\u4e2a\u8fd0\u884c\u8fd8\u6ca1\u6709\u4e8b\u4ef6",
      emptyBody: "Collector \u5df2\u521b\u5efa\u8fd0\u884c\uff0c\u4f46\u8fd8\u6ca1\u6709\u8bb0\u5f55\u5230\u6a21\u578b\u6216\u5de5\u5177\u6b65\u9aa4\u3002"
    }
  },
  en: {
    common: {
      collector: "Collector",
      shown: "Showing",
      rows: "runs",
      tokens: "Tokens",
      jsonDetail: "View JSON details",
      unavailable: "Collector unavailable: "
    },
    runs: {
      title: "Agent Trace Console",
      subtitle: "Track Codex, Claude Code, and local agent runs with hook events.",
      allRuns: "All runs",
      agentSource: "Agent source",
      running: "Running",
      errors: "Errors",
      recent: "Recent runs",
      latest: "Latest traces captured by the local collector.",
      tableRun: "Run",
      tableSource: "Source",
      tableStatus: "Status",
      tableStarted: "Started",
      tableDuration: "Duration",
      tableError: "Error",
      tableActions: "Actions",
      refresh: "Refresh",
      refreshing: "Refreshing…",
      delete: "Delete",
      deleting: "Deleting…",
      confirmPrompt: "Delete?",
      confirm: "Confirm",
      cancel: "Cancel",
      confirmDelete: "Delete this run? This action cannot be undone.",
      deleteFailed: "Delete failed: ",
      emptyTitle: "No runs captured yet",
      emptyBody: "Start the local collector and use an agent with hooks installed to populate this table."
    },
    detail: {
      back: "Back to runs",
      steps: "Steps",
      errors: "Errors",
      timeline: "Event timeline",
      timelineHelp: "Review model calls, tool calls, hooks, outputs, and failures in order.",
      summary: "Run summary",
      surface: "Surface",
      session: "Session",
      redaction: "Redaction",
      totalDuration: "Total duration",
      failedSteps: "Failed steps",
      tokenUsage: "Token usage",
      failureInspector: "Failure inspector",
      noFailures: "No failed steps detected for this run.",
      step: "Step",
      emptyTitle: "No events captured for this run",
      emptyBody: "The collector has created the run, but no model or tool steps were recorded yet."
    }
  }
} as const;

export function formatAgent(agent: string, locale: Locale) {
  if (agent === "codex") {
    return "Codex";
  }

  if (agent === "claude-code") {
    return "Claude Code";
  }

  return locale === "zh" ? "\u624b\u52a8" : "Manual";
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
      cli: "\u672c\u5730",
      desktop: "\u684c\u9762\u7aef",
      web: "\u7f51\u9875\u7aef"
    },
    en: {
      cli: "Local",
      desktop: "Desktop",
      web: "Web"
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

  return locale === "zh" ? "\u4ec5\u5143\u6570\u636e" : "Metadata only";
}

export function formatEventType(type: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    zh: {
      run_started: "\u8fd0\u884c\u5f00\u59cb",
      run_completed: "\u8fd0\u884c\u5b8c\u6210",
      step_started: "\u6b65\u9aa4\u5f00\u59cb",
      step_completed: "\u6b65\u9aa4\u5b8c\u6210",
      tool_call: "\u5de5\u5177\u8c03\u7528",
      llm_call: "\u6a21\u578b\u8c03\u7528",
      memory_update: "\u8bb0\u5fc6\u66f4\u65b0",
      error: "\u5f02\u5e38"
    },
    en: {
      run_started: "Run started",
      run_completed: "Run completed",
      step_started: "Step started",
      step_completed: "Step completed",
      tool_call: "Tool call",
      llm_call: "Model call",
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
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

export function runningDurationLabel(locale: Locale) {
  return locale === "zh" ? "\u8fdb\u884c\u4e2d" : "running";
}
