import React from "react";
import type { Account } from "../../domain/types.js";
import type { ImportJobHistoryEntry, UndoImportJobResult } from "../../domain/import/importJobHistory.js";

interface ImportHistorySectionProps {
  refreshKey: number;
  onUndoSuccess: () => void;
}

function sourceFileName(sourceName: string): string {
  return sourceName.split(/[\\/]/).at(-1) || sourceName;
}

function importedLabel(count: number): string {
  return `${count} imported`;
}

function duplicateLabel(count: number): string {
  return `${count} skipped`;
}

function undoSummary(result: UndoImportJobResult): string {
  return `Removed ${result.removedCount} transaction${result.removedCount === 1 ? "" : "s"}. Retained ${result.retainedCount} changed transaction${result.retainedCount === 1 ? "" : "s"}.`;
}

export function ImportHistorySection({ refreshKey, onUndoSuccess }: ImportHistorySectionProps): React.JSX.Element {
  const [entries, setEntries] = React.useState<ImportJobHistoryEntry[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [loadState, setLoadState] = React.useState<"loading" | "ready" | "error">("loading");
  const [reloadKey, setReloadKey] = React.useState(0);
  const [pendingUndo, setPendingUndo] = React.useState<ImportJobHistoryEntry | null>(null);
  const [isUndoPending, setIsUndoPending] = React.useState(false);
  const [undoError, setUndoError] = React.useState<string | null>(null);
  const [undoResult, setUndoResult] = React.useState<UndoImportJobResult | null>(null);

  React.useEffect(() => {
    let active = true;
    setLoadState("loading");
    Promise.all([
      window.budgetApi.import.history.list(),
      window.budgetApi.accounts.getCurrent(),
    ]).then(([history, current]) => {
      if (!active) return;
      setEntries(history);
      setAccounts(current?.accounts ?? []);
      setLoadState("ready");
    }).catch(() => {
      if (active) setLoadState("error");
    });

    return () => {
      active = false;
    };
  }, [refreshKey, reloadKey]);

  async function confirmUndo(): Promise<void> {
    if (pendingUndo === null) return;
    setIsUndoPending(true);
    setUndoError(null);
    try {
      const result = await window.budgetApi.import.history.undo(pendingUndo.id);
      setUndoResult(result);
      setPendingUndo(null);
      setReloadKey((current) => current + 1);
      onUndoSuccess();
    } catch (error: unknown) {
      setUndoError(error instanceof Error ? error.message : "Unable to undo this import.");
    } finally {
      setIsUndoPending(false);
    }
  }

  return (
    <section className="import-history" aria-label="Import history" aria-busy={loadState === "loading"}>
      <h3>Import history</h3>
      {loadState === "loading" && <p role="status">Loading import history...</p>}
      {loadState === "error" && (
        <div role="alert">
          <p>Import history could not be loaded.</p>
          <button type="button" onClick={() => setReloadKey((current) => current + 1)}>Retry history</button>
        </div>
      )}
      {loadState === "ready" && entries.length === 0 && (
        <p className="empty-state">Completed imports will appear here.</p>
      )}
      {loadState === "ready" && entries.length > 0 && (
        <div className="import-history-table-wrap">
          <table className="import-history-table">
            <caption>Completed local import jobs</caption>
            <thead>
              <tr>
                <th scope="col">Completed</th>
                <th scope="col">Format</th>
                <th scope="col">Source</th>
                <th scope="col">Account</th>
                <th scope="col">Outcome</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const fileName = sourceFileName(entry.sourceName);
                const accountName = accounts.find((account) => account.id === entry.accountId)?.name ?? entry.accountId ?? "Unavailable";
                return (
                  <tr key={entry.id}>
                    <td data-label="Completed">{entry.finishedAtIso ?? entry.startedAtIso}</td>
                    <td data-label="Format">{entry.sourceType.toUpperCase()}</td>
                    <td data-label="Source" title={entry.sourceName}>{fileName}</td>
                    <td data-label="Account">{accountName}</td>
                    <td data-label="Outcome">{importedLabel(entry.importedCount)} · {duplicateLabel(entry.duplicateCount)}</td>
                    <td data-label="Action">
                      {entry.undoneAtIso !== null
                        ? `Undone · ${entry.undoRemovedCount} removed / ${entry.undoRetainedCount} kept`
                        : !entry.undoAvailable
                          ? <span title="This import predates safe undo tracking. Existing transactions were preserved.">Undo unavailable</span>
                          : (
                          <button
                            type="button"
                            className="import-secondary-action"
                            disabled={entry.importedCount === 0}
                            onClick={() => {
                              setPendingUndo(entry);
                              setUndoError(null);
                            }}
                            aria-label={`Undo import ${fileName}`}
                          >
                            Undo
                          </button>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pendingUndo !== null && (
        <div className="import-undo-confirmation" role="group" aria-label="Undo import confirmation">
          <strong>Undo {sourceFileName(pendingUndo.sourceName)}?</strong>
          <p>Only unchanged transactions from this import will be removed. Later category corrections and unrelated transactions will be kept; categorization rules are not removed.</p>
          <div>
            <button type="button" disabled={isUndoPending} onClick={() => void confirmUndo()}>Confirm undo</button>
            <button type="button" className="import-secondary-action" disabled={isUndoPending} onClick={() => setPendingUndo(null)}>Cancel</button>
          </div>
        </div>
      )}
      {undoError !== null && <p role="alert">Undo failed: {undoError}</p>}
      {undoResult !== null && <p role="status" aria-label="Import undo result">{undoSummary(undoResult)}</p>}
    </section>
  );
}