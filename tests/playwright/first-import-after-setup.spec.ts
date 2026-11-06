import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { CsvImportPage } from "./pom/CsvImportPage.js";
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

test.describe("first statement import after setup", () => {
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
    await expect(onboarding.heading).toBeVisible();
    await onboarding.submit("Test Household", "Checking", "NOK");
    await expect(onboarding.heading).toBeHidden();
    await electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (browserWindow === undefined) throw new Error("Electron window is unavailable.");
      browserWindow.setContentSize(390, 844);
    });
    await expect.poll(() => window.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(0);

    const account = readDatabase<{ id: string; household_id: string }>(
      databasePath,
      "SELECT id, household_id FROM accounts"
    );
    const household = readDatabase<{ id: string }>(databasePath, "SELECT id FROM households");
    expect(account.household_id).toBe(household.id);
    expect(transactionCount(databasePath)).toBe(0);

    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("CSV statement");
    const csvImport = new CsvImportPage(window);
    await expect(csvImport.importHeading).toBeVisible();
    await csvImport.enterFilePath(SYNTHETIC_STATEMENT_PATH);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    const importAccount = csvImport.importSection.getByRole("combobox", {
      name: "Import into account",
    });
    await expect(importAccount).toHaveValue(account.id);
    expect(transactionCount(databasePath)).toBe(0);

    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toContainText("Added 14 transactions to your ledger");
    await expect(appShell.workspace("Import")).toBeVisible();
    const result = csvImport.importSection.getByRole("region", {
      name: "Import result summary",
    });
    await expect(result).toBeVisible();
    await expect(result).toContainText("Checking");
    expect(transactionCount(databasePath)).toBe(14);

    await csvImport.importSection.getByRole("button", { name: "Return to ledger" }).click();
    await expect(appShell.workspace("Transactions")).toBeVisible();
  });

  test("cancels the first statement preview without saving transactions", async ({
    databasePath,
    appShell,
    window,
  }) => {
    const onboarding = new OnboardingPage(window);
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
});
