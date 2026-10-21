import { basename, resolve } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { DatabaseSync } from "node:sqlite";
import { CsvImportPage } from "./pom/CsvImportPage.js";
import { ImportReviewPage } from "./pom/ImportReviewPage.js";
import { PdfImportPage } from "./pom/PdfImportPage.js";

const CSV_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");
const TEXT_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt");
const PDF_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-binary.pdf");
const MIXED_CSV_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/import-review/import-review-mixed.csv");
const MIXED_TEXT_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/import-review/import-review-mixed.txt");
const MIXED_PDF_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/import-review/import-review-mixed.pdf");

test.describe("single statement import entry", () => {
  test.describe("native statement chooser", () => {
    test.use({ importFileDialogBehavior: "native" });

    test("opens the chooser with the supported local statement extensions", async ({
      appShell,
      electronApp,
      window,
    }) => {
      await electronApp.evaluate(({ dialog }, selectedPath: string) => {
        const state = globalThis as typeof globalThis & {
          __budgetCapturedImportDialog?: { properties: string[]; extensions: string[] };
        };
        dialog.showOpenDialog = async (options) => {
          if (!("filters" in options)) {
            throw new Error("Import statement chooser did not receive open-dialog options.");
          }
          state.__budgetCapturedImportDialog = {
            properties: options.properties ?? [],
            extensions: options.filters?.flatMap(({ extensions }) => extensions) ?? [],
          };
          return { canceled: false, filePaths: [selectedPath] };
        };
      }, CSV_PATH);

      await appShell.openWorkspace("Import");
      await new ImportReviewPage(window).chooseStatementFile();
      await expect(window.getByRole("region", { name: "CSV Import", exact: true })).toBeVisible();

      const capturedOptions = await electronApp.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          __budgetCapturedImportDialog?: { properties: string[]; extensions: string[] };
        };
        return state.__budgetCapturedImportDialog ?? null;
      });
      expect(capturedOptions).toEqual({
        properties: ["openFile"],
        extensions: ["csv", "txt", "pdf"],
      });
    });
  });

  test.describe("CSV selection", () => {
    test.use({ importFileDialogBehavior: "csv-selected" });

    test("routes a selected CSV through the shared import action", async ({ appShell, window }) => {
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);

      await expect(window.getByRole("button", { name: "Import statement", exact: true })).toBeVisible();
      await expect(window.getByRole("button", { name: "CSV statement", exact: true })).toHaveCount(0);
      await importReview.chooseStatementFile();

      await expect(window.getByRole("region", { name: "CSV Import", exact: true })).toBeVisible();
      await expect(window.getByText(CSV_PATH, { exact: true })).toBeVisible();
    });
  });

  test.describe("text statement selection", () => {
    test.use({ importFileDialogBehavior: "text-selected" });

    test("routes a selected text statement through the shared import action", async ({ appShell, window }) => {
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);

      await expect(window.getByRole("button", { name: "Import statement", exact: true })).toBeVisible();
      await importReview.chooseStatementFile();

      await expect(window.getByRole("region", { name: "Digital statement import", exact: true })).toBeVisible();
      await expect(window.getByText(basename(TEXT_PATH), { exact: true })).toBeVisible();
    });
  });

  test.describe("binary PDF selection", () => {
    test.use({ importFileDialogBehavior: "pdf-selected" });

    test("routes a selected binary PDF through the shared import action", async ({ appShell, window }) => {
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);

      await expect(window.getByRole("button", { name: "Import statement", exact: true })).toBeVisible();
      await importReview.chooseStatementFile();

      await expect(window.getByRole("region", { name: "Digital statement import", exact: true })).toBeVisible();
      await expect(window.getByText(basename(PDF_PATH), { exact: true })).toBeVisible();
    });
  });

  test.describe("unresolved CSV rows", () => {
    test.use({ importFileDialogBehavior: "csv-selected" });

    test("corrects an unresolved row and persists one transaction with import provenance", async ({
      appShell,
      databasePath,
      window,
    }) => {
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);
      const csvImport = new CsvImportPage(window);
      await importReview.chooseStatementFile();
      await csvImport.enterFilePath(MIXED_CSV_PATH);
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();
      await expect(csvImport.confirmImportButton).toBeEnabled();
      await csvImport.confirmImportButton.click();
      await expect(csvImport.successStatus).toContainText("Added 1 transaction to your ledger.");
      await expect(csvImport.importSection.getByText("1 unresolved row saved for review.", { exact: true })).toBeVisible();

      const reviewQueue = importReview.reviewQueue;
      await expect(reviewQueue).toBeVisible();
      const reviewRow = importReview.reviewRow(2);
      await expect(reviewRow).toContainText("SYNTHETIC UNRESOLVED ROW");
      await importReview.correctRow(2, {
        date: "2026-05-19",
        amount: "-9.99",
        merchant: "SYNTHETIC CORRECTED ROW",
        accountId: "sample-acc",
        currency: "NOK",
      });

      await expect(reviewRow).toContainText("Corrected");
      const database = new DatabaseSync(databasePath);
      try {
        const correctedRows = database.prepare(`
          SELECT import_job_id, amount_minor, source_type, currency_code
          FROM transactions WHERE merchant_raw = ?
        `).all("SYNTHETIC CORRECTED ROW");
        expect(correctedRows).toHaveLength(1);
        const corrected = correctedRows[0];
        expect(corrected).toMatchObject({
          amount_minor: -999,
          source_type: "csv",
          currency_code: "NOK",
        });
        expect((corrected as { import_job_id: string }).import_job_id).toMatch(/^import-csv-/);
      } finally {
        database.close();
      }
    });

    test("dismisses an unresolved row with a reason and does not create a transaction", async ({
      appShell,
      databasePath,
      window,
    }) => {
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);
      const csvImport = new CsvImportPage(window);
      await importReview.chooseStatementFile();
      await csvImport.enterFilePath(MIXED_CSV_PATH);
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();
      await csvImport.confirmImportButton.click();
      await expect(csvImport.successStatus).toContainText("Added 1 transaction to your ledger.");
      await expect(csvImport.importSection.getByText("1 unresolved row saved for review.", { exact: true })).toBeVisible();

      const reviewRow = importReview.reviewRow(2);
      await expect(reviewRow.getByRole("button", { name: "Dismiss row", exact: true })).toBeDisabled();
      await importReview.dismissRow(2, "Not a household transaction");

      await expect(reviewRow).toContainText("Dismissed");
      await expect(reviewRow).toContainText(
        /Dismissed at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z: Not a household transaction/
      );
      await expect(reviewRow.getByRole("list", { name: "Parser diagnostics" })).toBeVisible();
      await reviewRow.getByText("Original source row", { exact: true }).click();
      await expect(reviewRow).toContainText("SYNTHETIC UNRESOLVED ROW");
      const database = new DatabaseSync(databasePath);
      try {
        const unresolvedTransaction = database.prepare(
          "SELECT id FROM transactions WHERE merchant_raw = ?"
        ).get("SYNTHETIC UNRESOLVED ROW");
        expect(unresolvedTransaction).toBeUndefined();
      } finally {
        database.close();
      }
    });

    test.describe("unresolved text statement rows", () => {
      test.use({ importFileDialogBehavior: "text-selected" });

      test("corrects a malformed text statement row with source provenance", async ({
        appShell,
        databasePath,
        window,
      }) => {
        await appShell.openWorkspace("Import");
        const importReview = new ImportReviewPage(window);
        const statementImport = new PdfImportPage(window);
        await importReview.chooseStatementFile();
        await statementImport.enterFilePath(MIXED_TEXT_PATH);
        await statementImport.importButton.click();
        await expect(statementImport.previewRegion).toBeVisible();
        await expect(statementImport.previewRegion.getByText(/1 unresolved row will be saved for review/)).toBeVisible();
        await expect(statementImport.confirmImportButton).toBeEnabled();
        await statementImport.confirmImportButton.click();
        await expect(statementImport.successStatus).toContainText("Added 1 transaction to your ledger.");
        await expect(statementImport.importSection.getByText(/1 unresolved row saved for review/)).toBeVisible();

        const reviewRow = importReview.reviewRow(4);
        await expect(reviewRow).toContainText("SYNTHETIC PDF BROKEN");
        await importReview.correctRow(4, {
          date: "2026-05-27",
          amount: "-7.25",
          merchant: "SYNTHETIC PDF CORRECTED",
          accountId: "sample-acc",
          currency: "NOK",
        });
        await expect(reviewRow).toContainText("Corrected");

        const database = new DatabaseSync(databasePath);
        try {
          const correctedRows = database.prepare(`
            SELECT amount_minor, source_type, currency_code
            FROM transactions WHERE merchant_raw = ?
          `).all("SYNTHETIC PDF CORRECTED");
          expect(correctedRows).toHaveLength(1);
          const corrected = correctedRows[0];
          expect(corrected).toMatchObject({
            amount_minor: -725,
            source_type: "pdf",
            currency_code: "NOK",
          });
        } finally {
          database.close();
        }
      });
    });

    test.describe("unresolved binary PDF rows", () => {
      test.use({ importFileDialogBehavior: "pdf-selected" });

      test("corrects an unresolved row extracted from a binary PDF", async ({
        appShell,
        databasePath,
        window,
      }) => {
        await appShell.openWorkspace("Import");
        const importReview = new ImportReviewPage(window);
        const statementImport = new PdfImportPage(window);
        await importReview.chooseStatementFile();
        await statementImport.enterFilePath(MIXED_PDF_PATH);
        await statementImport.importButton.click();
        await expect(statementImport.previewRegion).toBeVisible();
        await expect(statementImport.previewRegion.getByText(/1 unresolved row will be saved for review/)).toBeVisible();
        await expect(statementImport.confirmImportButton).toBeEnabled();
        await statementImport.confirmImportButton.click();
        await expect(statementImport.successStatus).toContainText("Added 1 transaction to your ledger.");
        await expect(statementImport.importSection.getByText(/1 unresolved row saved for review/)).toBeVisible();

        const reviewRow = importReview.reviewRow(7);
        await expect(reviewRow).toContainText("SYNTHETIC PDF BROKEN");
        await importReview.correctRow(7, {
          date: "2026-05-27",
          amount: "-7.25",
          merchant: "SYNTHETIC BINARY PDF CORRECTED",
          accountId: "sample-acc",
          currency: "NOK",
        });
        await expect(reviewRow).toContainText("Corrected");

        const database = new DatabaseSync(databasePath);
        try {
          const pdfTransactions = database.prepare(`
            SELECT merchant_raw, amount_minor, source_type
            FROM transactions
            WHERE source_type = 'pdf'
          `).all();
          expect(pdfTransactions).toHaveLength(2);
          expect(pdfTransactions).toEqual(expect.arrayContaining([
            expect.objectContaining({
              merchant_raw: "SYNTHETIC PDF VALID",
              amount_minor: -1250,
              source_type: "pdf",
            }),
            expect.objectContaining({
              merchant_raw: "SYNTHETIC BINARY PDF CORRECTED",
              amount_minor: -725,
              source_type: "pdf",
            }),
          ]));
        } finally {
          database.close();
        }
      });
    });

    test("keeps unresolved-row correction controls within a narrow window", async ({
      appShell,
      csvImport,
      electronApp,
      window,
    }) => {
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
      });
      await appShell.openWorkspace("Import");
      await csvImport.enterFilePath(MIXED_CSV_PATH);
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();
      await csvImport.confirmImportButton.click();

      const reviewRow = new ImportReviewPage(window).reviewRow(2);
      await expect(reviewRow.getByLabel("Date", { exact: true })).toBeVisible();
      await expect(reviewRow.getByRole("button", { name: "Save corrected transaction", exact: true })).toBeVisible();
      const geometry = await reviewRow.evaluate((element) => {
        const controls = Array.from(element.querySelectorAll("input, select, textarea, button"));
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          rowRight: element.getBoundingClientRect().right,
          controlBounds: controls.map((control) => {
            const bounds = control.getBoundingClientRect();
            return { left: bounds.left, right: bounds.right, width: bounds.width };
          }),
        };
      });

      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.rowRight).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.controlBounds.length).toBeGreaterThan(0);
      expect(geometry.controlBounds.every((control) =>
        control.width > 0 && control.left >= 0 && control.right <= geometry.viewportWidth
      )).toBe(true);
    });
  });
});
