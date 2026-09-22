import React from "react";

type BackupState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; outputPath: string; transactionCount: number }
  | { status: "error"; message: string };

export function BackupSection(): React.JSX.Element {
  const [outputPath, setOutputPath] = React.useState("");
  const [backupState, setBackupState] = React.useState<BackupState>({ status: "idle" });

  function handleCreateBackup(): void {
    setBackupState({ status: "pending" });

    const outputPathPromise = outputPath.trim()
      ? Promise.resolve(outputPath.trim())
      : window.budgetApi.dialogs.chooseBackupOutputPath();

    outputPathPromise
      .then((selectedPath) => {
        if (!selectedPath) {
          setBackupState({ status: "idle" });
          return null;
        }
        setOutputPath(selectedPath);
        return window.budgetApi.backup.create(selectedPath);
      })
      .then((result) => {
        if (!result) return;
        setBackupState({
          status: "success",
          outputPath: result.outputPath,
          transactionCount: result.transactionCount,
        });
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unknown backup error.";
        setBackupState({ status: "error", message });
      });
  }

  return (
    <section aria-label="Backup">
      <h2>Backup</h2>
      <label htmlFor="backup-output-path">Output path</label>
      <input
        id="backup-output-path"
        type="text"
        value={outputPath}
        onChange={(e) => setOutputPath(e.target.value)}
        placeholder="Choose a JSON destination"
        disabled={backupState.status === "pending"}
      />
      <button
        type="button"
        onClick={handleCreateBackup}
        disabled={backupState.status === "pending"}
      >
        Browse and Create Backup
      </button>
      {backupState.status === "pending" && <p>Creating backup...</p>}
      {backupState.status === "success" && (
        <p role="status">
          Backup saved to {backupState.outputPath} ({backupState.transactionCount} transactions).
        </p>
      )}
      {backupState.status === "error" && (
        <p role="alert">Backup failed: {backupState.message}</p>
      )}
    </section>
  );
}
