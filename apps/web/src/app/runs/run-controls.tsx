"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, useEffect, useRef } from "react";
import { RefreshCw, Trash2, X } from "lucide-react";

import { Button } from "../components";
import { deleteRunAction } from "./actions";

export function RefreshButton({ label, refreshingLabel }: { label: string; refreshingLabel: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="default"
      size="sm"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
    >
      <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
      {isPending ? refreshingLabel : label}
    </Button>
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
  const closeRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    if (isPending) {
      return;
    }

    setOpen(false);
    setError(null);
  };

  useEffect(() => {
    if (open) {
      closeRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPending]);

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => { setError(null); setOpen(true); }}>
        <Trash2 aria-hidden className="h-3.5 w-3.5" />
        {label}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="w-full max-w-sm border border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] p-6 shadow-[var(--shadow-modal)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-sm font-semibold text-[var(--color-foreground-primary)]">{title}</h3>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                disabled={isPending}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[var(--color-foreground-tertiary)] transition-colors duration-150 hover:text-[var(--color-foreground-primary)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1"
              >
                <X aria-hidden className="h-4 w-4" />
                <span className="sr-only">{cancelLabel}</span>
              </button>
            </div>

            <p className="mt-2 text-sm text-[var(--color-foreground-secondary)]">{description}</p>

            {error ? (
              <p className="mt-3 border border-[var(--color-error-border)] bg-[var(--color-error-subtle)] px-3 py-2 text-xs text-[var(--color-error)]">
                {failedText} {error}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="default" size="sm" disabled={isPending} onClick={close}>
                {cancelLabel}
              </Button>
              <Button
                variant="danger"
                size="sm"
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
              >
                {isPending ? deletingLabel : confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
