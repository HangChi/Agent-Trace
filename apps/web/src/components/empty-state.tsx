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
      <div className="relative mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-trace/25 bg-trace-subtle">
        <span className="absolute -left-6 top-1/2 h-px w-6 bg-trace/35" aria-hidden />
        <Inbox className="h-5 w-5 text-trace" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
