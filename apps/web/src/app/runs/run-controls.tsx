"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import { deleteRunAction } from "./actions";

export function RefreshButton({
  label,
  refreshingLabel
}: {
  label: string;
  refreshingLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
    >
      <RefreshCw className={cn("h-3.5 w-3.5", isPending && "animate-spin")} aria-hidden />
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

  const close = () => {
    if (isPending) return;
    setOpen(false);
    setError(null);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {failedText} {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={isPending} onClick={close}>
              {cancelLabel}
            </Button>
            <Button
              variant="destructive"
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
        </DialogContent>
      </Dialog>
    </>
  );
}
