import { basename, join, resolve } from "node:path";
import { _electron as electron } from "@playwright/test";
import type { Request } from "@playwright/test";
import { test, expect } from "./fixtures/electron.js";
import { DatabaseSync } from "node:sqlite";
import type { BudgetApi } from "../../src/renderer/preload.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { CsvImportPage } from "./pom/CsvImportPage.js";
import { ImportReviewPage } from "./pom/ImportReviewPage.js";
import { LedgerPage } from "./pom/LedgerPage.js";
import { PdfImportPage } from "./pom/PdfImportPage.js";
import { installMainProcessFetchProbe, mainProcessFetchRequests } from "./helpers/networkProbe.js";

const CSV_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");
const TEXT_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt");
const PDF_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-binary.pdf");
const MIXED_CSV_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/import-review/import-review-mixed.csv");
const MIXED_TEXT_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/import-review/import-review-mixed.txt");
const MIXED_PDF_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/import-review/import-review-mixed.pdf");
const TWO_UNRESOLVED_CSV_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/import-review/import-review-two-unresolved.csv");
const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

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

      await expect(window.getByRole("button", { name: "Choose statement file", exact: true })).toBeVisible();
      await expect(window.getByRole("button", { name: "CSV statement", exact: true })).toHaveCount(0);
      await importReview.chooseStatementFile();

      await expect(window.getByRole("region", { name: "CSV Import", exact: true })).toBeVisible();
      await expect(window.getByText(basename(CSV_PATH), { exact: true })).toBeVisible();
    });
  });

  test.describe("text statement selection", () =>
    test.use({ importFileDialogBehavior: "text-selected" });

    test("routes a selected text statement through the shared import action", async ({ appShell, window }) => {
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);

      await expect(window.getByRole("button", { name: "Choose statement file", exact: true })).toBeVisible();
      await importReview.chooseStatementFile();

      await expect(window.getByRole("region", { name: "Digital statement import", exact: true })).toBeVisible();
      await expect(window.getByText(basename(TEXT_PATH), { exact: true })).toBeVisible();
    });
  });

  test.describe("binary PDF selection", () =>
    test.use({ importFileDialogBehavior: "pdf-selected" });

    test("routes a selected binary PDF through the shared import action", async ({ appShell, window }) =>
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);

      await expect(window.getByRole("button", { name: "Choose statement file", exact: true })).toBeVisible();
      await importReview.chooseStatementFile();

      await expect(window.getByRole("region", { name: "Digital statement import", exact: true })).toBeVisible();
      await expect(window.getByText(basename(PDF_PATH), { exact: true })).toBeVisible();
    });
  });

  test.describe("unresolved CSV rows", () =>
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
      await expect(csvImport.errorAlert).not.toBeVisible();
      await expect(csvImport.importSection.getByText("1 row was sent to review during import.", { exact: true })).toBeVisible();

      await importReview.openReviewQueue();
      const reviewQueue = importReview.reviewQueue;
      await expect(reviewQueue).toBeVisible();
      const reviewRow = importReview.reviewRow(2);
      await expect(reviewRow.getByLabel("Transaction date", { exact: true })).not.toBeVisible();
      await importReview.openCorrection(2);
      await expect(reviewRow).toContainText("SYNTHETIC UNRESOLVED ROW");
      await expect(reviewRow.getByText("Review the date and amount.", { exact: true })).toBeVisible();
      const parserDiagnostics = reviewRow.getByRole("list", { name: "Parser diagnostics" });
      await expect(parserDiagnostics).not.toBeVisible();
      await reviewRow.getByText("Why this row needs review (2)", { exact: true }).click();
      await expect(parserDiagnostics).toContainText("Execution date: Add a booked date or an execution date.");
      await expect(parserDiagnostics).toContainText("Amount out: Enter a valid amount. Check the original source row.");
      await reviewRow.getByText("Original source row", { exact: true }).click();
      await expect(reviewRow).toContainText('"Date":""');
      await expect(reviewRow.getByText("Use the booked date when available; otherwise use the execution date.", { exact: true }))
        .toBeVisible();
      await expect(reviewRow.getByText(
        "Enter income as a positive amount and spending as a negative amount.",
        { exact: true }
      )).toBeVisible();
      await importReview.correctRow(2, {
        date: "2026-05-19",
        amount: "-9.99",
        merchant: "SYNTHETIC CORRECTED ROW",
        accountId: "sample-acc",
        currency: "NOK",
      });

      await expect(reviewRow).not.toBeVisible();
      const reviewedHistory = importReview.reviewedHistoryDisclosure;
      await expect(reviewedHistory).toBeVisible();
      await reviewedHistory.click();
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

    test("refreshes dashboard and ledger after correction without duplicates or network requests", async ({
      appShell,
      csvImport,
      databasePath,
      dashboard,
      electronApp,
      window,
    }) => {
      const ledger = new LedgerPage(window);
      const rendererRequests: string[] = [];
      const onRequest = (request: Request): void => {
        if (/^https?:/i.test(request.url())) rendererRequests.push(request.url());
      };
      window.on("request", onRequest);
      await installMainProcessFetchProbe(electronApp);

      try {
        await appShell.openWorkspace("Transactions");
        await expect(ledger.table).toBeVisible();
        await appShell.openWorkspace("Import");

        const importReview = new ImportReviewPage(window);
        await importReview.chooseStatementFile();
        await csvImport.enterFilePath(MIXED_CSV_PATH);
        await csvImport.importButton.click();
        await expect(csvImport.previewRegion).toBeVisible();
        await csvImport.confirmImportButton.click();
        await expect(csvImport.successStatus).toContainText("Added 1 transaction to your ledger.");

        await appShell.openWorkspace("Review");
        await dashboard.monthSelector.selectOption("2026-05");
        await expect(dashboard.monthSelector).toHaveValue("2026-05");
        const expensesBeforeCorrection = await dashboard.expenseValue.textContent();

        await appShell.openWorkspace("Import");
        await importReview.openReviewQueue();
        await importReview.correctRow(2, {
          date: "2026-05-19",
          amount: "-9.99",
          merchant: "SYNTHETIC LEDGER REFRESH ROW",
          accountId: "sample-acc",
          currency: "NOK",
        });

        const database = new DatabaseSync(databasePath);
        let correctedReviewItemId: string | undefined;
        try {
          const row = database.prepare(
            "SELECT id FROM import_review_items WHERE status = 'corrected' AND raw_row LIKE ?"
          ).get("%SYNTHETIC UNRESOLVED ROW%") as { id: string } | undefined;
          correctedReviewItemId = row?.id;
        } finally {
          database.close();
        }
        if (correctedReviewItemId === undefined) {
          throw new Error("Corrected import review item was not persisted.");
        }

        const repeatedCorrectionSucceeded = await window.evaluate(async (reviewItemId) => {
          const api = (globalThis as typeof globalThis & { budgetApi: BudgetApi }).budgetApi;
          const result = await api.import.review.correct({
            reviewItemId,
            correction: {
              bookedAtIso: "2026-05-19",
              amountMinor: -999,
              merchantRaw: "SYNTHETIC LEDGER REFRESH ROW",
              accountId: "sample-acc",
              currencyCode: "NOK",
            },
          });
          return result.ok;
        }, correctedReviewItemId);
        expect(repeatedCorrectionSucceeded).toBe(true);

        const databaseAfterRetry = new DatabaseSync(databasePath);
        try {
          const correctedRows = databaseAfterRetry.prepare(
            "SELECT id FROM transactions WHERE merchant_raw = ?"
          ).all("SYNTHETIC LEDGER REFRESH ROW");
          expect(correctedRows).toHaveLength(1);
        } finally {
          databaseAfterRetry.close();
        }

        await appShell.openWorkspace("Transactions");
        await expect(ledger.transactionsFor("SYNTHETIC LEDGER REFRESH ROW")).toHaveCount(1);
        await appShell.openWorkspace("Review");
        await expect(dashboard.expenseValue).not.toHaveText(expensesBeforeCorrection ?? "");
        expect(rendererRequests).toEqual([]);
        expect(await mainProcessFetchRequests(electronApp)).toEqual([]);
      } finally {
        window.off("request", onRequest);
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
      await expect(csvImport.importSection.getByText("1 row was sent to review during import.", { exact: true })).toBeVisible();

      await importReview.openReviewQueue();
      const reviewRow = importReview.reviewRow(2);
      await importReview.openDismissal(2);
      await expect(reviewRow.getByRole("button", { name: "Dismiss row", exact: true })).toBeDisabled();
      await expect(reviewRow.getByLabel("Reason for dismissal (required)", { exact: true })).toHaveAttribute("required", "");
      await expect(reviewRow.getByText(
        "Required. This reason is saved with the original row in your local review history.",
        { exact: true }
      )).toBeVisible();
      await importReview.dismissRow(2, "Not a household transaction");

      await expect(reviewRow).not.toBeVisible();
      const reviewedHistory = importReview.reviewedHistoryDisclosure;
      await expect(reviewedHistory).toBeVisible();
      await reviewedHistory.click();
      await expect(reviewRow).toContainText("Dismissed");
      await expect(reviewRow).toContainText(
        /Dismissed at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z: Not a household transaction/
      );
      const parserDiagnostics = reviewRow.getByRole("list", { name: "Parser diagnostics" });
      await expect(parserDiagnostics).not.toBeVisible();
      await reviewRow.getByText("Why this row needs review (2)", { exact: true }).click();
      await expect(parserDiagnostics).toBeVisible();
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

    test("hands unresolved imports directly to the review queue", async ({
      appShell,
      csvImport,
      window,
    }) => {
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);
      await importReview.chooseStatementFile();
      await csvImport.enterFilePath(MIXED_CSV_PATH);
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();
      await csvImport.confirmImportButton.click();
      await expect(csvImport.successStatus).toContainText("Added 1 transaction to your ledger.");

      const reviewUnresolvedButton = csvImport.importSection.getByRole("button", {
        name: "Review unresolved rows",
        exact: true,
      });
      await expect(reviewUnresolvedButton).toBeVisible();
      await reviewUnresolvedButton.focus();
      await reviewUnresolvedButton.press("Enter");
      await expect(importReview.reviewQueue).toBeInViewport();
      await expect(importReview.reviewQueue).toBeFocused();
      await expect(importReview.reviewQueue).toHaveCSS("outline-width", "3px");
      await expect(importReview.reviewRow(2)).toBeVisible();
      await expect(window.getByRole("button", { name: "Import row review", exact: true }))
        .toHaveAttribute("aria-pressed", "true");
    });

    test("keeps an unsaved correction draft when returning to the import workspace", async ({
      appShell,
      csvImport,
      window,
    }) => {
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);
      await importReview.chooseStatementFile();
      await csvImport.enterFilePath(MIXED_CSV_PATH);
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();
      await csvImport.confirmImportButton.click();
      await expect(csvImport.successStatus).toContainText("Added 1 transaction to your ledger.");

      await importReview.openReviewQueue();
      await importReview.openCorrection(2);
      const merchantInput = importReview.reviewRow(2).getByLabel("Merchant", { exact: true });
      await merchantInput.fill("UNSAVED CORRECTION DRAFT");
      await appShell.openWorkspace("Review");
      await appShell.openWorkspace("Import");

      await importReview.openCorrection(2);
      await expect(importReview.reviewRow(2).getByLabel("Merchant", { exact: true }))
        .toHaveValue("UNSAVED CORRECTION DRAFT");
    });

    test("keeps multiple unresolved forms collapsed until a row is selected", async ({
      appShell,
      csvImport,
      window,
    }) => {
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);
      await importReview.chooseStatementFile();
      await csvImport.enterFilePath(TWO_UNRESOLVED_CSV_PATH);
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();
      await csvImport.confirmImportButton.click();
      await expect(csvImport.successStatus).toContainText("No new transactions were added.");

      await importReview.openReviewQueue();
      const firstRow = importReview.reviewRow(2);
      const secondRow = importReview.reviewRow(3);
      await expect(firstRow.getByLabel("Transaction date", { exact: true })).not.toBeVisible();
      await expect(secondRow.getByLabel("Transaction date", { exact: true })).not.toBeVisible();

      await importReview.openCorrection(2);
      await expect(firstRow.getByLabel("Transaction date", { exact: true })).toBeVisible();
      await expect(secondRow.getByLabel("Transaction date", { exact: true })).not.toBeVisible();
    });

    test("restores an unsaved correction draft after restarting Electron", async ({
      appShell,
      csvImport,
      databasePath,
      electronApp,
      window,
    }) => {
      await appShell.openWorkspace("Import");
      const importReview = new ImportReviewPage(window);
      await importReview.chooseStatementFile();
      await csvImport.enterFilePath(MIXED_CSV_PATH);
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();
      await csvImport.confirmImportButton.click();
      await expect(csvImport.successStatus).toContainText("Added 1 transaction to your ledger.");
      await importReview.openReviewQueue();
      await importReview.openCorrection(2);
      await importReview.reviewRow(2).getByLabel("Merchant", { exact: true }).fill("DRAFT SURVIVES RESTART");

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
        await new AppShellPage(restartedWindow).openWorkspace("Import");
        const restartedReview = new ImportReviewPage(restartedWindow);
        await restartedReview.openReviewQueue();
        await expect(restartedReview.reviewRow(2)).toContainText("SYNTHETIC UNRESOLVED ROW");
        await restartedReview.openCorrection(2);
        await expect(restartedReview.reviewRow(2).getByLabel("Merchant", { exact: true }))
          .toHaveValue("DRAFT SURVIVES RESTART");
      } finally {
        await restartedApp.close();
      }
    });

    test.describe("unresolved text statement rows", () => {
      test.use({ importFileDialogBehavior: "text-selected" });

      test("corrects a malformed text statement row with source provenance", async ({
        appShell,
        databasePath,
        electronApp,
        window,
      }) => {
        const rendererRequests: string[] = [];
        const onRequest = (request: Request): void => {
          if (/^https?:/i.test(request.url())) rendererRequests.push(request.url());
        };
        window.on("request", onRequest);
        await installMainProcessFetchProbe(electronApp);

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
        await expect(statementImport.importSection.getByText("1 row was sent to review during import.", { exact: true })).toBeVisible();

        await importReview.openReviewQueue();
        const reviewRow = importReview.reviewRow(4);
        await expect(reviewRow).toContainText("SYNTHETIC PDF BROKEN");
        await importReview.correctRow(4, {
          date: "2026-05-27",
          amount: "-7.25",
          merchant: "SYNTHETIC PDF CORRECTED",
          accountId: "sample-acc",
          currency: "NOK",
        });
        await expect(reviewRow).not.toBeVisible();
        await importReview.reviewedHistoryDisclosure.click();
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
        expect(rendererRequests).toEqual([]);
        expect(await mainProcessFetchRequests(electronApp)).toEqual([]);
      });
    });

    test.describe("unresolved binary PDF rows", () =>
      test.use({ importFileDialogBehavior: "pdf-selected" });

      test("corrects an unresolved row extracted from a binary PDF", async ({
        appShell,
        databasePath,
        electronApp,
        window,
      }) => {
        const rendererRequests: string[] = [];
        const onRequest = (request: Request): void => {
          if (/^https?:/i.test(request.url())) rendererRequests.push(request.url());
        };
        window.on("request", onRequest);
        await installMainProcessFetchProbe(electronApp);

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
        await expect(statementImport.importSection.getByText("1 row was sent to review during import.", { exact: true })).toBeVisible();
        await statementImport.importSection.getByRole("button", {
          name: "Review unresolved rows",
          exact: true,
        }).click();
        await expect(importReview.reviewQueue).toBeInViewport();

        const reviewRow = importReview.reviewRow(7);
        await expect(reviewRow).toContainText("SYNTHETIC PDF BROKEN");
        await importReview.correctRow(7, {
          date: "2026-05-27",
          amount: "-7.25",
          merchant: "SYNTHETIC BINARY PDF CORRECTED",
          accountId: "sample-acc",
          currency: "NOK",
        });
        await expect(reviewRow).not.toBeVisible();
        await importReview.reviewedHistoryDisclosure.click();
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
        expect(rendererRequests).toEqual([]);
        expect(await mainProcessFetchRequests(electronApp)).toEqual([]);
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

      const importReview = new ImportReviewPage(window);
      await importReview.openReviewQueue();
      const reviewRow = importReview.reviewRow(2);
      await importReview.openCorrection(2);
      await expect(reviewRow.getByLabel("Transaction date", { exact: true })).toBeVisible();
      await expect(reviewRow.getByRole("button", { name: "Save corrected transaction", exact: true })).toBeVisible();
      const geometry = await reviewRow.evaluate((element) => {
        const controls = Array.from(element.querySelectorAll(
          ".import-review-resolution[open] input, .import-review-resolution[open] select, .import-review-resolution[open] textarea, .import-review-resolution[open] button"
        ));
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
