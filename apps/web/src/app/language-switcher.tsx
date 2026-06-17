import Link from "next/link";

import { languageLabels, localizedHref, type Locale } from "./i18n";

export function LanguageSwitcher({ locale, path }: { locale: Locale; path: string }) {
  return (
    <div className="inline-flex border border-stone-200 bg-stone-50 p-1 text-xs">
      {(["zh", "en"] as const).map((entry) => {
        const active = entry === locale;

        return (
          <Link
            key={entry}
            className={`px-3 py-1 font-medium ${
              active ? "bg-stone-950 text-white" : "text-stone-600 hover:bg-white hover:text-stone-950"
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

