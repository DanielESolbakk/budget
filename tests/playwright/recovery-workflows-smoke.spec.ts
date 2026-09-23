import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { buildBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

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
      expect(readFileSync(outputPath, "utf8")).toContain("sample-tx-1");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("restores a snapshot and refreshes the dashboard with restored ledger data", async ({
    recovery,
    dashboard,
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
        monthlyCategoryTargets: [],
        createdAtIso: "2026-09-22T10:00:00Z",
      });
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      await recovery.restorePathInput.fill(snapshotPath);
      window.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        await dialog.accept();
      });
      await recovery.restoreButton.click();

      await expect(recovery.restoreSuccess).toContainText("1 transaction restored");
      await expect(dashboard.categoryBreakdownSection).toContainText("restored");
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

  test.describe("native save-dialog cancellation", () => {
    test.use({ csvExportDialogBehavior: "cancel" });

    test("reports cancellation without reporting success", async ({ recovery }) => {
      await expect(recovery.exportSection).toBeVisible();
      await recovery.exportButton.click();

      await expect(recovery.exportCancelled).toHaveText("Export cancelled.");
      await expect(recovery.exportSuccess).not.toBeVisible();
    });
  });

  test("reports an invalid restore snapshot without replacing the ledger", async ({
    recovery,
    dashboard,
    window,
  }) => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-restore-failure-"));
    const snapshotPath = join(tempDir, "invalid.json");

    try {
      writeFileSync(snapshotPath, "{ invalid json", "utf8");
      await recovery.restorePathInput.fill(snapshotPath);
      window.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        await dialog.accept();
      });
      await recovery.restoreButton.click();

      await expect(recovery.restoreError).toContainText("Failed to parse snapshot file");
      await expect(recovery.restoreSuccess).not.toBeVisible();
      await expect(dashboard.categoryBreakdownSection).toContainText("groceries");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("cancelling restore confirmation leaves the current ledger visible", async ({
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
      window.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        await dialog.dismiss();
      });
      await recovery.restoreButton.click();

      await expect(recovery.restoreCancelled).toHaveText("Restore cancelled.");
      await expect(recovery.restoreSuccess).not.toBeVisible();
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
});
