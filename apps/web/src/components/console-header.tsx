import Link from "next/link";

import { BrandMark } from "~/components/brand-mark";
import { ConsoleSettings } from "~/components/console-settings";
import { localizedHref, type Locale } from "~/lib/i18n";

export function ConsoleHeader({
  locale,
  path
}: {
  locale: Locale;
  path: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex min-h-14 w-full max-w-[1800px] items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8 2xl:px-10">
        <Link
          href={localizedHref("/runs", locale)}
          className="group inline-flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
          aria-label="Agent-Trace"
        >
          <BrandMark className="size-8 shrink-0 shadow-[0_1px_3px_rgb(15_23_42/0.18)] transition-transform duration-150 group-hover:scale-[1.03]" aria-hidden />
          <span className="hidden truncate text-sm font-semibold tracking-[-0.01em] text-foreground sm:inline">
            Agent-Trace
          </span>
          <span className="hidden rounded-md border border-border/70 bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground sm:inline-flex">
            local
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          <ConsoleSettings locale={locale} path={path} />
        </div>
      </div>
    </header>
  );
}
