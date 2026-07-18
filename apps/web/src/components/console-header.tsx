import Link from "next/link";
import { BarChart3, Coins, FlaskConical, HardDrive, House, ShieldCheck } from "lucide-react";

import { BrandMark } from "~/components/brand-mark";
import { ConsoleSettings } from "~/components/console-settings";
import { localizedHref, type Locale } from "~/lib/i18n";
import { cn } from "~/lib/utils";

export function ConsoleHeader({
  locale,
  path
}: {
  locale: Locale;
  path: string;
}) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background">
      <div className="mx-auto flex min-h-16 w-full min-w-0 max-w-[1800px] items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8 2xl:px-10">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
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

          <nav
            className="flex min-w-0 items-center gap-1 border-l border-border pl-2 sm:pl-3"
            aria-label={locale === "zh" ? "主要模块" : "Primary modules"}
          >
            <Link
              href={localizedHref("/runs", locale)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-accent hover:text-foreground",
                path.startsWith("/runs")
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground"
              )}
              aria-current={path.startsWith("/runs") ? "page" : undefined}
              aria-label={locale === "zh" ? "首页" : "Home"}
            >
              <House className="size-3.5" aria-hidden />
              <span className="hidden md:inline">{locale === "zh" ? "首页" : "Home"}</span>
            </Link>
            <Link
              href={localizedHref("/token-trace", locale)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-accent hover:text-foreground",
                path.startsWith("/token-trace")
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground"
              )}
              aria-current={path.startsWith("/token-trace") ? "page" : undefined}
              aria-label="Token-Trace"
            >
              <Coins className="size-3.5" aria-hidden />
              <span className="hidden md:inline">Token-Trace</span>
            </Link>
          </nav>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <Link
            href={localizedHref("/analytics", locale)}
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 text-xs font-medium text-muted-foreground shadow-[var(--shadow-control)] transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            <BarChart3 className="size-3.5" aria-hidden />
            <span className="hidden lg:inline">{locale === "zh" ? "分析" : "Analytics"}</span>
          </Link>
          <Link
            href={localizedHref("/evaluations", locale)}
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 text-xs font-medium text-muted-foreground shadow-[var(--shadow-control)] transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            <FlaskConical className="size-3.5" aria-hidden />
            <span className="hidden lg:inline">{locale === "zh" ? "评测" : "Evaluations"}</span>
          </Link>
          <Link
            href={localizedHref("/sandbox", locale)}
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 text-xs font-medium text-muted-foreground shadow-[var(--shadow-control)] transition-colors hover:bg-accent hover:text-foreground md:inline-flex"
          >
            <ShieldCheck className="size-3.5" aria-hidden />
            <span className="hidden xl:inline">{locale === "zh" ? "回放" : "Replay"}</span>
          </Link>
          <Link
            href={localizedHref("/maintenance", locale)}
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 text-xs font-medium text-muted-foreground shadow-[var(--shadow-control)] transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            <HardDrive className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{locale === "zh" ? "维护" : "Maintenance"}</span>
          </Link>
          <ConsoleSettings locale={locale} path={path} />
        </div>
      </div>
    </header>
  );
}
