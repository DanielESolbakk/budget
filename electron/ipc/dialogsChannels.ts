import type { LedgerChannelContext } from "./context.js";

export function registerDialogsChannels({
  ipcMain,
  assertTrustedRenderer,
  backupOutputDialog,
  csvExportDialog,
  importStatementDialog,
  restoreSnapshotDialog
}: Pick<LedgerChannelContext,
  | "ipcMain"
  | "assertTrustedRenderer"
  | "backupOutputDialog"
  | "csvExportDialog"
  | "importStatementDialog"
  | "restoreSnapshotDialog"
>): void {

  ipcMain.handle("dialog:chooseCsvExportPath", async (event) => {
    assertTrustedRenderer(event);
    const result = await csvExportDialog({
      defaultPath: "budget-transactions.csv",
      filters: [{ name: "CSV files", extensions: ["csv"] }],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle("dialog:chooseImportStatementPath", async (event) => {
    assertTrustedRenderer(event);
    const result = await importStatementDialog({
      properties: ["openFile"],
      filters: [{ name: "Supported bank statements", extensions: ["csv", "txt", "pdf"] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:chooseBackupOutputPath", async (event) => {
    assertTrustedRenderer(event);
    const result = await backupOutputDialog({
      defaultPath: "budget-backup.json",
      filters: [{ name: "JSON files", extensions: ["json"] }],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle("dialog:chooseRestoreSnapshotPath", async (event) => {
    assertTrustedRenderer(event);
    const result = await restoreSnapshotDialog({
      properties: ["openFile"],
      filters: [{ name: "JSON files", extensions: ["json"] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}
