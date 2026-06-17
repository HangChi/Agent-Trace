import { formatAgent, formatStatus, type Locale } from "../i18n";

export function SourceBadge({ agent, locale }: { agent: string; locale: Locale }) {
  const className =
    agent === "codex"
      ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300"
      : agent === "claude-code"
        ? "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
        : "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300";

  return (
    <span className={`inline-flex border px-2 py-1 font-mono text-xs font-medium ${className}`}>
      {formatAgent(agent, locale)}
    </span>
  );
}

export function StatusBadge({ status, locale }: { status: string; locale: Locale }) {
  const className =
    status === "success"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "error"
        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";

  return (
    <span className={`inline-flex px-2 py-1 text-xs font-medium ${className}`}>
      {formatStatus(status, locale)}
    </span>
  );
}
