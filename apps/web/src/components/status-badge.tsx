import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import { formatStatus, type Locale } from "~/lib/i18n";

const statusStyles: Record<string, string> = {
  success:
    "bg-status-success-subtle text-status-success border-status-success-border hover:bg-status-success-subtle",
  error:
    "bg-status-error-subtle text-status-error border-status-error-border hover:bg-status-error-subtle",
  running:
    "bg-status-warning-subtle text-status-warning border-status-warning-border hover:bg-status-warning-subtle"
};

export function StatusBadge({ status, locale }: { status: string; locale: Locale }) {
  const dotStyles: Record<string, string> = {
    success: "bg-status-success",
    error: "bg-status-error",
    running: "animate-pulse bg-status-warning"
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-semibold",
        statusStyles[status] ?? "bg-muted text-muted-foreground border-border"
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotStyles[status] ?? "bg-muted-foreground")} aria-hidden />
      {formatStatus(status, locale)}
    </Badge>
  );
}
