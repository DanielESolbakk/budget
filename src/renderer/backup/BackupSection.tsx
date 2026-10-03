import React from "react";

type BackupState =
  | { status: "idle" }
  | { status: "choosing" }
  | { status: "pending" }
  | { status: "cancelled" }
  | {
      status: "success";
      outputPath: string;
      accountCount: number;
      transactionCount: number;
      createdAtIso: string;
    }
  | { status: "error"; message: string };

export interface BackupSectionProps {
  onBackupSuccess: () => void;
}

export function BackupSection({ onBackupSuccess }: BackupSectionProps): React.JSX.Element {
  const [outputPath, setOutputPath] = React.useState("");
  const [backupState, setBackupState] = React.useState<BackupState>({ status: "idle" });

  async function handleChooseDestination(): Promise<void> {
    setBackupState({ status: "choosing" });

    try {
      const selectedPath = await window.budgetApi.dialogs.chooseBackupOutputPath();
      if (!selectedPath) {
        setBackupState({ status: "cancelled" });
        return;
      }
      setOutputPath(selectedPath);
      setBackupState({ status: "idle" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown backup error.";
      setBackupState({ status: "error", message });
    }
  }

  async function handleCreateBackup(): Promise<void> {
    const selectedPath = outputPath.trim();
    if (!selectedPath) return;

    setBackupState({ status: "pending" });

    try {
      const result = await window.budgetApi.backup.create(selectedPath);
      setBackupState({
        status: "success",
        outputPath: result.outputPath,
        accountCount: result.accountCount,
        transactionCount: result.transactionCount,
        createdAtIso: result.createdAtIso,
      });
      onBackupSuccess();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown backup error.";
      setBackupState({ status: "error", message });
    }
  }

  return (
    <section aria-label="Backup">
      <h2>Backup</h2>
      <label htmlFor="backup-output-path">Destination path</label>
      <input
        id="backup-output-path"
        type="text"
        value={outputPath}
        onChange={(e) => {
          setOutputPath(e.target.value);
          setBackupState({ status: "idle" });
        }}
        placeholder="Choose a JSON destination"
        disabled={backupState.status === "choosing" || backupState.status === "pending"}
      />
      <p id="backup-output-help" className="field-help">
        Choose or enter a destination before creating the snapshot.
      </p>
      <div className="action-row">
        <button
          type="button"
          className="action-secondary"
          onClick={() => void handleChooseDestination()}
          disabled={backupState.status === "choosing" || backupState.status === "pending"}
        >
          {backupState.status === "choosing" ? "Choosing destination..." : "Choose destination"}
        </button>
        <button
          type="button"
          onClick={() => void handleCreateBackup()}
          disabled={!outputPath.trim() || backupState.status === "choosing" || backupState.status === "pending"}
          aria-describedby="backup-output-help"
        >
          {backupState.status === "pending" ? "Creating backup..." : "Create backup"}
        </button>
      </div>
      {backupState.status === "choosing" && <p role="status" aria-live="polite">Choosing backup destination...</p>}
      {backupState.status === "pending" && <p role="status" aria-live="polite">Creating backup...</p>}
      {backupState.status === "cancelled" && <p role="status">No destination selected. Backup was not created.</p>}
      {backupState.status === "success" && (
        <p role="status">
          Backup saved to {backupState.outputPath}. Created{" "}
          <time dateTime={backupState.createdAtIso}>
            {new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(backupState.createdAtIso)
            )}
          </time>
          ; {backupState.accountCount} account{backupState.accountCount === 1 ? "" : "s"},{" "}
          {backupState.transactionCount} transaction{backupState.transactionCount === 1 ? "" : "s"}.
        </p>
      )}
      {backupState.status === "error" && (
        <p role="alert">Backup failed: {backupState.message}</p>
      )}
    </section>
  );
}
