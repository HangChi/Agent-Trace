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
  trae: "border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-50 dark:border-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-300",
  warp: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-50 dark:border-violet-900 dark:bg-violet-950/35 dark:text-violet-300",
  cline: "border-lime-200 bg-lime-50 text-lime-700 hover:bg-lime-50 dark:border-lime-900 dark:bg-lime-950/35 dark:text-lime-300",
  zed: "border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200",
  kiro: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-50 dark:border-fuchsia-900 dark:bg-fuchsia-950/35 dark:text-fuchsia-300",
  grok: "border-neutral-300 bg-neutral-50 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200",
  gemini: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:bg-blue-950/35 dark:text-blue-300",
  "usage-scan":
    "border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-50 dark:border-teal-900 dark:bg-teal-950/35 dark:text-teal-300",
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
