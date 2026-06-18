"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
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
import { deleteRunAction, deleteRunsAction } from "./actions";

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
      type="button"
      variant="outline"
      size="sm"
      className="w-fit"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
    >
      <RefreshCw className={cn("h-3.5 w-3.5", isPending && "animate-spin")} aria-hidden />
      {isPending ? refreshingLabel : label}
    </Button>
  );
}

export function AutoRefresh({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.querySelector('input[data-run-checkbox="true"]:checked')) {
        return;
      }

      router.refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs, router]);

  return null;
}

export function SelectAllRunsCheckbox({
  formId,
  label
}: {
  formId: string;
  label: string;
}) {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const { selectedIds, totalCount } = useRunSelection(formId);
  const selectedCount = selectedIds.length;
  const allSelected = totalCount > 0 && selectedCount === totalCount;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = selectedCount > 0 && selectedCount < totalCount;
    }
  }, [selectedCount, totalCount]);

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      className="size-4 rounded border-border accent-primary"
      checked={allSelected}
      aria-label={label}
      title={label}
      onChange={(event) => {
        setRunCheckboxes(formId, event.currentTarget.checked);
      }}
    />
  );
}

export function BulkDeleteRunsButton({
  formId,
  label,
  deletingLabel,
  title,
  description,
  confirmLabel,
  cancelLabel,
  failedText,
  selectedText,
  clearSelectionLabel
}: {
  formId: string;
  label: string;
  deletingLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  failedText: string;
  selectedText: string;
  clearSelectionLabel: string;
}) {
  const router = useRouter();
  const { selectedIds } = useRunSelection(formId);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedCount = selectedIds.length;

  const close = () => {
    if (isPending) return;
    setOpen(false);
    setError(null);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {selectedCount > 0 ? (
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
            {formatSelectedCount(selectedText, selectedCount)}
          </span>
        ) : null}
        {selectedCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={isPending}
            onClick={() => setRunCheckboxes(formId, false)}
          >
            {clearSelectionLabel}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isPending || selectedCount === 0}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {label}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {formatBulkDeleteDescription(description, selectedCount)}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {failedText} {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={close}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isPending || selectedCount === 0}
              onClick={() => {
                const ids = selectedIds;

                setError(null);
                startTransition(async () => {
                  const result = await deleteRunsAction(ids);
                  if (result.ok) {
                    setRunCheckboxes(formId, false);
                    setOpen(false);
                    router.refresh();
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
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={label}
        title={label}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
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

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={close}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
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

function useRunSelection(formId: string) {
  const [selection, setSelection] = useState({ selectedIds: [] as string[], totalCount: 0 });

  useEffect(() => {
    const updateSelection = () => {
      const checkboxes = getRunCheckboxes(formId);

      setSelection({
        selectedIds: checkboxes
          .filter((checkbox) => checkbox.checked)
          .map((checkbox) => checkbox.value),
        totalCount: checkboxes.length
      });
    };

    const form = document.getElementById(formId);

    updateSelection();

    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    form.addEventListener("change", updateSelection);

    return () => {
      form.removeEventListener("change", updateSelection);
    };
  }, [formId]);

  return selection;
}

function getRunCheckboxes(formId: string) {
  const form = document.getElementById(formId);

  if (!(form instanceof HTMLFormElement)) {
    return [];
  }

  return Array.from(form.querySelectorAll<HTMLInputElement>('input[data-run-checkbox="true"]'));
}

function setRunCheckboxes(formId: string, checked: boolean) {
  for (const checkbox of getRunCheckboxes(formId)) {
    checkbox.checked = checked;
  }

  document.getElementById(formId)?.dispatchEvent(new Event("change", { bubbles: true }));
}

function formatSelectedCount(template: string, count: number) {
  return template.replace("{count}", count.toLocaleString());
}

function formatBulkDeleteDescription(template: string, count: number) {
  return template.replace("{count}", count.toLocaleString());
}
