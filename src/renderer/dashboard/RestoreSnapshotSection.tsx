import React from "react";
import type {
  BackupSnapshotCatalogEntry,
  BackupSnapshotSummary,
} from "../../domain/backup/snapshotContract.js";

type RestoreState =
  | { status: "idle" }
  | { status: "choosing" }
  | { status: "inspecting" }
  | { status: "review-success" }
  | { status: "pending" }
  | { status: "cancelled" }
  | {
      status: "success";
      transactionCount: number;
      recoverySnapshot: BackupSnapshotCatalogEntry;
    }
  | { status: "undoing"; recoverySnapshot: BackupSnapshotCatalogEntry }
    | { status: "undo-error"; recoverySnapshot: BackupSnapshotCatalogEntry; message: string }
  | { status: "undo-success"; transactionCount: number }
  | { status: "error"; message: string };

interface SnapshotCatalogState {
  snapshots: BackupSnapshotCatalogEntry[];
  isLoading: boolean;
  errorMessage?: string;
}

export interface RestoreSnapshotSectionProps {
  catalogRevision: number;
  onRestoreSuccess: () => void;
}

export function RestoreSnapshotSection({
  catalogRevision,
  onRestoreSuccess,
}: RestoreSnapshotSectionProps): React.JSX.Element {
  const [snapshotPath, setSnapshotPath] = React.useState("");
  const [snapshotSummary, setSnapshotSummary] = React.useState<BackupSnapshotSummary | null>(null);
  const [catalogState, setCatalogState] = React.useState<SnapshotCatalogState>({
    snapshots: [],
    isLoading: true,
  });
  const [catalogRetryVersion, setCatalogRetryVersion] = React.useState(0);
  const [restoreState, setRestoreState] = React.useState<RestoreState>({ status: "idle" });
  const isBusy =
    restoreState.status === "choosing" ||
    restoreState.status === "inspecting" ||
    restoreState.status === "pending" ||
    restoreState.status === "undoing";

  React.useEffect(() => {
    let isCurrent = true;
    setCatalogState((current) => {
      const { errorMessage: _errorMessage, ...catalogStateWithoutError } = current;
      return { ...catalogStateWithoutError, isLoading: true };
    });

    window.budgetApi.backup.listSnapshots()
      .then((snapshots) => {
        if (isCurrent) setCatalogState({ snapshots, isLoading: false });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unable to load saved snapshots.";
        if (isCurrent) {
          setCatalogState((current) => ({ ...current, isLoading: false, errorMessage: message }));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [catalogRevision, catalogRetryVersion]);

  function handleRetryCatalog(): void {
    setCatalogRetryVersion((version) => version + 1);
  }

  async function handleChooseSnapshot(): Promise<void> {
    setRestoreState({ status: "choosing" });

    try {
      const selectedPath = await window.budgetApi.dialogs.chooseRestoreSnapshotPath();
      if (!selectedPath) {
        setRestoreState({ status: "cancelled" });
        return;
      }
      setSnapshotPath(selectedPath);
      setSnapshotSummary(null);
      setRestoreState({ status: "idle" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Restore failed. Please try again.";
      setRestoreState({ status: "error", message });
    }
  }

  async function handleReviewSnapshot(snapshotPathOverride?: string): Promise<void> {
    const selectedPath = (snapshotPathOverride ?? snapshotPath).trim();
    if (!selectedPath) return;

    setSnapshotPath(selectedPath);
    setRestoreState({ status: "inspecting" });
    setSnapshotSummary(null);

    try {
      const summary = await window.budgetApi.backup.inspect({ snapshotPath: selectedPath });
      setSnapshotSummary(summary);
      setRestoreState({ status: "review-success" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Snapshot review failed. Please try again.";
      setRestoreState({ status: "error", message });
    }
  }

  async function handleRestore(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    const selectedPath = snapshotPath.trim();
    if (!selectedPath || snapshotSummary === null) return;

    const accountCountLabel = `${snapshotSummary.accountCount} account${
      snapshotSummary.accountCount === 1 ? "" : "s"
    }`;
    const transactionCountLabel = `${snapshotSummary.transactionCount} transaction${
      snapshotSummary.transactionCount === 1 ? "" : "s"
    }`;
    const snapshotFileName = selectedPath.split(/[\\/]/).pop() || selectedPath;
    const formattedCreatedAt = new Intl.DateTimeFormat("nb-NO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(snapshotSummary.createdAtIso));
    const confirmationMessage =
      `Restoring "${snapshotSummary.householdName}" from "${snapshotFileName}" ` +
      `(created ${formattedCreatedAt}; ${accountCountLabel}; ` +
      `${transactionCountLabel}) replaces the current household data, ` +
      "accounts, transactions, budget targets, import history, and categorization rules. " +
      "A local safety copy will be saved first and can be used to undo this restore. Continue?";
    if (!window.confirm(confirmationMessage)) {
      setRestoreState({ status: "cancelled" });
      return;
    }

    setRestoreState({ status: "pending" });

    try {
      const result = await window.budgetApi.backup.restore({
        snapshotPath: selectedPath,
        expectedContentHashSha256: snapshotSummary.contentHashSha256,
      });
      setRestoreState({
        status: "success",
        transactionCount: result.transactionCount,
        recoverySnapshot: result.recoverySnapshot,
      });
      setSnapshotPath("");
      setSnapshotSummary(null);
      onRestoreSuccess();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Restore failed. Please try again.";
      setRestoreState({ status: "error", message });
    }
  }

  async function handleUndoRestore(): Promise<void> {
    const recoverySnapshot =
      restoreState.status === "success" || restoreState.status === "undo-error"
        ? restoreState.recoverySnapshot
        : null;
    if (!recoverySnapshot) return;
    const confirmationMessage =
      `Undo the restore using "${recoverySnapshot.snapshotPath}"? This restores ` +
      `${recoverySnapshot.householdName} from ${recoverySnapshot.createdAtIso} and replaces ` +
      "the current local ledger. Continue?";
    if (!window.confirm(confirmationMessage)) return;

    setRestoreState({ status: "undoing", recoverySnapshot });

    try {
      const result = await window.budgetApi.backup.restore({
        snapshotPath: recoverySnapshot.snapshotPath,
        expectedContentHashSha256: recoverySnapshot.contentHashSha256,
      });
      setRestoreState({ status: "undo-success", transactionCount: result.transactionCount });
      onRestoreSuccess();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Restore undo failed. Please try again.";
      setRestoreState({ status: "undo-error", recoverySnapshot, message });
    }
  }

  return (
    <section aria-label="Restore Snapshot">
      <h2>Restore Backup Snapshot</h2>
      <details className="snapshot-catalog">
        <summary>
          Recent snapshots ({catalogState.snapshots.length})
          {catalogState.snapshots[0] && (
            <span>
              {" "}Latest: {new Intl.DateTimeFormat("nb-NO", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(catalogState.snapshots[0].createdAtIso))}
            </span>
          )}
        </summary>
        <div role="group" aria-label="Recent snapshots">
          {catalogState.isLoading && (
            <p role="status" aria-live="polite">
              {catalogState.snapshots.length === 0 ? "Loading saved snapshots..." : "Refreshing saved snapshots..."}
            </p>
          )}
          {catalogState.errorMessage && (
            <p role="alert">Saved snapshots could not be refreshed: {catalogState.errorMessage}</p>
          )}
          <button
            type="button"
            className="action-secondary"
            onClick={handleRetryCatalog}
            disabled={catalogState.isLoading}
          >
            {catalogState.isLoading
              ? "Refreshing snapshots..."
              : catalogState.errorMessage
                ? "Retry catalog"
                : "Refresh snapshots"}
          </button>
          {!catalogState.isLoading && !catalogState.errorMessage && catalogState.snapshots.length === 0 && (
            <p className="field-help">No snapshots saved yet.</p>
          )}
          {catalogState.snapshots.length > 0 && (
            <ul className="snapshot-catalog-list">
              {catalogState.snapshots.map((snapshot) => (
                <li className="snapshot-catalog-item" key={snapshot.snapshotPath}>
                  <strong>
                    {snapshot.kind === "pre-restore" ? "Pre-restore safety copy" : "Backup"}: {snapshot.householdName}
                  </strong>
                  <p>
                    Created{" "}
                    <time dateTime={snapshot.createdAtIso}>
                      {new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(
                        new Date(snapshot.createdAtIso)
                      )}
                    </time>
                    ; {snapshot.accountCount} account{snapshot.accountCount === 1 ? "" : "s"},{" "}
                    {snapshot.transactionCount} transaction{snapshot.transactionCount === 1 ? "" : "s"}.
                  </p>
                  <code>{snapshot.snapshotPath}</code>
                  <button
                    type="button"
                    className="action-secondary"
                    onClick={() => void handleReviewSnapshot(snapshot.snapshotPath)}
                    disabled={isBusy}
                  >
                    Review for restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
      <form aria-label="Restore snapshot form" onSubmit={handleRestore}>
        <label htmlFor="snapshot-path">Snapshot file path</label>
        <input
          id="snapshot-path"
          type="text"
          value={snapshotPath}
          onChange={(event) => {
            setSnapshotPath(event.target.value);
            setSnapshotSummary(null);
            setRestoreState({ status: "idle" });
          }}
          disabled={isBusy}
        />
        <div className="action-row">
          <button
            type="button"
            className="action-secondary"
            onClick={() => void handleChooseSnapshot()}
            disabled={isBusy}
          >
            {restoreState.status === "choosing" ? "Choosing snapshot..." : "Choose snapshot"}
          </button>
          <button
            type="button"
            className="action-secondary"
            onClick={() => void handleReviewSnapshot()}
            disabled={!snapshotPath.trim() || isBusy}
          >
            {restoreState.status === "inspecting" ? "Reviewing snapshot..." : "Review snapshot"}
          </button>
          <button
            type="submit"
            aria-label="Restore snapshot"
            aria-describedby="restore-readiness-help"
            disabled={snapshotSummary === null || isBusy}
          >
            {restoreState.status === "pending" ? "Restoring snapshot..." : "Restore snapshot"}
          </button>
        </div>
      </form>
      <p id="restore-readiness-help" className="field-help">
        {snapshotSummary === null
          ? "Review a valid snapshot before restore is available."
          : "Confirm the selected snapshot and replacement scope before data changes."}
      </p>
      {snapshotSummary !== null && (
        <div className="restore-snapshot-details" role="group" aria-label="Snapshot details">
          <h3>{snapshotSummary.householdName}</h3>
          <p>
            Created{" "}
            <time dateTime={snapshotSummary.createdAtIso}>
              {new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(snapshotSummary.createdAtIso)
              )}
            </time>
          </p>
          <p>
            Format version {snapshotSummary.version}. {snapshotSummary.accountCount} account
            {snapshotSummary.accountCount === 1 ? "" : "s"}, {snapshotSummary.transactionCount} transaction
            {snapshotSummary.transactionCount === 1 ? "" : "s"}.
          </p>
        </div>
      )}
      {restoreState.status === "review-success" && (
        <p role="status" aria-live="polite">
          Snapshot verified. Review the details before restoring.
        </p>
      )}
      {restoreState.status === "choosing" && <p role="status" aria-live="polite">Choosing restore snapshot...</p>}
      {restoreState.status === "inspecting" && <p role="status" aria-live="polite">Reviewing snapshot...</p>}
      {restoreState.status === "pending" && <p role="status" aria-live="polite">Restoring snapshot...</p>}
      {restoreState.status === "undoing" && <p role="status" aria-live="polite">Undoing restore...</p>}
      {(restoreState.status === "error" || restoreState.status === "undo-error") && (
        <p role="alert">
          {restoreState.status === "undo-error" ? "Undo failed" : "Snapshot review or restore failed"}: {restoreState.message}
        </p>
      )}
      {restoreState.status === "success" && (
        <p role="status">
          Restore complete. {restoreState.transactionCount} transaction
          {restoreState.transactionCount !== 1 ? "s" : ""} restored.
          {" "}A safety copy is available at <code>{restoreState.recoverySnapshot.snapshotPath}</code>.
        </p>
      )}
      {(restoreState.status === "success" || restoreState.status === "undo-error") && (
        <button type="button" className="action-secondary" onClick={() => void handleUndoRestore()}>
          {restoreState.status === "undo-error" ? "Retry undo" : "Undo restore"}
        </button>
      )}
      {restoreState.status === "undo-success" && (
        <p role="status">
          Restore undone. {restoreState.transactionCount} transaction
          {restoreState.transactionCount === 1 ? "" : "s"} restored from the pre-restore safety copy.
        </p>
      )}
      {restoreState.status === "cancelled" && (
        <p role="status">Restore cancelled.</p>
      )}
    </section>
  );
}
