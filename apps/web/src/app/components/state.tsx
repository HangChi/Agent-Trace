import { copy, type Locale } from "../i18n";

export function EmptyState({
  locale,
  title,
  body
}: {
  locale: Locale;
  title: string;
  body: string;
}) {
  return (
    <div className="px-4 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-800">
        <svg
          className="h-6 w-6 text-stone-400 dark:text-stone-500"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
          />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-100">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500 dark:text-stone-400">{body}</p>
    </div>
  );
}

export function ErrorState({ message, locale }: { message: string; locale: Locale }) {
  return (
    <div className="flex items-start gap-3 border-t border-red-100 bg-red-50 px-4 py-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <svg
        className="mt-0.5 h-5 w-5 shrink-0 text-red-500 dark:text-red-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
      <div>
        <p className="font-medium">{copy[locale].common.unavailable}</p>
        <p className="mt-1 break-words font-mono text-xs text-red-700 dark:text-red-300">{message}</p>
      </div>
    </div>
  );
}
