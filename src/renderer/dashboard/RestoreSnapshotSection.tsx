import React from "react";

type RestoreState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; transactionCount: number }
  | { status: "error"; message: string };

export interface RestoreSnapshotSectionProps {
  onRestoreSuccess: () => void;
}

export function RestoreSnapshotSection({
  onRestoreSuccess,
}: RestoreSnapshotSectionProps): React.JSX.Element {
  const [snapshotPath, setSnapshotPath] = React.useState("");
  const [restoreState, setRestoreState] = React.useState<RestoreState>({ status: "idle" });

  function handleRestore(e: React.FormEvent): void {
    e.preventDefault();

    setRestoreState({ status: "pending" });

    const snapshotPathPromise = snapshotPath.trim()
      ? Promise.resolve(snapshotPath.trim())
      : window.budgetApi.dialogs.chooseRestoreSnapshotPath();

    snapshotPathPromise
      .then((selectedPath) => {
        if (!selectedPath) return null;
        setSnapshotPath(selectedPath);
        if (!window.confirm("Restore this snapshot and replace the current local ledger?")) {
          return null;
        }
        return window.budgetApi.backup.restore({ snapshotPath: selectedPath });
      })
      .then((result) => {
        if (!result) {
          setRestoreState({ status: "idle" });
          return;
        }
        setRestoreState({ status: "success", transactionCount: result.transactionCount });
        setSnapshotPath("");
        onRestoreSuccess();
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Restore failed. Please try again.";
        setRestoreState({ status: "error", message });
      });
  }

  return (
    <section aria-label="Restore Snapshot">
      <h2>Restore Backup Snapshot</h2>
      <form aria-label="Restore snapshot form" onSubmit={handleRestore}>
        <label htmlFor="snapshot-path">Snapshot file path</label>
        <input
          id="snapshot-path"
          type="text"
          value={snapshotPath}
          onChange={(e) => setSnapshotPath(e.target.value)}
          disabled={restoreState.status === "pending"}
        />
        <button type="submit" aria-label="Restore snapshot" disabled={restoreState.status === "pending"}>
          {restoreState.status === "pending" ? "Restoring..." : "Browse and Restore"}
        </button>
      </form>
      {restoreState.status === "error" && (
        <p role="alert">{restoreState.message}</p>
      )}
      {restoreState.status === "success" && (
        <p role="status">
          Restore complete. {restoreState.transactionCount} transaction
          {restoreState.transactionCount !== 1 ? "s" : ""} restored.
        </p>
      )}
    </section>
  );
}
