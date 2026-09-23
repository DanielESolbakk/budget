import { dialog } from "electron";

type SaveDialogOptions = Parameters<typeof dialog.showSaveDialog>[0];
type SaveDialogResult = Awaited<ReturnType<typeof dialog.showSaveDialog>>;
type OpenDialogOptions = Parameters<typeof dialog.showOpenDialog>[0];
type OpenDialogResult = Awaited<ReturnType<typeof dialog.showOpenDialog>>;

export type CsvExportDialog = (options: SaveDialogOptions) => Promise<SaveDialogResult>;
export type RestoreSnapshotDialog = (options: OpenDialogOptions) => Promise<OpenDialogResult>;

export function createCsvExportDialog(): CsvExportDialog {
  if (
    process.env["NODE_ENV"] === "test" &&
    process.env["BUDGET_TEST_CSV_EXPORT_DIALOG"] === "cancel"
  ) {
    return async () => ({ canceled: true, filePath: "" });
  }

  return (options) => dialog.showSaveDialog(options);
}

export function createRestoreSnapshotDialog(): RestoreSnapshotDialog {
  if (
    process.env["NODE_ENV"] === "test" &&
    process.env["BUDGET_TEST_RESTORE_DIALOG"] === "cancel"
  ) {
    return async () => ({ canceled: true, filePaths: [] });
  }

  return (options) => dialog.showOpenDialog(options);
}
