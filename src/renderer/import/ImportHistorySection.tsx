import React from "react";
import type { Account } from "../../domain/types.js";
import type {
  ImportJobHistoryEntry,
  RetainedImportTransaction,
  UndoImportJobResult,
} from "../../domain/import/importJobHistory.js";
import { classifyImportFilePath } from "../../domain/import/sourceDocument.js";

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

function sourceFormatLabel(entry: ImportJobHistoryEntry): string {
  const format = classifyImportFilePath(entry.sourceName);
  if (format === "text") return "Text";
  if (format === "pdf") return "PDF";
  if (format === "csv") return "CSV";
  return entry.sourceType.toUpperCase();
}

function parserDisplayName(adapterId: string | null): string {
  if (adapterId === null) return "Not recorded";
  const sourceName = adapterId
    .replace(/-(?:text|pdf|csv)-v\d+$/i, "")
    .replace(/-v\d+$/i, "")
    .replace(/-(?:text|pdf|csv)$/i, "");
  const words = sourceName.split(/[-_.]+/).filter(Boolean);
  return words.length === 0
    ? "Not recorded"
    : words.map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`).join(" ");
}

function formatCompletedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function retainedAmount(transaction: RetainedImportTransaction): string {
  const amount = new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(transaction.amountMinor / 100);
  return `${amount} ${transaction.currencyCode}`;
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
  const confirmationRef = React.useRef<HTMLDivElement | null>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const undoResultRef = React.useRef<HTMLDivElement | null>(null);
  const revealedUndoResultRef = React.useRef<string | null>(null);

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

  React.useEffect(() => {
    if (pendingUndo === null) return;
    confirmationRef.current?.scrollIntoView({ block: "nearest" });
    confirmButtonRef.current?.focus({ preventScroll: true });
  }, [pendingUndo]);

  React.useEffect(() => {
    if (loadState !== "ready" || undoResult === null) return;
    if (revealedUndoResultRef.current === undoResult.importJobId) return;
    // Wait for persisted history; the initial success render is replaced during reload.
    if (!entries.some((entry) => entry.id === undoResult.importJobId && entry.undoneAtIso !== null)) return;
    const result = undoResultRef.current;
    if (result === null) return;
    result.scrollIntoView({ block: "nearest" });
    result.focus({ preventScroll: true });
    revealedUndoResultRef.current = undoResult.importJobId;
  }, [entries, loadState, undoResult]);

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
                <th scope="col">Statement source</th>
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
                const completedAt = entry.finishedAtIso ?? entry.startedAtIso;
                const removedItemCount = undoResult?.importJobId === entry.id
                  ? undoResult.removedCount
                  : entry.undoRemovedCount;
                const retainedItemCount = undoResult?.importJobId === entry.id
                  ? undoResult.retainedCount
                  : entry.undoRetainedCount;
                const retainedTransactions = undoResult?.importJobId === entry.id
                  ? undoResult.retainedTransactions
                  : entry.retainedTransactions;
                return (
                  <React.Fragment key={entry.id}>
                  <tr>
                    <td data-label="Completed">
                      <time dateTime={completedAt} title={completedAt}>{formatCompletedAt(completedAt)}</time>
                    </td>
                    <td data-label="Format">{sourceFormatLabel(entry)}</td>
                    <td data-label="Statement source">
                      <span>{parserDisplayName(entry.adapterId)}</span>
                      {entry.adapterId !== null && (
                        <details className="import-history-adapter-id">
                          <summary>Adapter ID</summary>
                          <code>{entry.adapterId}</code>
                        </details>
                      )}
                    </td>
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
                              setUndoResult(null);
                            }}
                            aria-label={`Undo import ${fileName}`}
                          >
                            Undo import
                          </button>
                        )}
                    </td>
                  </tr>
                  {pendingUndo?.id === entry.id && (
                    <tr className="import-history-detail-row">
                      <td colSpan={7}>
                        <div
                          ref={confirmationRef}
                          className="import-undo-confirmation"
                          role="group"
                          aria-label="Undo import confirmation"
                          aria-describedby={`import-undo-explanation-${entry.id}`}
                        >
                          <strong>Undo {fileName}?</strong>
                          <p id={`import-undo-explanation-${entry.id}`}>
                            This removes unchanged transactions and active pending items from this import. Transactions changed after import, or transactions whose original values cannot be verified, remain in your ledger. Pending items already reconciled to booked transactions will remain linked to those transactions. Categorization rules are not removed.
                          </p>
                          {undoError !== null && <p role="alert">Undo failed: {undoError}</p>}
                          <div>
                            <button
                              ref={confirmButtonRef}
                              type="button"
                              disabled={isUndoPending}
                              onClick={() => void confirmUndo()}
                            >
                              Confirm undo
                            </button>
                            <button
                              type="button"
                              className="import-secondary-action"
                              disabled={isUndoPending}
                              onClick={() => {
                                setPendingUndo(null);
                                setUndoError(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {(undoResult?.importJobId === entry.id || entry.undoneAtIso !== null) && (
                    <tr className="import-history-detail-row">
                      <td colSpan={7}>
                        <div
                          ref={undoResult?.importJobId === entry.id ? undoResultRef : undefined}
                          className="import-undo-result"
                          role="status"
                          aria-label="Import undo result"
                          tabIndex={-1}
                        >
                          <strong>Undo complete</strong>
                          <p>
                            {removedItemCount} imported item{removedItemCount === 1 ? "" : "s"} removed.
                          </p>
                          {retainedItemCount === 0 && (
                            <p>No items from this import were retained.</p>
                          )}
                          {retainedItemCount > 0 && (
                            <>
                              <p>
                                {retainedItemCount} imported item{retainedItemCount === 1 ? "" : "s"} kept because they could not be safely removed.
                              </p>
                              {retainedTransactions.length > 0 && (
                                <details open={undoResult?.importJobId === entry.id}>
                                  <summary>
                                    View retained transactions ({retainedTransactions.length})
                                  </summary>
                                  <ul>
                                    {retainedTransactions.map((transaction) => (
                                      <li key={transaction.id}>
                                        <span>{transaction.bookedAtIso.slice(0, 10)} · {transaction.merchantRaw} · {retainedAmount(transaction)}</span>
                                        <small>
                                          {transaction.reason === "changed-after-import"
                                            ? "Changed after import; kept to protect your edits."
                                            : "Original values could not be verified; kept safely."}
                                        </small>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}