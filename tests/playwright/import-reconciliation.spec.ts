import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { Locator, Page, Request } from "@playwright/test";
import { test, expect } from "./fixtures/electron.js";
import { ImportReviewPage } from "./pom/ImportReviewPage.js";
import { installMainProcessFetchProbe, mainProcessFetchRequests } from "./helpers/networkProbe.js";

const PDF_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-binary.pdf");
const temporaryDirectories = new Set<string>();

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "budget-playwright-reconciliation-"));
  temporaryDirectories.add(directory);
  return directory;
}

function writeCsvFixture(text: string): string {
  const path = join(createTemporaryDirectory(), `reconciliation-${randomUUID()}.csv`);
  writeFileSync(path, text, "utf8");
  return path;
}

function writeTextFixture(text: string): string {
  const path = join(createTemporaryDirectory(), `reconciliation-${randomUUID()}.txt`);
  writeFileSync(path, text, "utf8");
  return path;
}

function copyPdfFixture(): string {
  const path = join(createTemporaryDirectory(), `reconciliation-${randomUUID()}.pdf`);
  copyFileSync(PDF_FIXTURE_PATH, path);
  return path;
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page): Promise<void> {
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(hasHorizontalOverflow).toBe(false);
}

function reconciliationRow(
  table: Locator,
  currencyCode: string,
  direction: "Incoming" | "Outgoing"
): Locator {
  return table.getByRole("row").filter({ hasText: currencyCode }).filter({ hasText: direction });
}

async function expectReconciliationAmountRow(
  table: Locator,
  currencyCode: string,
  direction: "Incoming" | "Outgoing",
  sourceTotal: string | RegExp,
  persistedTotal: string | RegExp,
  difference: string | RegExp,
  status: "Matched" | "Mismatch"
): Promise<Locator> {
  const row = reconciliationRow(table, currencyCode, direction);
  await expect(row).toHaveCount(1);
  const cells = row.getByRole("cell");
  await expect(cells).toHaveCount(6);
  await expect(cells.nth(0)).toHaveText(currencyCode);
  await expect(cells.nth(1)).toHaveText(direction);
  await expect(cells.nth(2)).toContainText(sourceTotal);
  await expect(cells.nth(3)).toContainText(persistedTotal);
  await expect(cells.nth(4)).toContainText(difference);
  await expect(cells.nth(5)).toHaveText(status);
  return row;
}

async function setDesktopThenMobileViewport(
  page: Page,
  reconciliationRegion: Locator,
  rows: readonly Locator[]
): Promise<void> {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(reconciliationRegion).toBeVisible();
    for (const row of rows) {
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeVisible();
      const cells = row.getByRole("cell");
      await expect(cells).toHaveCount(6);
      for (const cell of await cells.all()) {
        await expect(cell).toBeVisible();
        const clippedText = await cell.evaluate((element) =>
          element.scrollWidth > element.clientWidth + 1
        );
        expect(clippedText).toBe(false);
      }
    }
    if (viewport.width === 390) await expectNoHorizontalOverflow(page);
  }
}

test.afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

test.describe("matched text import reconciliation", () => {
  test.use({ importFileDialogBehavior: "pdf-selected" });

  test("shows matched totals at desktop and mobile widths", async ({ pdfImport, window }) => {
    const filePath = writeTextFixture([
      "ROGALAND SPAREBANK",
      "Dato         Beskrivelse                              Beløp          Saldo",
      "29.05.2026   SYNTHETIC INCOME                         +125,00        1 000,00",
      "28.05.2026   SYNTHETIC EXPENSE                         -45,00          875,00",
    ].join("\n"));

    await pdfImport.submitImport(filePath);
    await expect(pdfImport.successStatus).toBeVisible();
    await expect(pdfImport.reconciliationStatus).toContainText("Matched");
    await expect(pdfImport.reconciliationTable.getByRole("columnheader")).toHaveText([
      "Currency",
      "Direction",
      "Source total",
      "Persisted transactions",
      "Difference",
      "Status",
    ]);
    const incomingRow = await expectReconciliationAmountRow(
      pdfImport.reconciliationTable,
      "NOK",
      "Incoming",
      "125,00",
      "125,00",
      "0,00",
      "Matched"
    );
    const outgoingRow = await expectReconciliationAmountRow(
      pdfImport.reconciliationTable,
      "NOK",
      "Outgoing",
      "−45,00",
      "−45,00",
      "0,00",
      "Matched"
    );
    await setDesktopThenMobileViewport(
      window,
      pdfImport.reconciliationRegion,
      [incomingRow, outgoingRow]
    );
  });
});

test.describe("matched CSV import reconciliation", () => {
  test.use({ importFileDialogBehavior: "csv-selected" });

  test("shows matched currency and direction totals without outbound requests", async ({
    csvImport,
    electronApp,
    window,
  }) => {
    const filePath = writeCsvFixture([
      "Date;Description;Amount In;Amount Out;Currency",
      "29.05.2026;SYNTHETIC INCOME;125.00;;NOK",
      "28.05.2026;SYNTHETIC EXPENSE;;-45.00;NOK",
      "27.05.2026;SYNTHETIC GBP EXPENSE;;-78.00;GBP",
    ].join("\n"));
    const rendererRequests: string[] = [];
    const onRequest = (request: Request): void => {
      if (/^https?:/i.test(request.url())) rendererRequests.push(request.url());
    };
    window.on("request", onRequest);
    await installMainProcessFetchProbe(electronApp);

    try {
      await csvImport.submitImport(filePath);
      await expect(csvImport.successStatus).toBeVisible();
      await expect(csvImport.reconciliationStatus).toContainText("Matched");
      await expect(csvImport.reconciliationTable.getByRole("columnheader")).toHaveText([
        "Currency",
        "Direction",
        "Source total",
        "Persisted transactions",
        "Difference",
        "Status",
      ]);
      const incomingRow = await expectReconciliationAmountRow(
        csvImport.reconciliationTable,
        "NOK",
        "Incoming",
        "125,00",
        "125,00",
        "0,00",
        "Matched"
      );
      const nokOutgoingRow = await expectReconciliationAmountRow(
        csvImport.reconciliationTable,
        "NOK",
        "Outgoing",
        "−45,00",
        "−45,00",
        "0,00",
        "Matched"
      );
      const gbpOutgoingRow = await expectReconciliationAmountRow(
        csvImport.reconciliationTable,
        "GBP",
        "Outgoing",
        "−78,00",
        "−78,00",
        "0,00",
        "Matched"
      );
      await setDesktopThenMobileViewport(
        window,
        csvImport.reconciliationRegion,
        [incomingRow, nokOutgoingRow, gbpOutgoingRow]
      );
      expect(rendererRequests).toEqual([]);
      expect(await mainProcessFetchRequests(electronApp)).toEqual([]);
    } finally {
      window.off("request", onRequest);
    }
  });
});

test.describe("matched digital PDF import reconciliation", () => {
  test.use({ importFileDialogBehavior: "pdf-selected" });

  test("shows matched totals at desktop and mobile widths", async ({ pdfImport, window }) => {
    await pdfImport.submitImport(copyPdfFixture());
    await expect(pdfImport.successStatus).toBeVisible({ timeout: 20_000 });
    await expect(pdfImport.reconciliationStatus).toContainText("Matched");
    const incomingRow = await expectReconciliationAmountRow(
      pdfImport.reconciliationTable,
      "NOK",
      "Incoming",
      /50[\s\u00a0\u202f]?000,00/,
      /50[\s\u00a0\u202f]?000,00/,
      "0,00",
      "Matched"
    );
    const outgoingRow = await expectReconciliationAmountRow(
      pdfImport.reconciliationTable,
      "NOK",
      "Outgoing",
      "−97,70",
      "−97,70",
      "0,00",
      "Matched"
    );
    await setDesktopThenMobileViewport(
      window,
      pdfImport.reconciliationRegion,
      [incomingRow, outgoingRow]
    );
  });
});

test.describe("mismatched CSV import reconciliation", () => {
  test.use({ importFileDialogBehavior: "csv-selected" });

  test("an intentional duplicate skip explains the difference without claiming unresolved work", async ({
    csvImport,
  }) => {
    const filePath = writeCsvFixture([
      "Date;Description;Amount Out;Currency",
      "29.05.2026;KIWI SYNTHETIC DUPLICATE;-10.00;NOK",
    ].join("\n"));
    await csvImport.submitImport(filePath);
    await expect(csvImport.successStatus).toHaveText("Added 1 transaction to your ledger.");
    await csvImport.enterFilePath(filePath);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();
    await csvImport.previewRegion.getByRole("radio", { name: "Skip duplicate" }).check();
    await csvImport.confirmImportButton.click();

    await expect(csvImport.successStatus).toHaveText("No new transactions were added.");
    await expect(csvImport.reconciliationStatus).toContainText("All source rows accounted for");
    await expect(csvImport.reconciliationStatus).not.toContainText("Needs review");
    await expect(csvImport.reconciliationRegion).toContainText("1 deliberately skipped");
    await expect(csvImport.reconciliationRegion).toContainText("0 need action");
    await expectReconciliationAmountRow(
      csvImport.reconciliationTable, "NOK", "Outgoing", "−10,00", "0,00", "−10,00", "Mismatch"
    );
    await expect(csvImport.sourceRowDispositions).toContainText("Skipped");
    await expect(csvImport.reconciliationRegion).not.toContainText("rows needing attention");
  });

  test("renders reconciliation details incrementally for large imports", async ({ csvImport, window }) => {
    const invalidRows = Array.from(
      { length: 60 },
      (_, index) => `99.05.2026;SYNTHETIC INVALID ROW ${index + 1};-1.00;NOK`
    );
    const filePath = writeCsvFixture([
      "Date;Description;Amount Out;Currency",
      "28.05.2026;SYNTHETIC VALID ROW;-12.34;NOK",
      ...invalidRows,
    ].join("\n"));

    await csvImport.submitImport(filePath);
    await expect(csvImport.successStatus).toHaveText("Added 1 transaction to your ledger.");

    const dispositions = csvImport.sourceRowDispositions;
    const visibleRowCount = csvImport.reconciliationRegion
      .getByRole("status")
      .filter({ hasText: "rows not added as transactions" });
    await expect(dispositions.getByRole("listitem")).toHaveCount(50);
    await expect(visibleRowCount).toHaveText("Showing 50 of 60 rows not added as transactions.");
    await expect(dispositions).toContainText("Row 51: Invalid, sent to review");
    await expect(dispositions).not.toContainText("Row 52: Invalid, sent to review");

    const showMoreButton = csvImport.reconciliationRegion.getByRole("button", {
      name: "Show more rows",
    });
    expect(
      await showMoreButton.evaluate((element) => Number.parseFloat(getComputedStyle(element).minHeight))
    ).toBeGreaterThanOrEqual(44);
    await showMoreButton.focus();
    await expect(showMoreButton).toBeFocused();
    await showMoreButton.press("Enter");

    await expect(dispositions.getByRole("listitem")).toHaveCount(60);
    await expect(visibleRowCount).toHaveText("Showing 60 of 60 rows not added as transactions.");
    await expect(visibleRowCount).toBeFocused();
    await expect(dispositions).toContainText("Row 61: Invalid, sent to review");
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await window.setViewportSize(viewport);
      await expect(csvImport.reconciliationRegion).toBeVisible();
      await expectNoHorizontalOverflow(window);
    }
  });

  test("shows the signed difference and skipped/invalid rows and opens review by keyboard", async ({
    csvImport,
    electronApp,
    window,
  }) => {
    const filePath = writeCsvFixture([
      "Date;Description;Amount Out;Currency",
      "29.05.2026;SYNTHETIC DUPLICATE ROW;-10.00;NOK",
    ].join("\n"));
    const rendererRequests: string[] = [];
    const onRequest = (request: Request): void => {
      if (/^https?:/i.test(request.url())) rendererRequests.push(request.url());
    };

    await csvImport.submitImport(filePath);
    await expect(csvImport.successStatus).toHaveText("Added 1 transaction to your ledger.");
    writeFileSync(filePath, [
      "Date;Description;Amount Out;Currency",
      "29.05.2026;SYNTHETIC DUPLICATE ROW;-10.00;NOK",
      "28.05.2026;SYNTHETIC VALID ROW;-12.34;NOK",
      "99.05.2026;SYNTHETIC INVALID DATE;-3.00;NOK",
    ].join("\n"), "utf8");
    await electronApp.evaluate((_, filePath: string) => {
      process.env["BUDGET_TEST_IMPORT_FILE_DIALOG"] = "csv-selected";
      process.env["BUDGET_TEST_CSV_IMPORT_PATH"] = filePath;
    }, filePath);
    window.on("request", onRequest);
    await installMainProcessFetchProbe(electronApp);

    try {
      await csvImport.chooseFileButton.click();
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();
      const duplicateRow = csvImport.previewRegion.getByRole("table", {
        name: "CSV statement preview rows and validation states",
      }).getByRole("row").filter({ hasText: "Duplicate candidate" });
      await expect(duplicateRow).toHaveCount(1);
      await duplicateRow.getByRole("radio", { name: "Skip duplicate" }).check();
      await csvImport.confirmImportButton.click();

      await expect(csvImport.successStatus).toHaveText("Added 1 transaction to your ledger.");
      await expect(csvImport.importSection.getByText("1 duplicate row skipped.", { exact: true })).toBeVisible();
      await expect(csvImport.reconciliationStatus).toContainText("Needs review");
      const outgoingRow = await expectReconciliationAmountRow(
        csvImport.reconciliationTable,
        "NOK",
        "Outgoing",
        "−25,34",
        "−12,34",
        "−13,00",
        "Mismatch"
      );
      await expect(csvImport.sourceRowDispositions).toContainText("Row 1: Skipped");
      await expect(csvImport.sourceRowDispositions).toContainText("Row 3: Invalid, sent to review");
      const reviewButton = csvImport.importSection.getByRole("button", {
        name: "Review unresolved rows",
        exact: true,
      });
      await expect(reviewButton).toBeVisible();
      await setDesktopThenMobileViewport(window, csvImport.reconciliationRegion, [outgoingRow]);

      await reviewButton.focus();
      await expect(reviewButton).toBeFocused();
      await reviewButton.press("Enter");
      const importReview = new ImportReviewPage(window);
      await expect(importReview.reviewQueue).toBeVisible();
      await expect(importReview.reviewRow(3)).toContainText("SYNTHETIC INVALID DATE");

      expect(rendererRequests).toEqual([]);
      expect(await mainProcessFetchRequests(electronApp)).toEqual([]);
    } finally {
      window.off("request", onRequest);
    }
  });
});
