import Link from "next/link";
import { cn } from "~/lib/utils";
import { languageLabels, localizedHref, type Locale } from "~/lib/i18n";

export function LanguageSwitcher({ locale, path }: { locale: Locale; path: string }) {
  return (
    <div data-slot="language-switcher" className="inline-flex h-9 rounded-lg border border-border/70 bg-surface-muted p-0.5 text-xs shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      {(["zh", "en"] as const).map((entry) => {
        const active = entry === locale;
        return (
          <Link
            key={entry}
            className={cn(
              "inline-flex items-center rounded-md px-2.5 font-medium transition-colors duration-150",
              active
                ? "bg-surface-raised text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            href={localizedHref(path, entry)}
            aria-current={active ? "page" : undefined}
          >
            {languageLabels[entry]}
          </Link>
        );
      })}
    </div>
  );
}
