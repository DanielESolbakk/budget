import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import type { ElectronApplication, Page } from "@playwright/test";
import { CsvImportPage } from "./pom/CsvImportPage.js";
import { PdfImportPage } from "./pom/PdfImportPage.js";
import { LedgerPage } from "./pom/LedgerPage.js";
import { ReviewQueuePage } from "./pom/ReviewQueuePage.js";
import { OnboardingPage } from "./pom/OnboardingPage.js";
import { test, expect } from "./fixtures/electron.js";

const SYNTHETIC_STATEMENT_PATH = join(
  process.cwd(),
  "tests",
  "fixtures",
  "synthetic",
  "rogaland-2026-05-synthetic.csv"
);

function readDatabase<T>(databasePath: string, sql: string): T {
  const database = new DatabaseSync(databasePath);
  try {
    const row = database.prepare(sql).get() as T | undefined;
    if (row === undefined) throw new Error(`Expected a database row for query: ${sql}`);
    return row;
  } finally {
    database.close();
  }
}

function transactionCount(databasePath: string): number {
  const row = readDatabase<{ count: number }>(
    databasePath,
    "SELECT COUNT(*) AS count FROM transactions"
  );
  return row.count;
}

async function setWindowSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const browserWindow = BrowserWindow.getAllWindows()[0];
    if (browserWindow === undefined) throw new Error("Electron window is unavailable.");
    browserWindow.setContentSize(size.width, size.height);
  }, { width, height });
}

async function expectNoOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  )).toBeLessThanOrEqual(0);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
test.describe(`first statement import after setup at ${viewport.width}px`, () => {
  test.use({
    databaseSeed: "empty",
    importFileDialogBehavior: "csv-selected",
  });

  test("previews before saving, imports to the created account, and offers the ledger", async ({
    appShell,
    databasePath,
    electronApp,
    window,
  }) => {
    const onboarding = new OnboardingPage(window);
    await setWindowSize(electronApp, viewport.width, viewport.height);
    await expect(onboarding.heading).toBeVisible();
    await onboarding.submit("Test Household", "Checking", "NOK");
    await expect(onboarding.heading).toBeHidden();
    await expect(appShell.workspace("Import")).toBeVisible();
    await expect(appShell.workspace("Import").getByRole("heading", { name: "Import", exact: true }))
      .toBeFocused();
    await expect(window.getByRole("navigation", { name: "Activity views" })).toHaveCount(0);
    await expect(appShell.workspace("Import").getByRole("group", { name: "Import sections" })).toHaveCount(0);
    await expect(appShell.workspace("Import").getByRole("button", { name: "Explore other workspaces" }))
      .toBeVisible();
    await expectNoOverflow(window);

    const account = readDatabase<{ id: string; household_id: string }>(
      databasePath,
      "SELECT id, household_id FROM accounts"
    );
    const household = readDatabase<{ id: string }>(databasePath, "SELECT id FROM households");
    expect(account.household_id).toBe(household.id);
    await expect(appShell.workspace("Import").getByRole("status", { name: "Import household" }))
      .toHaveText("Test Household");
    await expect(appShell.workspace("Import")).not.toContainText(household.id);
    await expect(appShell.workspace("Import").getByRole("combobox", { name: "Import into account", exact: true }))
      .toHaveValue(account.id);
    await expect(appShell.workspace("Import").getByRole("status", { name: "Import destination" }))
      .toHaveText("Checking · NOK");
    expect(transactionCount(databasePath)).toBe(0);

    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("CSV statement");
    const csvImport = new CsvImportPage(window);
    await expect(csvImport.importHeading).toBeVisible();
    await csvImport.enterFilePath(SYNTHETIC_STATEMENT_PATH);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    await expect(csvImport.accountSelect).toHaveValue(account.id);
    await expect(csvImport.accountSelect).toContainText("Checking");
    expect(transactionCount(databasePath)).toBe(0);
    await expectNoOverflow(window);

    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toContainText("Added 14 transactions to your ledger");
    await expect(window.getByRole("navigation", { name: "Activity views" })).toBeVisible();
    await expect(appShell.workspace("Import")).toBeVisible();
    const result = csvImport.resultSummary;
    await expect(result).toBeVisible();
    await expect(result).toContainText("Checking");
    await expect(result).toContainText("0 duplicate rows skipped.");
    expect(transactionCount(databasePath)).toBe(14);
    expect(readDatabase<{ count: number }>(databasePath,
      "SELECT COUNT(*) AS count FROM transactions WHERE account_id != (SELECT id FROM accounts)"
    ).count).toBe(0);
    await expectNoOverflow(window);

    await csvImport.openLedger();
    await expect(appShell.workspace("Transactions")).toBeVisible();
    await expect(appShell.workspace("Transactions").getByRole("heading", { name: "Transactions", exact: true }))
      .toBeFocused();
    const ledger = new LedgerPage(window);
    await expect(ledger.table.getByRole("row")).toHaveCount(15);
    await appShell.openWorkspace("Import");
    await expect(csvImport.successStatus).toContainText("Added 14 transactions");
    await csvImport.openCategoryReview();
    const review = new ReviewQueuePage(window);
    await expect(review.section).toBeVisible();
    await expect(review.firstCategorySelect).toBeFocused();
    await appShell.openWorkspace("Import");
    await expect(result).toContainText("Checking");
    await expect(csvImport.successStatus).toContainText("Added 14 transactions");
  });

  test("cancels the first statement preview without saving transactions", async ({
    databasePath,
    appShell,
    electronApp,
    window,
  }) => {
    const onboarding = new OnboardingPage(window);
    await setWindowSize(electronApp, viewport.width, viewport.height);
    await expect(onboarding.heading).toBeVisible();
    await onboarding.submit("Test Household", "Checking", "NOK");
    await expect(onboarding.heading).toBeHidden();

    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("CSV statement");
    const csvImport = new CsvImportPage(window);
    await csvImport.enterFilePath(SYNTHETIC_STATEMENT_PATH);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();
    expect(transactionCount(databasePath)).toBe(0);

    await window.getByRole("button", { name: "Cancel import", exact: true }).click();
    await expect(csvImport.previewRegion).not.toBeVisible();
    await expect(window.getByRole("status").filter({
      hasText: "Import cancelled. No transactions were saved.",
    })).toBeVisible();
    expect(transactionCount(databasePath)).toBe(0);
  });

  test("imports a digital PDF into an explicitly chosen account", async ({
    appShell, databasePath, electronApp, window,
  }) => {
    await setWindowSize(electronApp, viewport.width, viewport.height);
    const onboarding = new OnboardingPage(window);
    await onboarding.submit("Test Household", "Checking", "NOK");
    await expect(appShell.workspace("Import")).toBeVisible();
    const database = new DatabaseSync(databasePath);
    try {
      database.prepare(`
        INSERT INTO accounts (id, household_id, name, currency_code)
        SELECT 'second-account', id, 'Savings', 'NOK' FROM households
      `).run();
    } finally {
      database.close();
    }
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_IMPORT_FILE_DIALOG"] = "pdf-selected";
    });
    await window.reload();
    await expect(appShell.workspace("Review")).toBeVisible();
    await appShell.openWorkspace("Import");
    await appShell.workspace("Import").getByRole("combobox", { name: "Import into account", exact: true })
      .selectOption("second-account");
    await expect(appShell.workspace("Import").getByRole("status", { name: "Import destination" }))
      .toHaveText("Savings · NOK");
    await appShell.selectImportFormat("Digital PDF");
    const pdfImport = new PdfImportPage(window);
    await expect(pdfImport.accountSelect).toContainText("Checking");
    await expect(pdfImport.accountSelect).toContainText("Savings");
    await expect(pdfImport.accountSelect).toHaveValue("second-account");
    await pdfImport.preview(join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-05-binary.pdf"));
    await expect(pdfImport.previewRegion).toBeVisible();
    await expect(pdfImport.accountSelect).toHaveValue("second-account");
    expect(transactionCount(databasePath)).toBe(0);
    await expectNoOverflow(window);
    await pdfImport.confirmImportButton.click();
    await expect(pdfImport.successStatus).toContainText("Added 2 transactions");
    await expect(pdfImport.resultSummary).toContainText("Savings");
    await expect(pdfImport.resultSummary).toContainText("0 duplicate rows skipped.");
    expect(transactionCount(databasePath)).toBe(2);
    expect(readDatabase<{ count: number }>(databasePath,
      "SELECT COUNT(*) AS count FROM transactions WHERE account_id = 'second-account'"
    ).count).toBe(2);
    await pdfImport.openLedger();
    await expect(appShell.workspace("Transactions")).toBeVisible();
    await expect(new LedgerPage(window).table.getByRole("row")).toHaveCount(3);
    await appShell.openWorkspace("Import");
    await expect(pdfImport.successStatus).toContainText("Added 2 transactions");
    await expect(pdfImport.resultSummary).toContainText("Savings");
    await expectNoOverflow(window);
  });

  test("reports duplicate-only completion without adding transactions", async ({
    appShell, databasePath, electronApp, window,
  }) => {
    await setWindowSize(electronApp, viewport.width, viewport.height);
    await new OnboardingPage(window).submit("Test Household", "Checking", "NOK");
    await expect(appShell.workspace("Import")).toBeVisible();
    await appShell.selectImportFormat("CSV statement");
    const csvImport = new CsvImportPage(window);
    await csvImport.preview(SYNTHETIC_STATEMENT_PATH);
    await expect(csvImport.previewRegion).toBeVisible();
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toContainText("Added 14 transactions");
    await csvImport.chooseFileButton.click();
    await csvImport.preview(SYNTHETIC_STATEMENT_PATH);
    await expect(csvImport.previewRegion).toBeVisible();
    await expect(csvImport.confirmImportButton).toBeDisabled();
    await csvImport.skipAllDuplicates();
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toHaveText("No new transactions were added.");
    await expect(csvImport.resultSummary).toContainText("14 duplicate rows skipped.");
    expect(transactionCount(databasePath)).toBe(14);
    await expectNoOverflow(window);
  });

  test("retains input after validation and import failure and allows retry", async ({
    appShell, databasePath, electronApp, window,
  }) => {
    await setWindowSize(electronApp, viewport.width, viewport.height);
    await new OnboardingPage(window).submit("Test Household", "Checking", "NOK");
    await expect(appShell.workspace("Import")).toBeVisible();
    await appShell.selectImportFormat("CSV statement");
    const csvImport = new CsvImportPage(window);
    const unavailablePath = `${databasePath}.missing.csv`;
    await csvImport.preview(unavailablePath);
    await expect(csvImport.errorAlert).toBeVisible();
    await expect(csvImport.filePathInput).toHaveValue(unavailablePath);
    expect(transactionCount(databasePath)).toBe(0);

    const malformedPath = `${databasePath}.invalid.csv`;
    writeFileSync(malformedPath, "Date;Description;Amount Out;Currency\nnot-a-date;SYNTHETIC INVALID;-12.34;NOK\n");
    await csvImport.preview(malformedPath);
    await expect(csvImport.previewRegion).toBeVisible();
    await expect(csvImport.previewRegion).toContainText("0 of 1 rows ready");
    await expect(csvImport.filePathInput).toHaveValue(malformedPath);
    expect(transactionCount(databasePath)).toBe(0);

    await csvImport.preview(SYNTHETIC_STATEMENT_PATH);
    await expect(csvImport.previewRegion).toBeVisible();
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`CREATE TRIGGER reject_first_import BEFORE INSERT ON transactions
        BEGIN SELECT RAISE(ABORT, 'Synthetic import failure'); END`);
    } finally {
      database.close();
    }
    await csvImport.confirmImportButton.click();
    await expect(csvImport.errorAlert).toContainText("Synthetic import failure");
    await expect(csvImport.filePathInput).toHaveValue(SYNTHETIC_STATEMENT_PATH);
    expect(transactionCount(databasePath)).toBe(0);
    const retryDatabase = new DatabaseSync(databasePath);
    try {
      retryDatabase.exec("DROP TRIGGER reject_first_import");
    } finally {
      retryDatabase.close();
    }
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toContainText("Added 14 transactions");
    expect(transactionCount(databasePath)).toBe(14);
    await expectNoOverflow(window);
  });
});
}

test.describe("optional first-import guidance", () => {
  test.use({ databaseSeed: "empty" });
  test("lets a first-time user reveal the normal workspace navigation without importing", async ({
    appShell, window, databasePath, electronApp,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (browserWindow === undefined) throw new Error("Electron window is unavailable.");
      browserWindow.setContentSize(1280, 800);
      browserWindow.webContents.setZoomFactor(2);
    });
    await new OnboardingPage(window).submit("H".repeat(100), "Checking", "NOK");
    await expect(appShell.workspace("Import")).toBeVisible();
    await expect(window.locator(".header-import-action")).toBeHidden();
    await expect.poll(() => window.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(0);
    const pickerSize = await appShell.workspace("Import").getByRole("button", { name: "Choose statement file", exact: true }).boundingBox();
    expect(pickerSize?.width).toBeGreaterThanOrEqual(44);
    expect(pickerSize?.height).toBeGreaterThanOrEqual(44);
    await appShell.workspace("Import").getByRole("button", { name: "Explore other workspaces" }).click();
    await expect(window.getByRole("navigation", { name: "Activity views" })).toBeVisible();
    await expect(appShell.workspace("Import").getByRole("group", { name: "Import sections" })).toBeVisible();
    await expect(window.getByRole("heading", { name: "Import", exact: true })).toBeFocused();
    expect(transactionCount(databasePath)).toBe(0);
  });
});

test("explains household-context loading failure and retries against the real ledger", async ({
  appShell, databasePath,
}) => {
  await expect(appShell.workspace("Review")).toBeVisible();
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      ALTER TABLE accounts RENAME TO readable_accounts;
      CREATE VIEW accounts AS SELECT * FROM missing_accounts;
    `);
  } finally {
    database.close();
  }
  await appShell.openWorkspace("Import");
  await expect(appShell.workspace("Import").getByRole("alert")).toContainText("missing_accounts");
  const restoredDatabase = new DatabaseSync(databasePath);
  try {
    restoredDatabase.exec("DROP VIEW accounts; ALTER TABLE readable_accounts RENAME TO accounts;");
  } finally {
    restoredDatabase.close();
  }
  await appShell.workspace("Import").getByRole("button", { name: "Retry household loading" }).click();
  await expect(appShell.workspace("Import").getByRole("alert")).toHaveCount(0);
  await expect(appShell.workspace("Import").getByRole("status", { name: "Import household" }))
    .toHaveText("Sample Household");
});
