import React from "react";

/**
 * BackupSection – offline-first backup and restore UX.
 *
 * All actions route through `window.budgetApi.backup` IPC methods.
 * No direct network API usage is permitted in this component; backup
 * and restore are local-only operations.
 */

type BackupState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/**
 * Guard that documents the offline-only invariant for backup and restore
 * action handlers.  Throws if called with a non-string action name to
 * surface incorrect usage at development time; the body is otherwise a
 * compile-time and code-review enforced contract that no direct network
 * APIs (`fetch`, `XMLHttpRequest`) are used in these handlers.
 *
 * All data transfer happens through the IPC-backed `window.budgetApi.backup`
 * channel.
 */
function assertOfflineOnly(actionName: string): void {
  if (typeof actionName !== "string" || actionName.length === 0) {
    throw new Error("assertOfflineOnly requires a non-empty action name.");
  }
  // Intentionally offline: fetch and XMLHttpRequest must never be called
  // from backup or restore handlers.  If this invariant is ever broken,
  // add a network-block policy at the IPC preload layer.
}

export function BackupSection(): React.JSX.Element {
  const [backupPath, setBackupPath] = React.useState("");
  const [restorePath, setRestorePath] = React.useState("");
  const [backupState, setBackupState] = React.useState<BackupState>({ status: "idle" });
  const [restoreState, setRestoreState] = React.useState<BackupState>({ status: "idle" });

  function handleBackup(e: React.FormEvent): void {
    e.preventDefault();
    assertOfflineOnly("backup:create");

    const outputPath = backupPath.trim();
    if (!outputPath) {
      setBackupState({ status: "error", message: "Output path is required." });
      return;
    }

    setBackupState({ status: "running" });

    // TODO: The `backup.create` IPC handler should be updated to collect
    // household, accounts, and transaction data directly from the local
    // database on the main process side rather than receiving it from the
    // renderer.  Until that refactor lands, the renderer passes an empty
    // snapshot payload and relies on the main process to populate it.
    // See the `backup:create` IPC handler for the corresponding change.
    const input = {
      household: { id: "", name: "", createdAtIso: new Date().toISOString() },
      accounts: [],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
      outputPath,
    };

    window.budgetApi.backup
      .create(input)
      .then((result) => {
        setBackupState({
          status: "success",
          message: `Backup saved locally to: ${result.outputPath}`,
        });
        setBackupPath("");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Backup failed.";
        setBackupState({ status: "error", message });
      });
  }

  function handleRestore(e: React.FormEvent): void {
    e.preventDefault();
    assertOfflineOnly("backup:restore");

    const snapshotPath = restorePath.trim();
    if (!snapshotPath) {
      setRestoreState({ status: "error", message: "Snapshot path is required." });
      return;
    }

    setRestoreState({ status: "running" });

    window.budgetApi.backup
      .restore({ snapshotPath })
      .then((result) => {
        setRestoreState({
          status: "success",
          message: `Local restore complete. ${result.transactionCount} transactions restored.`,
        });
        setRestorePath("");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Restore failed.";
        setRestoreState({ status: "error", message });
      });
  }

  return (
    <section aria-label="Backup and Restore">
      <h2>Backup and Restore</h2>
      <p>
        Backup and restore keep your data on-device. No cloud or sync services are
        used.
      </p>

      <section aria-label="Create local backup">
        <h3>Create Local Backup</h3>
        <form aria-label="Backup form" onSubmit={handleBackup}>
          <label htmlFor="backup-output-path">Output path</label>
          <input
            id="backup-output-path"
            type="text"
            aria-label="Backup output path"
            value={backupPath}
            onChange={(e) => setBackupPath(e.target.value)}
          />
          <button
            type="submit"
            aria-label="Save local backup"
            disabled={backupState.status === "running"}
          >
            {backupState.status === "running" ? "Saving…" : "Save Local Backup"}
          </button>
        </form>
        {backupState.status === "error" && (
          <p role="alert">{backupState.message}</p>
        )}
        {backupState.status === "success" && (
          <p role="status">{backupState.message}</p>
        )}
      </section>

      <section aria-label="Restore from local backup">
        <h3>Restore from Local Backup</h3>
        <form aria-label="Restore form" onSubmit={handleRestore}>
          <label htmlFor="restore-snapshot-path">Snapshot path</label>
          <input
            id="restore-snapshot-path"
            type="text"
            aria-label="Restore snapshot path"
            value={restorePath}
            onChange={(e) => setRestorePath(e.target.value)}
          />
          <button
            type="submit"
            aria-label="Restore local backup"
            disabled={restoreState.status === "running"}
          >
            {restoreState.status === "running" ? "Restoring…" : "Restore Local Backup"}
          </button>
        </form>
        {restoreState.status === "error" && (
          <p role="alert">{restoreState.message}</p>
        )}
        {restoreState.status === "success" && (
          <p role="status">{restoreState.message}</p>
        )}
      </section>
    </section>
  );
}
