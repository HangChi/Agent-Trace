"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { deleteRunAction } from "./actions";

export function RefreshButton({ label, refreshingLabel }: { label: string; refreshingLabel: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      className="inline-flex h-8 items-center gap-1 border border-stone-200 bg-white px-3 text-xs font-medium text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span aria-hidden className={`text-sm leading-none ${isPending ? "animate-spin" : ""}`}>
        ↻
      </span>
      {isPending ? refreshingLabel : label}
    </button>
  );
}

export function DeleteRunButton({
  runId,
  label,
  deletingLabel,
  confirmText,
  failedText
}: {
  runId: string;
  label: string;
  deletingLabel: string;
  confirmText: string;
  failedText: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => {
        if (!window.confirm(confirmText)) {
          return;
        }

        startTransition(async () => {
          const result = await deleteRunAction(runId);

          if (!result.ok) {
            window.alert(`${failedText}${result.error ?? ""}`);
          }
        });
      }}
      disabled={isPending}
      className="inline-flex items-center border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? deletingLabel : label}
    </button>
  );
}
