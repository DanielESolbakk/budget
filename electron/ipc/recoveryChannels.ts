import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { inspectBackupSnapshot, restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { catalogBackupSnapshot, createPreRestoreBackupSnapshot } from "../../src/app/backup/snapshotCatalog.js";
import { exportLedgerCsvToFile, type ExportCsvSummary } from "../../src/app/exportCsv.js";
import type {
  BackupSnapshotCatalogEntry,
  BackupSnapshotFileOutput,
  BackupSnapshotSummary,
  RestoreSnapshotResult,
} from "../../src/domain/backup/snapshotContract.js";
import type { LedgerChannelContext } from "./context.js";
import { getLocalBackupDirectory, parseNonEmptyString, parseRestoreSnapshotInput } from "./validation.js";
export function registerRecoveryChannels({
  ipcMain,
  assertTrustedRenderer,
  localLedgerDatabase,
  runtimeState,
  importPreviewRegistry,
  ledgerOperationCoordinator,
  applyRuntimeLedgerSnapshot,
  applyRecoveryOperationTestDelay
}: Pick<LedgerChannelContext,
  | "ipcMain"
  | "assertTrustedRenderer"
  | "localLedgerDatabase"
  | "runtimeState"
  | "importPreviewRegistry"
  | "ledgerOperationCoordinator"
  | "applyRuntimeLedgerSnapshot"
  | "applyRecoveryOperationTestDelay"
>): void {

  ipcMain.handle("export:writeLedgerCsv", async (event, outputPath: unknown): Promise<ExportCsvSummary> => {
    assertTrustedRenderer(event);
    await applyRecoveryOperationTestDelay();
    const validatedOutputPath = parseNonEmptyString(outputPath, "outputPath");

    const result = exportLedgerCsvToFile({
      ledger: localLedgerDatabase,
      outputPath: validatedOutputPath,
    });

    return {
      outputPath: result.outputPath,
      rowCount: result.rowCount,
    };
  });

  ipcMain.handle(
    "backup:create",
    (event, outputPath: unknown): Promise<BackupSnapshotFileOutput> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(async () => {
        await applyRecoveryOperationTestDelay();
        const ledgerSnapshotData = localLedgerDatabase.loadLedgerSnapshotData();
        const result = createBackupSnapshot({
          ...ledgerSnapshotData,
          outputPath: parseNonEmptyString(outputPath, "outputPath"),
        });
        catalogBackupSnapshot({ snapshotPath: result.outputPath, kind: "backup" }, localLedgerDatabase);
        return result;
      });
    }
  );

  ipcMain.handle(
    "backup:inspect",
    (event, input: unknown): BackupSnapshotSummary => {
      assertTrustedRenderer(event);
      return inspectBackupSnapshot(parseRestoreSnapshotInput(input));
    }
  );

  ipcMain.handle(
    "backup:listSnapshots",
    (event): BackupSnapshotCatalogEntry[] => {
      assertTrustedRenderer(event);
      return localLedgerDatabase.listBackupSnapshots();
    }
  );

  ipcMain.handle(
    "backup:restore",
    (event, input: unknown): Promise<RestoreSnapshotResult> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(async () => {
        await applyRecoveryOperationTestDelay();
        const restoreInput = parseRestoreSnapshotInput(input);
        const restored = restoreBackupSnapshot(restoreInput);
        const recoverySnapshot = createPreRestoreBackupSnapshot({
          outputDirectory: getLocalBackupDirectory(),
          ledgerSnapshotData: localLedgerDatabase.loadLedgerSnapshotData(),
          catalog: localLedgerDatabase,
        });
        localLedgerDatabase.replaceLedgerSnapshotData(restored);
        applyRuntimeLedgerSnapshot(restored);
        runtimeState.ledgerGeneration += 1;
        importPreviewRegistry.invalidateAll();
        return { ...restored, recoverySnapshot };
      });
    }
  );
}
