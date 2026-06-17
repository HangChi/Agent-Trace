import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import { formatAgent, type Locale } from "~/lib/i18n";

const agentStyles: Record<string, string> = {
  codex: "border-agent-codex-border bg-agent-codex-subtle text-agent-codex hover:bg-agent-codex-subtle",
  "claude-code":
    "border-agent-claude-border bg-agent-claude-subtle text-agent-claude hover:bg-agent-claude-subtle",
  manual: "border-agent-manual-border bg-agent-manual-subtle text-agent-manual hover:bg-agent-manual-subtle"
};

export function SourceBadge({ agent, locale }: { agent: string; locale: Locale }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-xs font-medium", agentStyles[agent] ?? agentStyles.manual)}
    >
      {formatAgent(agent, locale)}
    </Badge>
  );
}
