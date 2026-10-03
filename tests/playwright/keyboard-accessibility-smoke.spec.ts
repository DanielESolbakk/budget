import { test, expect } from "./fixtures/electron.js";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";

const CSV_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");
const PDF_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt");

test.describe("Keyboard accessibility smoke", () => {
  test("manual entry follows form order and submits from the keyboard", async ({
    manualEntry,
    window,
  }) => {
    await expect(manualEntry.entrySection).toBeVisible();

    await expect(manualEntry.accountInput).toBeEnabled();
    await manualEntry.accountInput.focus();
    await expect(manualEntry.accountInput).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(manualEntry.bookedDateInput).toBeFocused();
    await manualEntry.amountInput.focus();
    await expect(manualEntry.amountInput).toBeFocused();
    await manualEntry.merchantInput.focus();
    await expect(manualEntry.merchantInput).toBeFocused();

    await manualEntry.accountInput.selectOption("sample-acc");
    await manualEntry.bookedDateInput.fill("2026-05-23");
    await manualEntry.amountInput.fill("-1250");
    await manualEntry.merchantInput.fill("Keyboard accessibility entry");
    await manualEntry.categoryInput.selectOption("groceries");
    await manualEntry.submitButton.focus();
    await window.keyboard.press("Enter");

    await expect(manualEntry.successStatus).toContainText(
      "Added Keyboard accessibility entry to your ledger."
    );
  });

  test("CSV mapping controls follow a keyboard focus order", async ({ csvImport, window }) => {
    await csvImport.enterFilePath(CSV_FIXTURE_PATH);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    const executionDateMapping = csvImport.mappingSelect("Execution date");
    const bookedDateMapping = csvImport.mappingSelect("Booked date");
    await executionDateMapping.focus();
    await expect(executionDateMapping).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(bookedDateMapping).toBeFocused();
  });

  test("category review can be completed from the keyboard", async ({
    appShell,
    csvImport,
    reviewQueue,
    window,
  }) => {
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(CSV_FIXTURE_PATH);
    await appShell.openWorkspace("Transactions");
    const categorySelect = reviewQueue.categorySelect("MERCHANT-005");
    await expect(categorySelect).toBeVisible();
    await categorySelect.focus();
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(categorySelect).toHaveValue("groceries");

    const saveButton = reviewQueue.saveButton("MERCHANT-005");
    await saveButton.focus();
    await window.keyboard.press("Enter");
    await expect(reviewQueue.reviewItem("MERCHANT-005")).not.toBeVisible();
  });

  test("PDF preview and confirmation can be triggered from the keyboard", async ({
    pdfImport,
    window,
  }) => {
    await pdfImport.enterFilePath(PDF_FIXTURE_PATH);
    await pdfImport.importButton.focus();
    await window.keyboard.press("Enter");
    await expect(pdfImport.previewRegion).toBeVisible();

    await pdfImport.confirmImportButton.focus();
    await window.keyboard.press("Enter");
    await expect(pdfImport.successStatus).toContainText("transactions to your ledger");
  });

  test("month selector responds to keyboard selection", async ({ dashboard, window }) => {
    await dashboard.monthSelector.selectOption("2026-05");
    const initialMonth = await dashboard.monthSelector.inputValue();
    await dashboard.monthSelector.focus();
    await expect(dashboard.monthSelector).toBeFocused();
    await window.keyboard.press("ArrowUp");
    await window.keyboard.press("Enter");
    await expect(dashboard.monthSelector).not.toHaveValue(initialMonth);
  });

  test("primary navigation and monthly attention actions follow a predictable tab order", async ({
    appShell,
    categoryTarget,
    dashboard,
    window,
  }) => {
    await dashboard.monthSelector.selectOption("2026-05");
    await appShell.destination("Review").focus();
    await expect(appShell.destination("Review")).toBeFocused();

    await window.keyboard.press("Tab");
    await expect(appShell.destination("Transactions")).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(appShell.destination("Import")).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(appShell.destination("Data safety")).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(dashboard.monthSelector).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(dashboard.reviewQueueAction).toBeFocused();
    await expect(dashboard.targetVsActualSection).toHaveAttribute("tabindex", "0");
    await window.keyboard.press("Tab");
    await expect(dashboard.targetVsActualSection).toBeFocused();
    const focusOutlineWidth = await dashboard.targetVsActualSection.evaluate((element) =>
      getComputedStyle(element).outlineWidth
    );
    expect(focusOutlineWidth).toBe("3px");
    await window.keyboard.press("Tab");
    await expect(categoryTarget.editTargetButton("groceries")).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(categoryTarget.addTargetButton).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(categoryTarget.categoryIdInput).toBeFocused();
  });

  test("Data Safety backup, export, and restore expose keyboard actions and text outcomes", async ({
    appShell,
    databasePath,
    recovery,
    window,
  }) => {
    const backupPath = join(dirname(databasePath), "keyboard-backup.json");
    const exportPath = join(dirname(databasePath), "keyboard-export.csv");
    const snapshotPath = join(dirname(databasePath), "keyboard-restore.json");
    const snapshot = buildBackupSnapshot({
      household: {
        id: "keyboard-restore-household",
        name: "Keyboard Restore Household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [
        {
          id: "keyboard-restore-account",
          householdId: "keyboard-restore-household",
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

    await appShell.destination("Data safety").focus();
    await window.keyboard.press("Enter");
    await window.keyboard.press("Tab");
    await expect(recovery.backupPathInput).toBeFocused();
    await recovery.backupPathInput.fill(backupPath);
    await window.keyboard.press("Tab");
    await expect(recovery.backupBrowseButton).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(recovery.backupCreateButton).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(recovery.backupSuccess).toContainText(backupPath);

    await window.keyboard.press("Tab");
    await expect(recovery.exportPathInput).toBeFocused();
    await recovery.exportPathInput.fill(exportPath);
    await window.keyboard.press("Tab");
    await expect(recovery.browseButton).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(recovery.exportButton).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(recovery.exportSuccess).toContainText(exportPath);

    await window.keyboard.press("Tab");
  await expect(recovery.recentSnapshotsSummary).toBeFocused();
  await window.keyboard.press("Tab");
    await expect(recovery.restorePathInput).toBeFocused();
    await recovery.restorePathInput.fill(snapshotPath);
    await window.keyboard.press("Tab");
    await expect(recovery.chooseSnapshotButton).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(recovery.reviewSnapshotButton).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(recovery.snapshotReviewSuccess).toBeVisible();
    await window.keyboard.press("Tab");
    await expect(recovery.restoreButton).toBeFocused();
    window.once("dialog", async (dialog) => await dialog.accept());
    await window.keyboard.press("Enter");
    await expect(recovery.restoreSuccess).toContainText("Restore complete.");
  });
});
