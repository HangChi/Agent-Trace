"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
  promptText,
  confirmLabel,
  cancelLabel,
  failedText
}: {
  runId: string;
  label: string;
  deletingLabel: string;
  promptText: string;
  confirmLabel: string;
  cancelLabel: string;
  failedText: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const baseButton =
    "inline-flex h-7 items-center border px-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60";

  if (confirming || isPending) {
    return (
      <div className="inline-flex flex-col items-end gap-1">
        <div className="inline-flex items-center gap-1">
          <span className="text-xs text-stone-500">{promptText}</span>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await deleteRunAction(runId);

                if (result.ok) {
                  setConfirming(false);
                } else {
                  setError(result.error ?? "");
                  setConfirming(false);
                }
              });
            }}
            className={`${baseButton} border-red-300 bg-red-600 text-white hover:bg-red-700`}
          >
            {isPending ? deletingLabel : confirmLabel}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirming(false)}
            className={`${baseButton} border-stone-200 bg-white text-stone-600 hover:bg-stone-100`}
          >
            {cancelLabel}
          </button>
        </div>
        {error ? (
          <span className="text-xs text-red-600">
            {failedText}
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className={`${baseButton} border-red-200 bg-white text-red-700 hover:bg-red-50`}
      >
        {label}
      </button>
      {error ? (
        <span className="text-xs text-red-600">
          {failedText}
          {error}
        </span>
      ) : null}
    </div>
  );
}

