"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Coins,
  FlaskConical,
  HardDrive,
  House,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X
} from "lucide-react";

import { BrandMark } from "~/components/brand-mark";
import { ConsoleSettings } from "~/components/console-settings";
import { copy, localizedHref, type Locale } from "~/lib/i18n";
import { cn } from "~/lib/utils";

export function ConsoleHeader({
  locale,
  path
}: {
  locale: Locale;
  path: string;
}) {
  const isTokenTrace = path.startsWith("/token-trace");
  const isTokenCalendar = isTokenTrace && path.includes("view=calendar");
  const isTokenOverview = isTokenTrace && !isTokenCalendar;
  const tokenText = copy[locale].tokenTrace;
  const comingSoonText = locale === "zh" ? "敬请期待" : "Coming soon";
  const tokenMenuRef = useRef<HTMLDetailsElement>(null);

  const closeTokenMenu = () => {
    tokenMenuRef.current?.removeAttribute("open");
  };

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const menu = tokenMenuRef.current;

      if (
        menu?.open &&
        event.target instanceof Node &&
        !menu.contains(event.target)
      ) {
        closeTokenMenu();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

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
            <details
              ref={tokenMenuRef}
              className="group relative"
              onMouseLeave={closeTokenMenu}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  closeTokenMenu();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  closeTokenMenu();
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary
                className={cn(
                  "inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium outline-none transition-colors",
                  "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
                  isTokenTrace
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground"
                )}
                aria-label="Token-Trace"
              >
                <Coins className="size-3.5" aria-hidden />
                <span className="hidden md:inline">Token-Trace</span>
                <ChevronDown
                  className="size-3.5 transition-transform duration-150 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="absolute left-0 top-full z-50 w-44 pt-2">
                <div className="rounded-xl border border-border bg-popover p-1.5 shadow-[var(--shadow-panel)]">
                  <Link
                    href={localizedHref("/token-trace", locale)}
                    onClick={closeTokenMenu}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-accent hover:text-foreground",
                      isTokenOverview
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground"
                    )}
                    aria-current={isTokenOverview ? "page" : undefined}
                    aria-label={tokenText.overview}
                  >
                    <TrendingUp className="size-3.5" aria-hidden />
                    <span>{tokenText.overview}</span>
                  </Link>
                  <Link
                    href={localizedHref("/token-trace?view=calendar", locale)}
                    onClick={closeTokenMenu}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-accent hover:text-foreground",
                      isTokenCalendar
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground"
                    )}
                    aria-current={isTokenCalendar ? "page" : undefined}
                    aria-label={tokenText.calendar}
                  >
                    <CalendarDays className="size-3.5" aria-hidden />
                    <span>{tokenText.calendar}</span>
                  </Link>
                </div>
              </div>
            </details>
          </nav>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <button
            type="button"
            popoverTarget="coming-soon-notice"
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 text-xs font-medium text-muted-foreground shadow-[var(--shadow-control)] transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            <BarChart3 className="size-3.5" aria-hidden />
            <span className="hidden lg:inline">{locale === "zh" ? "分析" : "Analytics"}</span>
          </button>
          <button
            type="button"
            popoverTarget="coming-soon-notice"
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 text-xs font-medium text-muted-foreground shadow-[var(--shadow-control)] transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            <FlaskConical className="size-3.5" aria-hidden />
            <span className="hidden lg:inline">{locale === "zh" ? "评测" : "Evaluations"}</span>
          </button>
          <button
            type="button"
            popoverTarget="coming-soon-notice"
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 text-xs font-medium text-muted-foreground shadow-[var(--shadow-control)] transition-colors hover:bg-accent hover:text-foreground md:inline-flex"
          >
            <ShieldCheck className="size-3.5" aria-hidden />
            <span className="hidden xl:inline">{locale === "zh" ? "回放" : "Replay"}</span>
          </button>
          <button
            type="button"
            popoverTarget="coming-soon-notice"
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 text-xs font-medium text-muted-foreground shadow-[var(--shadow-control)] transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            <HardDrive className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{locale === "zh" ? "维护" : "Maintenance"}</span>
          </button>
          <ConsoleSettings locale={locale} path={path} />
        </div>
      </div>

      <div
        id="coming-soon-notice"
        popover="auto"
        role="status"
        aria-live="polite"
        className="fixed inset-auto right-4 top-20 m-0 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-primary/25 bg-popover p-0 text-popover-foreground shadow-[var(--shadow-panel)] backdrop:bg-black/10 sm:right-6"
      >
        <div className="relative flex items-start gap-3 p-4 pr-12">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Sparkles className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-sm font-semibold tracking-[-0.02em]">{comingSoonText}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {locale === "zh" ? "功能正在准备中，感谢关注。" : "This feature is on the way."}
            </p>
          </div>
          <button
            type="button"
            popoverTarget="coming-soon-notice"
            popoverTargetAction="hide"
            aria-label={locale === "zh" ? "关闭提示" : "Close notice"}
            className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}
