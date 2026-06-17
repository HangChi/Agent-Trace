import { AlertTriangle } from "lucide-react";
import { cn } from "~/lib/utils";
import { copy, type Locale } from "~/lib/i18n";

export function ErrorState({
  message,
  locale,
  className
}: {
  message: string;
  locale: Locale;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-t border-destructive/30 bg-destructive/10 px-4 py-4 text-sm",
        className
      )}
    >
      <AlertTriangle
        className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <div>
        <p className="font-medium text-destructive">{copy[locale].common.unavailable}</p>
        <p className="mt-1 break-words font-mono text-xs text-destructive/80">{message}</p>
      </div>
    </div>
  );
}
