/**
 * Playwright runtime smoke tests for the CSV import renderer workflow.
 *
 * These tests launch the built Electron app and verify:
 *   - Scenario 1: Importing the supported synthetic CSV from the renderer reports success
 *     and updates the monthly dashboard totals for the fixture month (AC-1, AC-2, AC-4).
 *   - Scenario 2: Importing an unsupported CSV shape reports validation errors and preserves
 *     the pre-import dashboard state (AC-1, AC-3).
 *   - Scenario 3: The import workflow runs under the network guard with no outbound calls (AC-2).
 *
 * Framework boundary:
 *   Vitest   -- unit, integration, and Vitest e2e smoke tests (tests/e2e/)
 *   Playwright -- Electron runtime flow validation (this file)
 *
 * Prerequisites: `npm run test:e2e:playwright` runs `npm run build` automatically via the
 * pretest script. To run manually first: `npm run build && npm run test:e2e:playwright`.
 */

import { test, expect } from "./fixtures/electron.js";
import type { Request } from "@playwright/test";
import { join, resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");

/** Writes a minimal invalid CSV to a temp file and returns the absolute path. */
function writeInvalidCsvFixture(): string {
  const dir = join(tmpdir(), "budget-playwright-csv");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `invalid-${randomUUID()}.csv`);
  writeFileSync(path, "Wrong;Headers;Only\nval1;val2;val3\n", "utf8");
  return path;
}

function writeAliasHeaderCsvFixture(): string {
  const dir = join(tmpdir(), "budget-playwright-csv");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `aliases-${randomUUID()}.csv`);
  writeFileSync(
    path,
    "Date;Description;Amount Out;Currency\n28.05.2026;ALIAS HEADER MERCHANT;-12.34;NOK\n",
    "utf8"
  );
  return path;
}

function writeCustomHeaderCsvFixture(): string {
  const dir = join(tmpdir(), "budget-playwright-csv");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `custom-${randomUUID()}.csv`);
  writeFileSync(
    path,
    "When;Payee;Debit amount;Currency code\n30.05.2026;CUSTOM MAPPED MERCHANT;-12.34;NOK\n",
    "utf8"
  );
  return path;
}

function loadPersistedTransactions(databasePath: string) {
  const ledger = createLocalLedgerDatabase({
    dbPath: databasePath,
    seedData: {
      household: {
        id: "sample-hh",
        name: "Sample Household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [
        {
          id: "sample-acc",
          householdId: "sample-hh",
          name: "Brukskonto",
          currencyCode: "NOK" as const,
        },
      ],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });

  try {
    return ledger.loadLedgerSnapshotData().transactions;
  } finally {
    ledger.close();
  }
}

test.describe("CSV import renderer workflow", () => {
  test("Scenario 1: importing the supported synthetic CSV reports success and updates dashboard totals", async ({ csvImport, dashboard }) => {
    // AC-1: import section is visible with file path input and button.
    await expect(csvImport.importSection).toBeVisible();
    await expect(csvImport.importHeading).toBeVisible();
    await expect(csvImport.filePathInput).toBeVisible();
    await expect(csvImport.importButton).toBeVisible();

    // Capture baseline dashboard income value before import.
    const monthSelector = dashboard.monthSelector;
    await monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = ((await dashboard.incomeValue.textContent()) ?? "").trim();

    // AC-1, AC-2: submit the fixture CSV path via the renderer input.
    await csvImport.submitImport(FIXTURE_PATH);

    // AC-1: success status is shown after import.
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    const statusText = await csvImport.successStatus.textContent();
    expect(statusText).toMatch(/Added 10 transactions to your ledger/i);

    // The app reloads dashboard state after successful import and remounts the import section.
    // Wait for the remounted input to clear as a stable completion signal.
    await expect(csvImport.filePathInput).toHaveValue("", { timeout: 10_000 });

    // AC-4: dashboard automatically reloads after import success;
    // wait for the monthly totals section to re-render and values to change.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryEntries.first()).toBeVisible();
    await expect
      .poll(async () => ((await dashboard.incomeValue.textContent()) ?? "").trim(), {
        timeout: 10_000,
      })
      .not.toBe(beforeIncomeText);
  });

  test("Scenario 1: common alternate CSV headers are mapped into ledger fields", async ({
    csvImport,
    databasePath,
  }) => {
    await csvImport.submitImport(writeAliasHeaderCsvFixture());

    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    const importedTransactions = loadPersistedTransactions(databasePath).filter(
      (transaction) => transaction.merchantRaw === "ALIAS HEADER MERCHANT"
    );

    expect(importedTransactions).toHaveLength(1);
    expect(importedTransactions[0]).toMatchObject({
      bookedAtIso: "2026-05-28T00:00:00Z",
      amountMinor: -1234,
      currencyCode: "NOK",
    });
  });

  test("Regression: resetting a mapped column to Automatic permits a fresh preview", async ({ csvImport }) => {
    await csvImport.filePathInput.fill(writeAliasHeaderCsvFixture());
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    const executionDate = csvImport.mappingSelect("Execution date");
    await executionDate.selectOption("Date");
    await executionDate.selectOption("");
    await csvImport.importButton.click();

    await expect(csvImport.previewRegion).toBeVisible();
    await expect(csvImport.confirmImportButton).toBeEnabled();
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toContainText("Added 1 transaction to your ledger");
  });

  test("Regression: reference mapping avoids duplicating old rows in an extended CSV", async ({
    csvImport,
    databasePath,
  }) => {
    const filePath = join(tmpdir(), `reference-${randomUUID()}.csv`);
    const header = "Date;Description;Amount Out;Currency;Transaction ID";
    writeFileSync(filePath, `${header}\n23.05.2026;KIWI;-12.50;NOK;BANK-100`, "utf8");

    await csvImport.filePathInput.fill(filePath);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();
    await csvImport.mappingSelect("Execution date").selectOption("Date");
    await csvImport.mappingSelect("Description").selectOption("Description");
    await csvImport.mappingSelect("Amount out").selectOption("Amount Out");
    await csvImport.mappingSelect("Currency").selectOption("Currency");
    await csvImport.mappingSelect("Reference").selectOption("Transaction ID");
    await csvImport.importButton.click();
    await expect(csvImport.confirmImportButton).toBeEnabled();
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toContainText("Added 1 transaction to your ledger");

    writeFileSync(filePath, `${header}\n23.05.2026;KIWI;-12.50;NOK;BANK-100\n23.05.2026;KIWI;-12.50;NOK;BANK-200`, "utf8");
    await csvImport.filePathInput.fill(filePath);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();
    await csvImport.mappingSelect("Execution date").selectOption("Date");
    await csvImport.mappingSelect("Description").selectOption("Description");
    await csvImport.mappingSelect("Amount out").selectOption("Amount Out");
    await csvImport.mappingSelect("Currency").selectOption("Currency");
    await csvImport.mappingSelect("Reference").selectOption("Transaction ID");
    await csvImport.importButton.click();
    await expect(csvImport.confirmImportButton).toBeEnabled();
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toContainText("Added 1 transaction to your ledger. 1 duplicate skipped.");

    expect(loadPersistedTransactions(databasePath).filter((transaction) => transaction.merchantRaw === "KIWI")).toHaveLength(2);
  });

  test("Scenario 1: user-defined CSV column mapping imports arbitrary headers", async ({ csvImport }) => {
    await csvImport.filePathInput.fill(writeCustomHeaderCsvFixture());
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    await csvImport.mappingSelect("Execution date").selectOption("When");
    await csvImport.mappingSelect("Description").selectOption("Payee");
    await csvImport.mappingSelect("Amount out").selectOption("Debit amount");
    await csvImport.mappingSelect("Currency").selectOption("Currency code");
    await csvImport.importButton.click();

    await expect(csvImport.previewRegion).toBeVisible();
    await expect(csvImport.confirmImportButton).toBeEnabled();
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toContainText("Added 1 transaction to your ledger");
  });

  test("Regression: successful import keeps success feedback visible before and after dashboard refresh", async ({ csvImport }) => {
    await expect(csvImport.importSection).toBeVisible();

    await csvImport.submitImport(FIXTURE_PATH);

    // Regression guard for the previous refresh race: success feedback must be observable.
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.successStatus).toContainText(/Added 10 transactions to your ledger/i);

    // Refresh now runs without tearing down the section and clears the input for next import.
    await expect(csvImport.filePathInput).toHaveValue("", { timeout: 10_000 });
    await expect(csvImport.importSection).toBeVisible();
  });

  test("Regression: refresh failure preserves the loaded dashboard and shows recovery feedback", async ({ csvImport, dashboard, electronApp, window }) => {
    await expect(dashboard.monthlyTotalsSection).toBeVisible();

    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"] = "1";
    });

    await csvImport.submitImport(FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(dashboard.monthlyTotalsSection).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.importSection).toBeVisible();
    await expect(window.getByRole("alert")).toContainText("Review refresh failed");
    await expect(window.getByRole("alert")).toContainText("Synthetic dashboard refresh failure.");
  });

  test("Regression: successful import preserves the currently selected month", async ({ csvImport, dashboard }) => {
    const selectedMonth = await dashboard.selectDifferentMonth("2026-05");

    await csvImport.submitImport(FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.filePathInput).toHaveValue("", { timeout: 10_000 });
    await expect(dashboard.monthSelector).toHaveValue(selectedMonth, { timeout: 10_000 });
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
  });

  test("Regression: importing the same CSV twice does not duplicate persisted transactions", async ({
    csvImport,
    dashboard,
    databasePath,
  }) => {
    const incomeBeforeImport = ((await dashboard.incomeValue.textContent()) ?? "").trim();
    await csvImport.submitImport(FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    const transactionsAfterFirstImport = loadPersistedTransactions(databasePath);
    await expect
      .poll(async () => ((await dashboard.incomeValue.textContent()) ?? "").trim(), { timeout: 10_000 })
      .not.toBe(incomeBeforeImport);
    const incomeAfterFirstImport = ((await dashboard.incomeValue.textContent()) ?? "").trim();

    await csvImport.submitImport(FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.successStatus).toContainText("Added 0 transactions to your ledger. 10 duplicates skipped.");
    const transactionsAfterSecondImport = loadPersistedTransactions(databasePath);

    expect(transactionsAfterSecondImport).toEqual(transactionsAfterFirstImport);
    await expect(dashboard.incomeValue).toHaveText(incomeAfterFirstImport);
  });

  test("Scenario 2: importing an unsupported CSV shape reports validation errors and leaves dashboard unchanged", async ({ csvImport, dashboard }) => {
    // Ensure dashboard is in a known state before the invalid import.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";

    const invalidPath = writeInvalidCsvFixture();

    // AC-1, AC-3: submit invalid CSV path via renderer input.
    await csvImport.submitImport(invalidPath);

    // AC-3: alert with validation failure is shown.
    await expect(csvImport.errorAlert).toBeVisible({ timeout: 10_000 });
    const alertText = await csvImport.errorAlert.textContent();
    expect(alertText).toMatch(/failed/i);

    // AC-4: dashboard totals remain unchanged after a failed import.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const afterIncomeText = (await dashboard.incomeValue.textContent()) ?? "";
    expect(afterIncomeText).toBe(beforeIncomeText);
  });

  test("Regression: a missing CSV path reports a file-read failure", async ({ csvImport }) => {
    const missingPath = join(tmpdir(), `missing-${randomUUID()}.csv`);

    await csvImport.submitImport(missingPath);

    await expect(csvImport.errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.errorAlert).toContainText(missingPath);
  });

  test("Regression: CSV confirmation rejects a file changed after preview", async ({
    csvImport,
    dashboard,
  }) => {
    const mutablePath = join(tmpdir(), `mutable-${randomUUID()}.csv`);
    writeFileSync(mutablePath, readFileSync(FIXTURE_PATH));
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";
    const beforeExpenseText = (await dashboard.expenseValue.textContent()) ?? "";
    const beforeNetText = (await dashboard.netValue.textContent()) ?? "";

    await csvImport.filePathInput.fill(mutablePath);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    writeFileSync(mutablePath, `${readFileSync(FIXTURE_PATH, "utf8")}changed after preview\n`, "utf8");
    await csvImport.confirmImportButton.click();

    await expect(csvImport.errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.errorAlert).toContainText("Import validation failed");
    await expect(csvImport.errorAlert).toContainText("The file changed after preview.");
    await expect(dashboard.incomeValue).toHaveText(beforeIncomeText);
    await expect(dashboard.expenseValue).toHaveText(beforeExpenseText);
    await expect(dashboard.netValue).toHaveText(beforeNetText);
  });

  test("Regression: CSV import rejects an account outside the household", async ({ window }) => {
    const response = await window.evaluate(async (filePath) =>
      (globalThis as unknown as Window).budgetApi.import.importCsv({ filePath, previewId: "unused", accountId: "other-household-account" }),
      FIXTURE_PATH
    );

    expect(response).toMatchObject({
      ok: false,
      errors: [{ codes: ["INVALID_ACCOUNT_ID"] }],
    });
  });

  test("Scenario 3: CSV import does not emit renderer network requests", async ({ csvImport, window }) => {
    const outboundRequests: string[] = [];
    const onRequest = (request: Request): void => {
      const requestUrl = new URL(request.url());
      if (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") {
        outboundRequests.push(requestUrl.href);
      }
    };

    window.on("request", onRequest);
    try {
      await csvImport.submitImport(FIXTURE_PATH);
      await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    } finally {
      window.off("request", onRequest);
    }

    expect(outboundRequests).toHaveLength(0);
  });
});
