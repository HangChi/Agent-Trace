"use client";

import Link from "next/link";
import {
  Check,
  Languages,
  Monitor,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
  type LucideIcon
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "~/components/ui/dialog";
import {
  readAutoRefreshPreference,
  writeAutoRefreshPreference
} from "~/lib/browser-preferences";
import { copy, languageLabels, localizedHref, type Locale } from "~/lib/i18n";
import { cn } from "~/lib/utils";

export function ConsoleSettings({ locale, path }: { locale: Locale; path: string }) {
  const text = copy[locale].common;
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    setMounted(true);
    setAutoRefresh(readAutoRefreshPreference());
  }, []);

  const themes = [
    { value: "system", label: text.themeSystem, icon: Monitor },
    { value: "light", label: text.themeLightLabel, icon: Sun },
    { value: "dark", label: text.themeDarkLabel, icon: Moon }
  ];

  function updateAutoRefresh(enabled: boolean) {
    setAutoRefresh(enabled);
    writeAutoRefreshPreference(enabled);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="px-2.5 text-muted-foreground hover:text-foreground"
          aria-label={text.settings}
          title={text.settings}
        >
          <Settings2 className="size-3.5" />
          <span className="hidden sm:inline">{text.settings}</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="relative border-b border-border bg-surface-muted/55 px-6 py-5 pr-12">
          <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />
          <DialogTitle className="tracking-[-0.025em]">{text.settings}</DialogTitle>
          <DialogDescription>{text.settingsDescription}</DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border">
          <SettingsRow
            icon={Sun}
            title={text.appearance}
            description={text.appearanceDescription}
          >
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-muted p-1">
              {themes.map((option) => {
                const Icon = option.icon;
                const selected = mounted && theme === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={!mounted}
                    aria-pressed={selected}
                    className={cn(
                      "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors",
                      "hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                      selected && "bg-surface-raised text-primary shadow-[var(--shadow-control)]"
                    )}
                    onClick={() => setTheme(option.value)}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </SettingsRow>

          <SettingsRow
            icon={Languages}
            title={text.language}
            description={text.languageDescription}
          >
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-muted p-1">
              {(["zh", "en"] as const).map((entry) => {
                const selected = entry === locale;

                return (
                  <Link
                    key={entry}
                    href={localizedHref(path, entry)}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors",
                      "hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      selected && "bg-surface-raised text-primary shadow-[var(--shadow-control)]"
                    )}
                    aria-current={selected ? "page" : undefined}
                  >
                    {languageLabels[entry]}
                    {selected ? <Check className="size-3.5" aria-hidden /> : null}
                  </Link>
                );
              })}
            </div>
          </SettingsRow>

          <SettingsRow
            icon={RefreshCw}
            title={text.liveRefresh}
            description={text.liveRefreshDescription}
          >
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-muted p-1">
              {[
                { value: true, label: text.liveRefreshOn },
                { value: false, label: text.liveRefreshOff }
              ].map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  aria-pressed={autoRefresh === option.value}
                  className={cn(
                    "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors",
                    "hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    autoRefresh === option.value && "bg-surface-raised text-primary shadow-[var(--shadow-control)]"
                  )}
                  onClick={() => updateAutoRefresh(option.value)}
                >
                  {option.label}
                  {autoRefresh === option.value ? <Check className="size-3.5" aria-hidden /> : null}
                </button>
              ))}
            </div>
          </SettingsRow>
        </div>

        <p className="border-t border-border bg-surface-muted px-6 py-3 font-mono text-[11px] text-muted-foreground">
          {text.settingsLocalNote}
        </p>
      </DialogContent>
    </Dialog>
  );
}

function SettingsRow({
  icon: Icon,
  title,
  description,
  children
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 px-6 py-5 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
      <div className="flex min-w-0 gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-accent text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
