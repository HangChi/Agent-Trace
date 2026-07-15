"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { GitCompareArrows, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import {
  autoRefreshChangedEvent,
  autoRefreshStorageKey,
  readAutoRefreshPreference
} from "~/lib/browser-preferences";
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

export function AutoRefresh({ collectorUrl }: { collectorUrl: string }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const syncPreference = () => setEnabled(readAutoRefreshPreference());
    const syncStoredPreference = (event: StorageEvent) => {
      if (event.key === autoRefreshStorageKey) {
        syncPreference();
      }
    };

    syncPreference();
    window.addEventListener(autoRefreshChangedEvent, syncPreference);
    window.addEventListener("storage", syncStoredPreference);

    return () => {
      window.removeEventListener(autoRefreshChangedEvent, syncPreference);
      window.removeEventListener("storage", syncStoredPreference);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let fallbackTimer: number | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector('input[data-run-checkbox="true"]:checked')) {
        return;
      }

      router.refresh();
    };
    const startFallback = () => {
      fallbackTimer ??= window.setInterval(refresh, 15_000);
    };
    const stopFallback = () => {
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    };
    const source = new EventSource(`${collectorUrl}/changes`);

    source.addEventListener("change", refresh);
    source.addEventListener("open", stopFallback);
    source.addEventListener("error", startFallback);

    return () => {
      source.close();
      stopFallback();
    };
  }, [collectorUrl, enabled, router]);

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
    <label className="-ml-2 inline-flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-accent/60 md:size-9">
      <input
        ref={checkboxRef}
        type="checkbox"
        className="size-4 cursor-pointer rounded border-border accent-primary"
        checked={allSelected}
        aria-label={label}
        title={label}
        onChange={(event) => {
          setRunCheckboxes(formId, event.currentTarget.checked);
        }}
      />
    </label>
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
          <span className="rounded-md border border-border/80 bg-surface-muted px-2 py-1 text-xs text-muted-foreground">
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
            <p className="rounded-md border border-status-error-border bg-status-error-subtle px-3 py-2 text-xs text-status-error">
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

export function CompareRunsButton({
  formId,
  label,
  locale
}: {
  formId: string;
  label: string;
  locale: "zh" | "en";
}) {
  const router = useRouter();
  const { selectedIds } = useRunSelection(formId);
  const canCompare = selectedIds.length >= 2 && selectedIds.length <= 5;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!canCompare}
      title={locale === "zh" ? "请选择 2–5 个 Run" : "Select 2–5 runs"}
      onClick={() => {
        const params = new URLSearchParams({ ids: selectedIds.join(",") });
        if (locale === "en") params.set("lang", "en");
        router.push(`/runs/compare?${params}`);
      }}
    >
      <GitCompareArrows className="h-3.5 w-3.5" aria-hidden />
      {label}
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
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-8 rounded-md border border-border/70 bg-surface-raised text-muted-foreground shadow-xs hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
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
            <p className="rounded-md border border-status-error-border bg-status-error-subtle px-3 py-2 text-xs text-status-error">
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
