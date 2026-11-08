import React from "react";
import type { ImportPreflightProgress } from "../../app/import/importPreflight.js";

export function useImportPreflight(format: "csv" | "pdf", contextKey: string) {
  const activeRequest = React.useRef<string | undefined>();
  const mounted = React.useRef(false);
  const [requestId, setRequestId] = React.useState<string | undefined>();
  const [progress, setProgress] = React.useState<ImportPreflightProgress | null>(null);
  const [cancellationError, setCancellationError] = React.useState<string | null>(null);

  React.useLayoutEffect(() => {
    mounted.current = true;
    const unsubscribe = window.budgetApi.import.onPreflightProgress((next) => {
      if (next.format !== format || next.requestId !== activeRequest.current) return;
      setProgress(next);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [format]);

  React.useLayoutEffect(() => {
    setRequestId(undefined);
    setProgress(null);
    setCancellationError(null);
    return () => {
      const previous = activeRequest.current;
      activeRequest.current = undefined;
      if (previous !== undefined) {
        void window.budgetApi.import.cancelPreview(previous).catch((error: unknown) => {
          console.error("Unable to cancel an obsolete import preview.", error);
        });
      }
    };
  }, [contextKey, format]);

  function begin(): string {
    const next = crypto.randomUUID();
    activeRequest.current = next;
    setRequestId(next);
    setCancellationError(null);
    setProgress({ requestId: next, format, phase: "Reading statement", completedRows: 0, totalRows: 0 });
    return next;
  }

  function isCurrent(id: string): boolean {
    return mounted.current && activeRequest.current === id;
  }

  function finish(id: string, wasCancelled: boolean): void {
    if (!isCurrent(id)) return;
    activeRequest.current = undefined;
    setRequestId(undefined);
    setCancellationError(null);
    setProgress(wasCancelled
      ? { requestId: id, format, phase: "Preview cancelled", completedRows: 0, totalRows: 0 }
      : null);
  }

  async function cancel(): Promise<void> {
    const current = activeRequest.current;
    if (current === undefined) return;
    try {
      await window.budgetApi.import.cancelPreview(current);
    } catch (error: unknown) {
      if (isCurrent(current)) {
        setCancellationError(error instanceof Error ? error.message : "Unable to cancel the preview.");
      } else {
        console.error("Unable to cancel an obsolete import preview.", error);
      }
    }
  }

  return { requestId, progress, cancellationError, begin, isCurrent, finish, cancel };
}
