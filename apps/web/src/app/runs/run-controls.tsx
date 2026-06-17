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
  title,
  description,
  confirmLabel,
  cancelLabel,
  failedText
}: {
  runId: string;
  label: string;
  deletingLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  failedText: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const close = () => {
    if (isPending) {
      return;
    }

    setOpen(false);
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex h-7 items-center border border-red-200 bg-white px-2 text-xs font-medium text-red-700 transition hover:bg-red-50"
      >
        {label}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-sm border border-stone-200 bg-white p-5 text-left shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
            <p className="mt-2 text-sm text-stone-600">{description}</p>

            {error ? (
              <p className="mt-3 border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                {failedText}
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={close}
                className="inline-flex h-8 items-center border border-stone-200 bg-white px-3 text-xs font-medium text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await deleteRunAction(runId);

                    if (result.ok) {
                      setOpen(false);
                    } else {
                      setError(result.error ?? "");
                    }
                  });
                }}
                className="inline-flex h-8 items-center border border-red-600 bg-red-600 px-3 text-xs font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? deletingLabel : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

