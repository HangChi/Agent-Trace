import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import { formatAgent, type Locale } from "~/lib/i18n";

const agentStyles: Record<string, string> = {
  codex: "border-agent-codex-border bg-agent-codex-subtle text-agent-codex hover:bg-agent-codex-subtle",
  "claude-code":
    "border-agent-claude-border bg-agent-claude-subtle text-agent-claude hover:bg-agent-claude-subtle",
  opencode: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-300",
  cursor: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50 dark:border-sky-900 dark:bg-sky-950/35 dark:text-sky-300",
  antigravity:
    "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-300",
  kimi: "border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-50 dark:border-pink-900 dark:bg-pink-950/35 dark:text-pink-300",
  qwen: "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/35 dark:text-indigo-300",
  "github-copilot":
    "border-zinc-300 bg-zinc-50 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
  manual: "border-agent-manual-border bg-agent-manual-subtle text-agent-manual hover:bg-agent-manual-subtle"
};

export function SourceBadge({ agent, locale }: { agent: string; locale: Locale }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-xs font-semibold", agentStyles[agent] ?? agentStyles.manual)}
    >
      {formatAgent(agent, locale)}
    </Badge>
  );
}
