import { dialog } from "electron";

type SaveDialogOptions = Parameters<typeof dialog.showSaveDialog>[0];
type SaveDialogResult = Awaited<ReturnType<typeof dialog.showSaveDialog>>;
type OpenDialogOptions = Parameters<typeof dialog.showOpenDialog>[0];
type OpenDialogResult = Awaited<ReturnType<typeof dialog.showOpenDialog>>;

export type CsvExportDialog = (options: SaveDialogOptions) => Promise<SaveDialogResult>;
export type BackupOutputDialog = (options: SaveDialogOptions) => Promise<SaveDialogResult>;
export type RestoreSnapshotDialog = (options: OpenDialogOptions) => Promise<OpenDialogResult>;
export type ImportStatementDialog = (options: OpenDialogOptions) => Promise<OpenDialogResult>;
export type ExchangeRateImportDialog = (options: OpenDialogOptions) => Promise<OpenDialogResult>;

export function createExchangeRateImportDialog(): ExchangeRateImportDialog {
  return async (options) => {
    if (process.env["NODE_ENV"] === "test") {
      if (process.env["BUDGET_TEST_EXCHANGE_RATE_IMPORT_DIALOG"] === "cancel") {
        return { canceled: true, filePaths: [] };
      }
      const selectedPath = process.env["BUDGET_TEST_EXCHANGE_RATE_IMPORT_PATH"];
      if (selectedPath !== undefined) {
        if (selectedPath.trim().length === 0) {
          throw new Error("A test exchange-rate import path must be non-empty.");
        }
        return { canceled: false, filePaths: [selectedPath] };
      }
    }
    return dialog.showOpenDialog(options);
  };
}

export function createImportStatementDialog(): ImportStatementDialog {
  return async (options) => {
    if (process.env["NODE_ENV"] === "test") {
      const behavior = process.env["BUDGET_TEST_IMPORT_FILE_DIALOG"];
      if (behavior === "cancel") {
        return { canceled: true, filePaths: [] };
      }

      const selectedPathEnvironment = behavior === "csv-selected"
        ? "BUDGET_TEST_CSV_IMPORT_PATH"
        : behavior === "pdf-selected"
          ? "BUDGET_TEST_PDF_IMPORT_PATH"
          : behavior === "text-selected"
            ? "BUDGET_TEST_TEXT_IMPORT_PATH"
            : undefined;
      if (selectedPathEnvironment !== undefined) {
        const selectedPath = process.env[selectedPathEnvironment];
        if (typeof selectedPath !== "string" || selectedPath.trim().length === 0) {
          throw new Error(`A test import path is required for ${behavior} dialog behavior.`);
        }
        return { canceled: false, filePaths: [selectedPath] };
      }
    }

    return dialog.showOpenDialog(options);
  };
}

export function createCsvExportDialog(): CsvExportDialog {
  if (process.env["NODE_ENV"] === "test") {
    const behavior = process.env["BUDGET_TEST_CSV_EXPORT_DIALOG"];

    if (behavior === "cancel") {
      return async () => ({ canceled: true, filePath: "" });
    }

    if (behavior === "selected") {
      const selectedPath = process.env["BUDGET_TEST_CSV_EXPORT_PATH"];
      if (typeof selectedPath !== "string" || selectedPath.trim().length === 0) {
        throw new Error("A test CSV export path is required for selected dialog behavior.");
      }
      return async () => ({ canceled: false, filePath: selectedPath });
    }
  }

  return (options) => dialog.showSaveDialog(options);
}

export function createBackupOutputDialog(): BackupOutputDialog {
  if (process.env["NODE_ENV"] === "test") {
    const behavior = process.env["BUDGET_TEST_BACKUP_OUTPUT_DIALOG"];

    if (behavior === "cancel") {
      return async () => ({ canceled: true, filePath: "" });
    }

    if (behavior === "selected") {
      const selectedPath = process.env["BUDGET_TEST_BACKUP_OUTPUT_PATH"];
      if (typeof selectedPath !== "string" || selectedPath.trim().length === 0) {
        throw new Error("A test backup output path is required for selected dialog behavior.");
      }
      return async () => ({ canceled: false, filePath: selectedPath });
    }
  }

  return (options) => dialog.showSaveDialog(options);
}

export function createRestoreSnapshotDialog(): RestoreSnapshotDialog {
  if (process.env["NODE_ENV"] === "test") {
    const behavior = process.env["BUDGET_TEST_RESTORE_DIALOG"];

    if (behavior === "cancel") {
      return async () => ({ canceled: true, filePaths: [] });
    }

    if (behavior === "selected") {
      const selectedPath = process.env["BUDGET_TEST_RESTORE_SNAPSHOT_PATH"];
      if (typeof selectedPath !== "string" || selectedPath.trim().length === 0) {
        throw new Error("A test restore snapshot path is required for selected dialog behavior.");
      }
      return async () => ({ canceled: false, filePaths: [selectedPath] });
    }
  }

  return (options) => dialog.showOpenDialog(options);
}
