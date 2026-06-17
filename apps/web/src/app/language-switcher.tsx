import Link from "next/link";

import { languageLabels, localizedHref, type Locale } from "./i18n";

export function LanguageSwitcher({ locale, path }: { locale: Locale; path: string }) {
  return (
    <div className="inline-flex border border-[var(--color-border-primary)] bg-[var(--color-surface-secondary)] p-1 text-xs transition-colors duration-300">
      {(["zh", "en"] as const).map((entry) => {
        const active = entry === locale;

        return (
          <Link
            key={entry}
            className={`px-3 py-1 font-medium transition-colors duration-150 ${
              active
                ? "bg-[var(--color-foreground-primary)] text-[var(--color-foreground-inverse)]"
                : "text-[var(--color-foreground-secondary)] hover:bg-[var(--color-surface-primary)] hover:text-[var(--color-foreground-primary)]"
            }`}
            href={localizedHref(path, entry)}
          >
            {languageLabels[entry]}
          </Link>
        );
      })}
    </div>
  );
}
