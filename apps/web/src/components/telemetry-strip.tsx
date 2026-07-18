import type { LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";

type TelemetryTone = "default" | "trace" | "running" | "error";

export type TelemetryItem = {
  label: string;
  value: string | number;
  detail?: string;
  icon: LucideIcon;
  tone?: TelemetryTone;
};

export function TelemetryStrip({
  items,
  className
}: {
  items: TelemetryItem[];
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-[var(--shadow-panel)] lg:grid-cols-4",
        className
      )}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary via-trace to-transparent"
        aria-hidden
      />
      {items.map((item) => {
        const Icon = item.icon;
        const tone = item.tone ?? "default";

        return (
          <div
            key={item.label}
            className={cn(
              "group relative min-w-0 border-border px-3 py-3.5 sm:px-4 [&:nth-child(even)]:border-l lg:[&:not(:first-child)]:border-l",
              "[&:nth-child(n+3)]:border-t lg:[&:nth-child(n+3)]:border-t-0"
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-surface-muted text-muted-foreground transition-colors duration-150",
                  tone === "trace" && "border-trace/30 bg-trace-subtle text-trace",
                  tone === "running" &&
                    "border-status-warning-border bg-status-warning-subtle text-status-warning",
                  tone === "error" &&
                    "border-status-error-border bg-status-error-subtle text-status-error"
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {item.label}
                </p>
                <p
                  className={cn(
                    "mt-1 truncate font-sans text-xl font-semibold leading-none tracking-[-0.02em] text-foreground tabular-nums",
                    tone === "running" && "text-status-warning",
                    tone === "error" && "text-status-error"
                  )}
                >
                  {item.value}
                </p>
                {item.detail ? (
                  <p className="mt-1.5 truncate text-xs text-muted-foreground" title={item.detail}>
                    {item.detail}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
