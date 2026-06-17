import Link from "next/link";
import { cn } from "~/lib/utils";
import { languageLabels, localizedHref, type Locale } from "~/lib/i18n";

export function LanguageSwitcher({ locale, path }: { locale: Locale; path: string }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-muted p-1 text-xs">
      {(["zh", "en"] as const).map((entry) => {
        const active = entry === locale;
        return (
          <Link
            key={entry}
            className={cn(
              "rounded-sm px-3 py-1 font-medium transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-background hover:text-foreground"
            )}
            href={localizedHref(path, entry)}
          >
            {languageLabels[entry]}
          </Link>
        );
      })}
    </div>
  );
}
