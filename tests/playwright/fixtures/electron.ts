import { test as base, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { AppShellPage } from "../pom/AppShellPage.js";
import { CategoryTargetPage } from "../pom/CategoryTargetPage.js";
import { CsvImportPage } from "../pom/CsvImportPage.js";
import { DashboardPage } from "../pom/DashboardPage.js";
import { DashboardTargetPage } from "../pom/DashboardTargetPage.js";
import { ForecastPage } from "../pom/ForecastPage.js";
import { ManualEntryPage } from "../pom/ManualEntryPage.js";
import { PdfImportPage } from "../pom/PdfImportPage.js";
import { PreloadBridgePage } from "../pom/PreloadBridgePage.js";
import { RecoveryPage } from "../pom/RecoveryPage.js";
import { ReviewQueuePage } from "../pom/ReviewQueuePage.js";
import { LedgerPage } from "../pom/LedgerPage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

interface ElectronFixtures {
  backupOutputDialogBehavior: "native" | "cancel" | "selected";
  csvExportDialogBehavior: "native" | "cancel" | "selected";
  importFileDialogBehavior: "native" | "cancel" | "csv-selected" | "pdf-selected";
  nodeEnvironment: "test" | "production";
  restoreSnapshotDialogBehavior: "native" | "cancel" | "selected";
  databasePath: string;
  electronApp: ElectronApplication;
  window: Page;
  appShell: AppShellPage;
  categoryTarget: CategoryTargetPage;
  csvImport: CsvImportPage;
  dashboard: DashboardPage;
  dashboardTarget: DashboardTargetPage;
  forecast: ForecastPage;
  manualEntry: ManualEntryPage;
  pdfImport: PdfImportPage;
  preloadBridge: PreloadBridgePage;
  recovery: RecoveryPage;
  reviewQueue: ReviewQueuePage;
  ledger: LedgerPage;
}

export const test = base.extend<ElectronFixtures>({
  backupOutputDialogBehavior: ["native", { option: true }],
  csvExportDialogBehavior: ["native", { option: true }],
  importFileDialogBehavior: ["native", { option: true }],
  nodeEnvironment: ["test", { option: true }],
  restoreSnapshotDialogBehavior: ["native", { option: true }],
  // eslint-disable-next-line no-empty-pattern
  databasePath: async ({}, use) => {
    const databaseDirectory = mkdtempSync(join(tmpdir(), "budget-playwright-"));
    const databasePath = join(databaseDirectory, "budget.sqlite");

    try {
      await use(databasePath);
    } finally {
      rmSync(databaseDirectory, { recursive: true, force: true });
    }
  },
  electronApp: async ({ backupOutputDialogBehavior, csvExportDialogBehavior, databasePath, importFileDialogBehavior, nodeEnvironment, restoreSnapshotDialogBehavior }, use) => {
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({
        args: [MAIN_ENTRY],
        env: {
          ...process.env,
          BUDGET_TEST_BACKUP_OUTPUT_DIALOG: backupOutputDialogBehavior,
          BUDGET_TEST_BACKUP_OUTPUT_PATH: join(dirname(databasePath), "dialog-selected-backup.json"),
          BUDGET_TEST_CSV_EXPORT_DIALOG: csvExportDialogBehavior,
          BUDGET_TEST_CSV_EXPORT_PATH: join(dirname(databasePath), "dialog-selected.csv"),
          BUDGET_TEST_IMPORT_FILE_DIALOG: importFileDialogBehavior,
          BUDGET_TEST_CSV_IMPORT_PATH: resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv"),
          BUDGET_TEST_PDF_IMPORT_PATH: resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt"),
          BUDGET_TEST_RESTORE_DIALOG: restoreSnapshotDialogBehavior,
          BUDGET_TEST_RESTORE_SNAPSHOT_PATH: join(dirname(databasePath), "dialog-selected-restore.json"),
          NODE_ENV: nodeEnvironment,
          BUDGET_DB_PATH: databasePath,
        },
      });

      await use(app);
    } finally {
      try {
        await app?.close();
      } finally {
        app = undefined;
      }
    }
  },
  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await use(window);
  },
  appShell: async ({ window }, use) => {
    await use(new AppShellPage(window));
  },
  categoryTarget: async ({ window }, use) => {
    await use(new CategoryTargetPage(window));
  },
  csvImport: async ({ appShell, window }, use) => {
    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("CSV statement");
    await use(new CsvImportPage(window));
  },
  dashboard: async ({ window }, use) => {
    await use(new DashboardPage(window));
  },
  dashboardTarget: async ({ window }, use) => {
    await use(new DashboardTargetPage(window));
  },
  forecast: async ({ window }, use) => {
    await use(new ForecastPage(window));
  },
  manualEntry: async ({ appShell, window }, use) => {
    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("Manual transaction");
    await use(new ManualEntryPage(window));
  },
  pdfImport: async ({ appShell, window }, use) => {
    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("Digital PDF");
    await use(new PdfImportPage(window));
  },
  preloadBridge: async ({ window }, use) => {
    await use(new PreloadBridgePage(window));
  },
  recovery: async ({ appShell, window }, use) => {
    await appShell.openWorkspace("Data safety");
    await use(new RecoveryPage(window));
  },
  reviewQueue: async ({ appShell, window }, use) => {
    await appShell.openWorkspace("Transactions");
    await use(new ReviewQueuePage(window));
  },
  ledger: async ({ appShell, window }, use) => {
    await appShell.openWorkspace("Transactions");
    await use(new LedgerPage(window));
  },
});

export { expect };
