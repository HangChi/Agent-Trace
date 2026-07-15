import Link from "next/link";
import { Server } from "lucide-react";

import { BrandMark } from "~/components/brand-mark";
import { ConsoleSettings } from "~/components/console-settings";
import { copy, localizedHref, type Locale } from "~/lib/i18n";

export function ConsoleHeader({
  locale,
  path,
  collectorUrl
}: {
  locale: Locale;
  path: string;
  collectorUrl?: string;
}) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background">
      <div className="mx-auto flex min-h-16 w-full min-w-0 max-w-[1800px] items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8 2xl:px-10">
        <Link
          href={localizedHref("/runs", locale)}
          className="group inline-flex min-h-11 min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
          aria-label="Agent-Trace"
        >
          <BrandMark className="size-9 shrink-0 shadow-[0_4px_12px_color-mix(in_srgb,var(--primary)_22%,transparent)] transition-transform duration-150 group-hover:-translate-y-0.5" aria-hidden />
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-semibold tracking-[-0.02em] text-foreground">
              Agent-Trace
            </span>
            <span className="block font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Local observability
            </span>
          </span>
        </Link>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {collectorUrl ? (
            <div
              className="hidden h-9 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 text-xs shadow-[var(--shadow-control)] md:flex"
              title={collectorUrl}
            >
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-success opacity-35" />
                <span className="relative inline-flex size-2 rounded-full bg-status-success" />
              </span>
              <Server className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="font-medium text-foreground">{copy[locale].common.collector}</span>
              <span className="max-w-[190px] truncate font-mono text-[11px] text-muted-foreground">
                {collectorUrl}
              </span>
            </div>
          ) : null}
          <ConsoleSettings locale={locale} path={path} />
        </div>
      </div>
    </header>
  );
}
