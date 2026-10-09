import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { _electron as electron } from "@playwright/test";
import { test, expect } from "./fixtures/electron.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { RecoveryPage } from "./pom/RecoveryPage.js";
import { buildBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import type { BackupSnapshot } from "../../src/domain/backup/snapshotContract.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

const LEDGER_READ_SEED = {
  household: {
    id: "ledger-read-hh",
    name: "Ledger Read Household",
    createdAtIso: "2026-01-01T00:00:00Z",
  },
  accounts: [
    {
      id: "ledger-read-acc",
      householdId: "ledger-read-hh",
      name: "Ledger Read Account",
      currencyCode: "NOK" as const,
    },
  ],
  transactions: [],
  importJobs: [],
  monthlyCategoryTargets: [],
};

function loadPersistedSnapshot(dbPath: string) {
  const ledger = createLocalLedgerDatabase({ dbPath, seedData: LEDGER_READ_SEED });

  try {
    return ledger.loadLedgerSnapshotData();
  } finally {
    ledger.close();
  }
}

test.describe("Recovery and portability renderer workflows", () => {
  test.describe("backup save-dialog selected result", () => {
    test.use({ backupOutputDialogBehavior: "selected" });

    test("choosing a backup destination does not create it before explicit confirmation", async ({
      recovery,
      databasePath,
    }) => {
      const outputPath = join(dirname(databasePath), "dialog-selected-backup.json");

      expect(existsSync(outputPath)).toBe(false);
      await recovery.backupBrowseButton.click();
      await expect(recovery.backupPathInput).toHaveValue(outputPath);
      expect(existsSync(outputPath)).toBe(false);

      await recovery.backupCreateButton.click();
      await expect(recovery.backupSuccess).toContainText(outputPath);
      expect(existsSync(outputPath)).toBe(true);
    });
  });

  test.describe("backup save-dialog cancellation result", () => {
    test.use({ backupOutputDialogBehavior: "cancel" });

    test("reports cancellation without creating a snapshot", async ({ recovery, databasePath }) => {
      const outputPath = join(dirname(databasePath), "cancelled-backup.json");

      expect(existsSync(outputPath)).toBe(false);
      await recovery.backupBrowseButton.click();
      await expect(recovery.backupCancelled).toBeVisible();
      await expect(recovery.backupSuccess).not.toBeVisible();
      expect(existsSync(outputPath)).toBe(false);
    });
  });

  test("exports the complete local ledger through the visible UI", async ({ recovery }) => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-export-runtime-"));
    const outputPath = join(tempDir, "transactions.csv");

    try {
      await expect(recovery.exportSection).toBeVisible();
      await recovery.exportPathInput.fill(outputPath);
      await recovery.exportButton.click();

      await expect(recovery.exportSuccess).toContainText(
        `Export saved to ${outputPath} (4 transactions).`
      );
      const exportedCsv = readFileSync(outputPath, "utf8");
      const exportedRows = exportedCsv.trimEnd().split(/\r?\n/);
      expect(exportedRows[0]).toBe(
        "id,householdId,accountId,bookedAtIso,amountMinor,merchantRaw,merchantAlias,sourceReference,categoryId,importJobId"
      );
      expect(exportedRows).toHaveLength(5);
      for (const transactionId of ["sample-tx-1", "sample-tx-2", "sample-tx-3", "sample-tx-4"]) {
        expect(exportedRows.some((row) => row.startsWith(`${transactionId},`))).toBe(true);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("requires a destination before exporting the ledger", async ({ recovery }) => {
    await expect(recovery.exportButton).toBeDisabled();
    await expect(
      recovery.exportSection.getByText("Choose or enter a destination before exporting.", {
        exact: true,
      })
    ).toBeVisible();
  });

  test("announces backup progress and prevents a duplicate save while pending", async ({ recovery, databasePath, electronApp }) => {
    const outputPath = join(dirname(databasePath), "pending-backup.json");
    await recovery.backupPathInput.fill(outputPath);
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_RECOVERY_OPERATION_DELAY_MS"] = "300";
    });
    await recovery.backupCreateButton.click();

    const pendingStatus = recovery.backupSection.getByRole("status").filter({ hasText: "Creating backup..." });
    await expect(pendingStatus).toBeVisible();
    await expect(recovery.backupSection.getByRole("button", { name: "Creating backup...", exact: true })).toBeDisabled();
    await expect(recovery.backupSuccess).toContainText(outputPath);
    expect(existsSync(outputPath)).toBe(true);
  });

  test("announces export progress and prevents a duplicate export while pending", async ({ recovery, databasePath, electronApp }) => {
    const outputPath = join(dirname(databasePath), "pending-export.csv");
    await recovery.exportPathInput.fill(outputPath);
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_RECOVERY_OPERATION_DELAY_MS"] = "300";
    });
    await recovery.exportButton.click();

    const pendingStatus = recovery.exportSection.getByRole("status").filter({ hasText: "Exporting ledger..." });
    await expect(pendingStatus).toBeVisible();
    await expect(recovery.exportSection.getByRole("button", { name: "Exporting...", exact: true })).toBeDisabled();
    await expect(recovery.exportSuccess).toContainText(outputPath);
    expect(existsSync(outputPath)).toBe(true);
  });

  test("announces restore progress and prevents a duplicate restore while pending", async ({ recovery, databasePath, electronApp, window }) => {
    const snapshotPath = join(dirname(databasePath), "pending-restore.json");
    const snapshot = buildBackupSnapshot({
      household: {
        id: "pending-restore-household",
        name: "Pending Restore Household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [
        {
          id: "pending-restore-account",
          householdId: "pending-restore-household",
          name: "Everyday account",
          currencyCode: "NOK",
        },
      ],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
      createdAtIso: "2026-09-30T12:15:00.000Z",
    });
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
    await recovery.restorePathInput.fill(snapshotPath);
    await recovery.reviewSnapshotButton.click();
    await expect(recovery.snapshotReviewSuccess).toBeVisible();
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_RECOVERY_OPERATION_DELAY_MS"] = "300";
    });
    window.once("dialog", async (dialog) => await dialog.accept());
    await recovery.restoreButton.click();

    const pendingStatus = recovery.restoreSection.getByRole("status").filter({ hasText: "Restoring snapshot..." });
    await expect(pendingStatus).toBeVisible();
    await expect(recovery.restoreButton).toBeDisabled();
    await expect(recovery.restoreSuccess).toContainText("Restore complete.");
  });

  test("Recent snapshots disclosure meets the compact touch target size", async ({ electronApp, recovery }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });
    await expect(recovery.recentSnapshotsSummary).toBeVisible();

    const target = await recovery.recentSnapshotsSummary.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
  });

  test("@visual Recent snapshots retains its visible disclosure cue in compact view", async ({ electronApp, recovery }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });
    await expect(recovery.recentSnapshotsSummary).toBeVisible();
    await expect(recovery.recentSnapshotsSummary).toHaveScreenshot("recent-snapshots-disclosure-compact.png", {
      animations: "disabled",
      maxDiffPixelRatio: process.platform === "linux" ? 0.03 : 0.01,
    });
  });

  test("reports backup creation time and snapshot counts after saving", async ({
    recovery,
    databasePath,
  }) => {
    const outputPath = join(dirname(databasePath), "backup-summary.json");

    await recovery.backupPathInput.fill(outputPath);
    await recovery.backupCreateButton.click();
    await expect(recovery.backupSuccess).toContainText(outputPath);

    const snapshot = JSON.parse(readFileSync(outputPath, "utf8")) as BackupSnapshot;
    await expect(recovery.backupCreatedTime).toHaveAttribute(
      "datetime",
      snapshot.metadata.createdAtIso
    );
    await expect(recovery.backupCreatedTime).not.toBeEmpty();
    await expect(recovery.backupSuccess).toContainText("1 account");
    await expect(recovery.backupSuccess).toContainText("4 transactions");
  });

  test("keeps saved snapshots in the restore catalog after restarting the app", async ({
    recovery,
    electronApp,
    databasePath,
  }) => {
    const outputPath = join(dirname(databasePath), "catalog-survives-restart.json");

    await recovery.backupPathInput.fill(outputPath);
    await recovery.backupCreateButton.click();
    await expect(recovery.backupSuccess).toContainText(outputPath);
    await recovery.recentSnapshotsSummary.click();
    await expect(recovery.recentSnapshots).toContainText(outputPath);
    const savedSnapshot = JSON.parse(readFileSync(outputPath, "utf8")) as BackupSnapshot;
    const expectedLatestDate = new Intl.DateTimeFormat("nb-NO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(savedSnapshot.metadata.createdAtIso));
    await expect(recovery.recentSnapshotsSummary).toContainText(expectedLatestDate);

    await electronApp.close();
    const restartedApp = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BUDGET_DB_PATH: databasePath,
      },
    });

    try {
      const restartedWindow = await restartedApp.firstWindow();
      await restartedWindow.waitForLoadState("domcontentloaded");
      await new AppShellPage(restartedWindow).openWorkspace("Data safety");
      const restartedRecovery = new RecoveryPage(restartedWindow);

      await restartedRecovery.recentSnapshotsSummary.click();
      await expect(restartedRecovery.recentSnapshots).toContainText(outputPath);
      await expect(restartedRecovery.recentSnapshots).toContainText("4 transactions");
      await expect(restartedRecovery.recentSnapshotsSummary).toContainText(expectedLatestDate);
      await restartedRecovery.reviewCatalogSnapshotButton(outputPath).click();
      await expect(restartedRecovery.snapshotDetails).toContainText("Sample Household");
      await expect(restartedRecovery.snapshotReviewSuccess).toHaveText(
        "Snapshot verified. Review the details before restoring."
      );
    } finally {
      await restartedApp.close();
    }
  });

  test("orders multiple snapshots by recency and reviews the selected catalog row", async ({
    recovery,
    databasePath,
  }) => {
    const olderPath = join(dirname(databasePath), "older-catalog-snapshot.json");
    const newerPath = join(dirname(databasePath), "newer-catalog-snapshot.json");
    const snapshots = [
      {
        path: olderPath,
        savedAtIso: "2025-09-02T12:00:00.000Z",
        snapshot: buildBackupSnapshot({
          household: {
            id: "older-catalog-household",
            name: "Older Catalog Household",
            createdAtIso: "2025-01-01T00:00:00Z",
          },
          accounts: [{
            id: "older-catalog-account",
            householdId: "older-catalog-household",
            name: "Older account",
            currencyCode: "NOK",
          }],
          transactions: [],
          importJobs: [],
          monthlyCategoryTargets: [],
          createdAtIso: "2025-09-01T12:00:00.000Z",
        }),
      },
      {
        path: newerPath,
        savedAtIso: "2026-10-02T12:00:00.000Z",
        snapshot: buildBackupSnapshot({
          household: {
            id: "newer-catalog-household",
            name: "Newer Catalog Household",
            createdAtIso: "2026-01-01T00:00:00Z",
          },
          accounts: [{
            id: "newer-catalog-account",
            householdId: "newer-catalog-household",
            name: "Newer account",
            currencyCode: "NOK",
          }],
          transactions: [],
          importJobs: [],
          monthlyCategoryTargets: [],
          createdAtIso: "2026-10-02T12:00:00.000Z",
        }),
      },
    ];

    const database = new DatabaseSync(databasePath);
    try {
      const insertCatalogEntry = database.prepare(`
        INSERT INTO backup_snapshots (
          snapshot_path, kind, version, household_name, created_at_iso, saved_at_iso,
          account_count, transaction_count, content_hash_sha256
        ) VALUES (?, 'backup', ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const { path, savedAtIso, snapshot } of snapshots) {
        const contents = JSON.stringify(snapshot);
        writeFileSync(path, contents, "utf8");
        insertCatalogEntry.run(
          path,
          snapshot.metadata.version,
          snapshot.household.name,
          snapshot.metadata.createdAtIso,
          savedAtIso,
          snapshot.metadata.accountCount,
          snapshot.metadata.transactionCount,
          createHash("sha256").update(contents).digest("hex")
        );
      }
    } finally {
      database.close();
    }

    await recovery.recentSnapshotsSummary.click();
    await recovery.refreshCatalogButton.click();

    const snapshotRows = recovery.recentSnapshots.getByRole("listitem");
    await expect(snapshotRows).toHaveCount(2);
    await expect(snapshotRows.nth(0)).toContainText("Newer Catalog Household");
    await expect(snapshotRows.nth(1)).toContainText("Older Catalog Household");
    await expect(recovery.recentSnapshotsSummary).toContainText("2026");
    await expect(recovery.recentSnapshotsSummary).not.toContainText("2025");

    await recovery.reviewCatalogSnapshotButton(olderPath).click();
    await expect(recovery.restorePathInput).toHaveValue(olderPath);
    await expect(recovery.snapshotDetails).toContainText("Older Catalog Household");
    await expect(recovery.snapshotDetails.locator("time")).toHaveAttribute(
      "datetime",
      "2025-09-01T12:00:00.000Z"
    );

    await recovery.reviewCatalogSnapshotButton(newerPath).click();
    await expect(recovery.restorePathInput).toHaveValue(newerPath);
    await expect(recovery.snapshotDetails).toContainText("Newer Catalog Household");
  });

  test("retries a failed catalog refresh while preserving the last good entries", async ({
    recovery,
    databasePath,
  }) => {
    const database = new DatabaseSync(databasePath);
    let catalogTableRenamed = false;
    const outputPath = join(dirname(databasePath), "retryable-catalog-backup.json");

    try {
      await recovery.backupPathInput.fill(outputPath);
      await recovery.backupCreateButton.click();
      await expect(recovery.backupSuccess).toContainText(outputPath);
      await recovery.recentSnapshotsSummary.click();
      await expect(recovery.recentSnapshots).toContainText(outputPath);

      database.exec("ALTER TABLE backup_snapshots RENAME TO backup_snapshots_unavailable");
      catalogTableRenamed = true;
      await recovery.refreshCatalogButton.click();

      await expect(recovery.catalogError).toContainText("Saved snapshots could not be refreshed");
      await expect(recovery.retryCatalogButton).toBeVisible();
      await expect(recovery.recentSnapshots).toContainText(outputPath);

      database.exec("ALTER TABLE backup_snapshots_unavailable RENAME TO backup_snapshots");
      catalogTableRenamed = false;
      await recovery.retryCatalogButton.click();

      await expect(recovery.catalogError).not.toBeVisible();
      await expect(recovery.recentSnapshots).toContainText(outputPath);
      await expect(recovery.refreshCatalogButton).toBeVisible();
    } finally {
      if (catalogTableRenamed) {
        database.exec("ALTER TABLE backup_snapshots_unavailable RENAME TO backup_snapshots");
      }
      database.close();
    }
  });

  test("keeps data-safety controls within supported window sizes", async ({
    electronApp,
    recovery,
    databasePath,
    window,
  }) => {
    const windowSizes = [
      { width: 390, height: 844 },
      { width: 680, height: 900 },
      { width: 1024, height: 900 },
      { width: 1280, height: 800 },
      { width: 1440, height: 1000 },
      { width: 1920, height: 1080 },
    ];

    await expect(recovery.restoreSection).toBeVisible();
    const snapshotPath = join(dirname(databasePath), "layout-review-snapshot.json");
    const snapshot = buildBackupSnapshot({
      household: {
        id: "layout-household",
        name: "September Household Snapshot for Multiple Accounts",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [
        {
          id: "layout-account",
          householdId: "layout-household",
          name: "Primary household account",
          currencyCode: "NOK",
        },
      ],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
      createdAtIso: "2026-09-30T12:15:00.000Z",
    });
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
    await recovery.restorePathInput.fill(snapshotPath);
    await recovery.reviewSnapshotButton.click();
    await expect(recovery.snapshotDetails).toBeVisible();

    for (const size of windowSizes) {
      await electronApp.evaluate(({ BrowserWindow }, nextSize) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(nextSize.width, nextSize.height);
      }, size);

      const layout = await window.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const workspace = document.querySelector<HTMLElement>("[aria-label='Data safety workspace']");
        if (!workspace) throw new Error("Data safety workspace was not rendered.");

        const overflowingControls = Array.from(
          workspace.querySelectorAll<HTMLElement>(
            "button, input, label, h1, h2, h3, p, summary, strong, small, time, code"
          )
        )
          .filter((control) => {
            const bounds = control.getBoundingClientRect();
            return (
              bounds.left < 0 ||
              bounds.right > viewportWidth + 1 ||
              (!(control instanceof HTMLInputElement) &&
                control.scrollWidth > control.clientWidth + 1)
            );
          })
          .map((control) => control.textContent?.trim() || control.getAttribute("aria-label") || control.tagName);

        return {
          hasPageOverflow: document.documentElement.scrollWidth > viewportWidth + 1,
          overflowingControls,
        };
      });

      expect(layout.hasPageOverflow, `page overflow at ${size.width}px`).toBe(false);
      expect(layout.overflowingControls, `clipped controls at ${size.width}px`).toEqual([]);
    }
  });

  test.describe("CSV export save-dialog selected result", () => {
    test.use({ csvExportDialogBehavior: "selected" });

    test("uses the selected native path before writing the ledger", async ({
      recovery,
      databasePath,
    }) => {
      const outputPath = join(dirname(databasePath), "dialog-selected.csv");

      await recovery.browseButton.click();
      await expect(recovery.exportPathInput).toHaveValue(outputPath);
      expect(existsSync(outputPath)).toBe(false);
      await recovery.exportButton.click();

      await expect(recovery.exportSuccess).toContainText(
        `Export saved to ${outputPath} (4 transactions).`
      );
      const exportedCsv = readFileSync(outputPath, "utf8");
      const exportedRows = exportedCsv.trimEnd().split(/\r?\n/);
      expect(exportedRows[0]).toBe(
        "id,householdId,accountId,bookedAtIso,amountMinor,merchantRaw,merchantAlias,sourceReference,categoryId,importJobId"
      );
      expect(exportedRows).toHaveLength(5);
      for (const transactionId of ["sample-tx-1", "sample-tx-2", "sample-tx-3", "sample-tx-4"]) {
        expect(exportedRows.some((row) => row.startsWith(`${transactionId},`))).toBe(true);
      }
    });
  });

  test("restores a snapshot and refreshes the dashboard with restored ledger data", async ({
    appShell,
    recovery,
    dashboard,
    dashboardTarget,
    forecast,
    window,
  }) => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-restore-runtime-"));
    const snapshotPath = join(tempDir, "restored.json");

    try {
      const snapshot = buildBackupSnapshot({
        household: {
          id: "sample-hh",
          name: "Restored Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          { id: "sample-acc", householdId: "sample-hh", name: "Restored account", currencyCode: "NOK" },
        ],
        transactions: [
          {
            id: "restored-tx-1",
            householdId: "sample-hh",
            accountId: "sample-acc",
            bookedAtIso: "2026-05-20T10:00:00Z",
            amountMinor: -12345,
            merchantRaw: "Restored merchant",
            categoryId: "restored",
          },
        ],
        importJobs: [],
        monthlyCategoryTargets: [
          { yearMonth: "2026-05", categoryId: "restored", targetMinor: 15000 },
        ],
        createdAtIso: "2026-09-22T10:00:00Z",
      });
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      await recovery.restorePathInput.fill(snapshotPath);
      await recovery.reviewSnapshotButton.click();
      window.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        await dialog.accept();
      });
      await recovery.restoreButton.click();

      await expect(recovery.restoreSuccess).toContainText("1 transaction restored");
      await appShell.openWorkspace("Review");
      await dashboard.monthSelector.selectOption("2026-05");
      await expect(dashboard.categoryBreakdownSection).toContainText("restored");
      await expect(dashboard.monthSelector).toHaveValue("2026-05");
      await expect(dashboard.incomeValue).toHaveText(/0,00/);
      await expect(dashboard.expenseValue).toHaveText(/^123,45/);
      await expect(dashboard.netValue).toHaveText(/−123,45/);
      await expect(dashboardTarget.categoryRow("restored")).toBeVisible();
      await expect(dashboardTarget.targetCell("restored")).toHaveText(/^150,00/);
      await expect(dashboardTarget.actualCell("restored")).toHaveText(/^123,45/);
      await expect(dashboardTarget.deltaCell("restored")).toHaveText(/−26,55/);
      await expect(forecast.projectedDescription).toBeVisible();
      await expect(forecast.section.getByRole("listitem").first()).toContainText("2026-06");
      await expect(forecast.section.getByRole("listitem").first()).toContainText("−123,45");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test.describe("restore open-dialog selected result", () => {
    test.use({ restoreSnapshotDialogBehavior: "selected" });

    test("reviews snapshot identity and contents without restoring it", async ({
      recovery,
      databasePath,
    }) => {
      const snapshotPath = join(dirname(databasePath), "dialog-selected-restore.json");
      const initialSnapshot = loadPersistedSnapshot(databasePath);
      const snapshot = buildBackupSnapshot({
        household: {
          id: "review-household",
          name: "September Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          {
            id: "review-account",
            householdId: "review-household",
            name: "Review account",
            currencyCode: "NOK",
          },
        ],
        transactions: [
          {
            id: "review-transaction",
            householdId: "review-household",
            accountId: "review-account",
            bookedAtIso: "2026-09-30T10:00:00Z",
            amountMinor: -1250,
            merchantRaw: "Synthetic merchant",
            categoryId: "other",
          },
        ],
        importJobs: [],
        monthlyCategoryTargets: [],
        createdAtIso: "2026-09-30T12:15:00.000Z",
      });
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      await recovery.chooseSnapshotButton.click();
      await expect(recovery.restorePathInput).toHaveValue(snapshotPath);
      await expect(recovery.restoreButton).toBeDisabled();
      await recovery.reviewSnapshotButton.click();

      await expect(recovery.snapshotDetails).toContainText("September Household");
      await expect(recovery.snapshotDetails).toContainText("1 account");
      await expect(recovery.snapshotDetails).toContainText("1 transaction");
      await expect(recovery.snapshotReviewSuccess).toHaveText(
        "Snapshot verified. Review the details before restoring."
      );
      await expect(recovery.snapshotDetails.locator("time")).toHaveAttribute(
        "datetime",
        "2026-09-30T12:15:00.000Z"
      );
      await expect(recovery.restoreButton).toBeEnabled();
      await expect(recovery.restoreSuccess).not.toBeVisible();
      expect(loadPersistedSnapshot(databasePath)).toEqual(initialSnapshot);
    });
  });

  test("refuses to restore a snapshot changed after metadata review", async ({
    recovery,
    databasePath,
    window,
  }) => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-restore-review-binding-"));
    const snapshotPath = join(tempDir, "reviewed-snapshot.json");
    const initialSnapshot = loadPersistedSnapshot(databasePath);
    const snapshot = buildBackupSnapshot({
      household: {
        id: "review-binding-household",
        name: "Review Binding Household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [
        {
          id: "review-binding-account",
          householdId: "review-binding-household",
          name: "Review binding account",
          currencyCode: "NOK",
        },
      ],
      transactions: [
        {
          id: "review-binding-transaction",
          householdId: "review-binding-household",
          accountId: "review-binding-account",
          bookedAtIso: "2026-09-30T10:00:00Z",
          amountMinor: -1250,
          merchantRaw: "Original snapshot transaction",
          categoryId: "other",
        },
      ],
      importJobs: [],
      monthlyCategoryTargets: [],
      createdAtIso: "2026-09-30T12:15:00.000Z",
    });

    try {
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
      await recovery.restorePathInput.fill(snapshotPath);
      await recovery.reviewSnapshotButton.click();

      const changedSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as BackupSnapshot;
      changedSnapshot.transactions[0]!.amountMinor = -9999;
      writeFileSync(snapshotPath, JSON.stringify(changedSnapshot), "utf8");

      window.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        await dialog.accept();
      });
      await recovery.restoreButton.click();

      await expect(recovery.restoreError).toContainText("changed since it was reviewed");
      await expect(recovery.restoreSuccess).not.toBeVisible();
      expect(loadPersistedSnapshot(databasePath)).toEqual(initialSnapshot);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reports an export write failure without reporting success", async ({ recovery }) => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-export-failure-"));

    try {
      await recovery.exportPathInput.fill(tempDir);
      await recovery.exportButton.click();

      await expect(recovery.exportError).toContainText("Export failed");
      await expect(recovery.exportSuccess).not.toBeVisible();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test.describe("CSV export save-dialog cancellation result", () => {
    test.use({ csvExportDialogBehavior: "cancel" });

    test("reports cancellation without reporting success", async ({ recovery }) => {
      await expect(recovery.exportSection).toBeVisible();
      await recovery.browseButton.click();

      await expect(recovery.exportCancelled).toHaveText("Export cancelled.");
      await expect(recovery.exportSuccess).not.toBeVisible();
    });
  });

  test.describe("restore-dialog cancellation", () => {
    test.use({ restoreSnapshotDialogBehavior: "cancel" });

    test("reports cancellation when the snapshot chooser is dismissed", async ({ recovery }) => {
      await recovery.chooseSnapshotButton.click();

      await expect(recovery.restoreCancelled).toHaveText("Restore cancelled.");
      await expect(recovery.restoreSuccess).not.toBeVisible();
    });
  });

  test("identifies the selected snapshot and replacement consequences before restore", async ({
    recovery,
    window,
    databasePath,
  }) => {
    const snapshotName = "restore-confirmation-snapshot.json";
    const snapshotPath = join(dirname(databasePath), snapshotName);
    const snapshot = buildBackupSnapshot({
      household: {
        id: "confirmation-household",
        name: "Confirmation Household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [
        {
          id: "confirmation-account",
          householdId: "confirmation-household",
          name: "Confirmation account",
          currencyCode: "NOK",
        },
      ],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
      createdAtIso: "2026-10-01T10:00:00Z",
    });
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
    const expectedCreatedAt = new Intl.DateTimeFormat("nb-NO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(snapshot.metadata.createdAtIso));

    await recovery.restorePathInput.fill(snapshotPath);
    await recovery.reviewSnapshotButton.click();
    window.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain(snapshotName);
      expect(dialog.message()).not.toContain(snapshotPath);
      expect(dialog.message()).toContain(expectedCreatedAt);
      expect(dialog.message()).not.toContain(snapshot.metadata.createdAtIso);
      expect(dialog.message()).toContain("1 account; 0 transactions");
      expect(dialog.message()).toContain("current household data");
      expect(dialog.message()).toContain("categorization rules");
      await dialog.dismiss();
    });
    await recovery.restoreButton.click();

    await expect(recovery.restoreCancelled).toHaveText("Restore cancelled.");
    await expect(recovery.restoreSuccess).not.toBeVisible();
  });

  test("reports an invalid restore snapshot without replacing the ledger", async ({
    appShell,
    recovery,
    dashboard,
    databasePath,
  }) => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-restore-failure-"));
    const snapshotPath = join(tempDir, "invalid.json");
    const initialSnapshot = loadPersistedSnapshot(databasePath);

    try {
      writeFileSync(snapshotPath, "{ invalid json", "utf8");
      await recovery.restorePathInput.fill(snapshotPath);
      await recovery.reviewSnapshotButton.click();

      await expect(recovery.restoreError).toContainText("Failed to parse snapshot file");
      await expect(recovery.restoreButton).toBeDisabled();
      await expect(recovery.restoreSuccess).not.toBeVisible();
      expect(loadPersistedSnapshot(databasePath)).toEqual(initialSnapshot);
      await appShell.openWorkspace("Review");
      await dashboard.monthSelector.selectOption("2026-05");
      await expect(dashboard.categoryBreakdownSection).toContainText("groceries");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("cancelling restore confirmation leaves the current ledger visible", async ({
    appShell,
    recovery,
    dashboard,
    databasePath,
    window,
  }) => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-restore-cancel-"));
    const snapshotPath = join(tempDir, "valid.json");

    try {
      const initialSnapshot = loadPersistedSnapshot(databasePath);
      const snapshot = buildBackupSnapshot({
        household: {
          id: "sample-hh",
          name: "Cancelled Restore",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          { id: "sample-acc", householdId: "sample-hh", name: "Restored account", currencyCode: "NOK" },
        ],
        transactions: [
          {
            id: "cancelled-restore-tx",
            householdId: "sample-hh",
            accountId: "sample-acc",
            bookedAtIso: "2026-05-20T10:00:00Z",
            amountMinor: -12345,
            merchantRaw: "Should not be restored",
            categoryId: "cancelled",
          },
        ],
        importJobs: [],
        monthlyCategoryTargets: [
          { yearMonth: "2026-05", categoryId: "cancelled", targetMinor: 12345 },
        ],
        createdAtIso: "2026-09-22T10:00:00Z",
      });
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      await recovery.restorePathInput.fill(snapshotPath);
      await recovery.reviewSnapshotButton.click();
      window.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        await dialog.dismiss();
      });
      await recovery.restoreButton.click();

      await expect(recovery.restoreCancelled).toHaveText("Restore cancelled.");
      await expect(recovery.restoreSuccess).not.toBeVisible();
      await appShell.openWorkspace("Review");
      await dashboard.monthSelector.selectOption("2026-05");
      await expect(dashboard.categoryBreakdownSection).toContainText("groceries");
      await expect(dashboard.categoryBreakdownSection).not.toContainText("cancelled");
      const persistedSnapshot = loadPersistedSnapshot(databasePath);
      expect(persistedSnapshot).toEqual(initialSnapshot);
      expect(persistedSnapshot.transactions).not.toContainEqual(
        expect.objectContaining({ id: "cancelled-restore-tx" })
      );
      expect(persistedSnapshot.monthlyCategoryTargets).not.toContainEqual(
        expect.objectContaining({ categoryId: "cancelled", yearMonth: "2026-05" })
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("offers an undo that restores the ledger captured before restore", async ({
    recovery,
    databasePath,
    window,
  }) => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-restore-rollback-"));
    const snapshotPath = join(tempDir, "replacement.json");
    const initialSnapshot = loadPersistedSnapshot(databasePath);
    const replacementSnapshot = buildBackupSnapshot({
      household: {
        id: "replacement-household",
        name: "Replacement Household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [
        {
          id: "replacement-account",
          householdId: "replacement-household",
          name: "Replacement account",
          currencyCode: "NOK",
        },
      ],
      transactions: [
        {
          id: "replacement-transaction",
          householdId: "replacement-household",
          accountId: "replacement-account",
          bookedAtIso: "2026-09-30T10:00:00Z",
          amountMinor: -1250,
          merchantRaw: "Replacement merchant",
          categoryId: "other",
        },
      ],
      importJobs: [],
      monthlyCategoryTargets: [],
      createdAtIso: "2026-09-30T12:15:00.000Z",
    });

    try {
      writeFileSync(snapshotPath, JSON.stringify(replacementSnapshot), "utf8");
      await recovery.restorePathInput.fill(snapshotPath);
      await recovery.reviewSnapshotButton.click();
      window.once("dialog", async (dialog) => await dialog.accept());
      await recovery.restoreButton.click();
      await expect(recovery.restoreSuccess).toContainText("1 transaction restored");
      await expect(recovery.undoRestoreButton).toBeVisible();

      const recoverySnapshotPath = await recovery.restoreSuccess.locator("code").textContent();
      expect(recoverySnapshotPath).not.toBeNull();
      const originalRecoverySnapshot = readFileSync(recoverySnapshotPath!, "utf8");
      const changedRecoverySnapshot = JSON.parse(originalRecoverySnapshot) as BackupSnapshot;
      changedRecoverySnapshot.transactions[0]!.amountMinor -= 1;
      writeFileSync(recoverySnapshotPath!, JSON.stringify(changedRecoverySnapshot), "utf8");

      window.once("dialog", async (dialog) => await dialog.accept());
      await recovery.undoRestoreButton.click();
      await expect(recovery.restoreError).toContainText("changed since it was reviewed");
      await expect(recovery.retryUndoButton).toBeVisible();

      writeFileSync(recoverySnapshotPath!, originalRecoverySnapshot, "utf8");
      await expect(recovery.retryUndoButton).toBeVisible();
      window.once("dialog", async (dialog) => await dialog.accept());
      await recovery.retryUndoButton.click();

      await expect(recovery.restoreUndoSuccess).toBeVisible();
      expect(loadPersistedSnapshot(databasePath)).toEqual(initialSnapshot);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
