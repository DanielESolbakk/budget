import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { Request } from "@playwright/test";
import { test, expect } from "./fixtures/electron.js";
import { ImportReviewPage } from "./pom/ImportReviewPage.js";

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

async function setDesktopThenMobileViewport(
  page: import("@playwright/test").Page,
  reconciliationRegion: import("@playwright/test").Locator
): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(reconciliationRegion).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(reconciliationRegion).toBeVisible();
  await expectNoHorizontalOverflow(page);
}

async function installMainProcessFetchProbe(electronApp: import("@playwright/test").ElectronApplication): Promise<void> {
  await electronApp.evaluate(() => {
    const state = globalThis as typeof globalThis & { __budgetMainFetchRequests?: string[] };
    state.__budgetMainFetchRequests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      state.__budgetMainFetchRequests?.push(String(input));
      return originalFetch(input, init);
    };
  });
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
    await expect(pdfImport.reconciliationTable).toContainText("125,00");
    await expect(pdfImport.reconciliationTable).toContainText("45,00");
    await setDesktopThenMobileViewport(window, pdfImport.reconciliationRegion);
  });
});

test.describe("matched CSV import reconciliation", () => {
  test.use({ importFileDialogBehavior: "csv-selected" });

  test("shows currency and direction totals at desktop and mobile widths", async ({ csvImport, window }) => {
    const filePath = writeCsvFixture([
      "Date;Description;Amount In;Amount Out;Currency",
      "29.05.2026;SYNTHETIC INCOME;125.00;;NOK",
      "28.05.2026;SYNTHETIC EXPENSE;;-45.00;NOK",
      "27.05.2026;SYNTHETIC GBP EXPENSE;;-78.00;GBP",
    ].join("\n"));

    await csvImport.submitImport(filePath);
    await expect(csvImport.successStatus).toBeVisible();
    await expect(csvImport.reconciliationStatus).toContainText("Matched");
    await expect(csvImport.reconciliationTable).toContainText("NOK");
    await expect(csvImport.reconciliationTable).toContainText("Incoming");
    await expect(csvImport.reconciliationTable).toContainText("Outgoing");
    await expect(csvImport.reconciliationTable).toContainText("GBP");
    await setDesktopThenMobileViewport(window, csvImport.reconciliationRegion);
  });
});

test.describe("matched digital PDF import reconciliation", () => {
  test.use({ importFileDialogBehavior: "pdf-selected" });

  test("shows matched totals at desktop and mobile widths", async ({ pdfImport, window }) => {
    await pdfImport.submitImport(copyPdfFixture());
    await expect(pdfImport.successStatus).toBeVisible({ timeout: 20_000 });
    await expect(pdfImport.reconciliationStatus).toContainText("Matched");
    await expect(pdfImport.reconciliationTable).toContainText("NOK");
    await setDesktopThenMobileViewport(window, pdfImport.reconciliationRegion);
  });
});

test.describe("unresolved CSV import reconciliation", () => {
  test.use({ importFileDialogBehavior: "csv-selected" });

  test("shows the mismatch and opens review without network requests", async ({
    csvImport,
    electronApp,
    window,
  }) => {
    const filePath = writeCsvFixture([
      "Date;Description;Amount Out;Currency",
      "29.05.2026;SYNTHETIC VALID ROW;-12.34;NOK",
      "99.05.2026;SYNTHETIC INVALID DATE;-3.00;NOK",
    ].join("\n"));
    const rendererRequests: string[] = [];
    const onRequest = (request: Request): void => {
      if (/^https?:/i.test(request.url())) rendererRequests.push(request.url());
    };
    window.on("request", onRequest);
    await installMainProcessFetchProbe(electronApp);

    await csvImport.submitImport(filePath);
    await expect(csvImport.successStatus).toBeVisible();
    await expect(csvImport.reconciliationStatus).toContainText("Needs review");
    await expect(csvImport.reconciliationTable).toContainText("3,00");
    await expect(csvImport.sourceRowDispositions).toContainText("Row 2");
    await expect(csvImport.sourceRowDispositions).toContainText("Invalid");
    await expect(csvImport.importSection.getByRole("button", { name: "Review unresolved rows" })).toBeVisible();
    await setDesktopThenMobileViewport(window, csvImport.reconciliationRegion);

    const importReview = new ImportReviewPage(window);
    await importReview.openUnresolvedRowsFromCompletion();
    await expect(importReview.reviewQueue).toBeVisible();
    await expect(importReview.reviewRow(2)).toContainText("SYNTHETIC INVALID DATE");

    const mainProcessRequests = await electronApp.evaluate(() =>
      (globalThis as typeof globalThis & { __budgetMainFetchRequests?: string[] }).__budgetMainFetchRequests ?? []
    );
    window.off("request", onRequest);
    expect(rendererRequests).toEqual([]);
    expect(mainProcessRequests).toEqual([]);
  });
});
