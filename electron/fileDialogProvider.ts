import { dialog } from "electron";

type SaveDialogOptions = Parameters<typeof dialog.showSaveDialog>[0];
type SaveDialogResult = Awaited<ReturnType<typeof dialog.showSaveDialog>>;

export type CsvExportDialog = (options: SaveDialogOptions) => Promise<SaveDialogResult>;

export function createCsvExportDialog(): CsvExportDialog {
  if (
    process.env["NODE_ENV"] === "test" &&
    process.env["BUDGET_TEST_CSV_EXPORT_DIALOG"] === "cancel"
  ) {
    return async () => ({ canceled: true, filePath: "" });
  }

  return (options) => dialog.showSaveDialog(options);
}
