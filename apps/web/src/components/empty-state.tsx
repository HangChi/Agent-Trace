import { Inbox } from "lucide-react";
import { cn } from "~/lib/utils";
import { type Locale } from "~/lib/i18n";

export function EmptyState({
  locale: _locale,
  title,
  body,
  className
}: {
  locale: Locale;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 py-16 text-center",
        className
      )}
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
