import { test, expect } from "./fixtures/electron.js";
import { resolve } from "node:path";

const CSV_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");
const PDF_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt");

test.describe("Keyboard accessibility smoke", () => {
  test("manual entry follows form order and submits from the keyboard", async ({
    manualEntry,
    window,
  }) => {
    await expect(manualEntry.entrySection).toBeVisible();

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
    await csvImport.filePathInput.fill(CSV_FIXTURE_PATH);
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
    csvImport,
    reviewQueue,
    window,
  }) => {
    await csvImport.submitImport(CSV_FIXTURE_PATH);
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
    await pdfImport.filePathInput.fill(PDF_FIXTURE_PATH);
    await pdfImport.importButton.focus();
    await window.keyboard.press("Enter");
    await expect(pdfImport.previewRegion).toBeVisible();

    await pdfImport.confirmImportButton.focus();
    await window.keyboard.press("Enter");
    await expect(pdfImport.successStatus).toContainText("transactions to your ledger");
  });

  test("month rail buttons respond to keyboard activation", async ({ dashboard, window }) => {
    const targetMonth = dashboard.monthFrame("2026-04");
    await targetMonth.focus();
    await expect(targetMonth).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(dashboard.monthSelector).toHaveValue("2026-04");
  });
});
