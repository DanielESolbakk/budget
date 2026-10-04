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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");
const temporaryDirectories = new Set<string>();

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "budget-playwright-csv-"));
  temporaryDirectories.add(directory);
  return directory;
}

test.afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

/** Writes a minimal invalid CSV to a temp file and returns the absolute path. */
function writeInvalidCsvFixture(): string {
  const dir = createTemporaryDirectory();
  const path = join(dir, `invalid-${randomUUID()}.csv`);
  writeFileSync(path, "Wrong;Headers;Only\nval1;val2;val3\n", "utf8");
  return path;
}

function writeAliasHeaderCsvFixture(): string {
  const dir = createTemporaryDirectory();
  const path = join(dir, `aliases-${randomUUID()}.csv`);
  writeFileSync(
    path,
    "Date;Description;Amount Out;Currency\n28.05.2026;ALIAS HEADER MERCHANT;-12.34;NOK\n",
    "utf8"
  );
  return path;
}

function writeCustomHeaderCsvFixture(): string {
  const dir = createTemporaryDirectory();
  const path = join(dir, `custom-${randomUUID()}.csv`);
  writeFileSync(
    path,
    "When;Payee;Debit amount;Currency code\n30.05.2026;CUSTOM MAPPED MERCHANT;-12.34;NOK\n",
    "utf8"
  );
  return path;
}

function writeMixedValidityCsvFixture(): string {
  const dir = createTemporaryDirectory();
  const path = join(dir, `mixed-${randomUUID()}.csv`);
  writeFileSync(
    path,
    "Date;Description;Amount Out;Currency\n28.05.2026;VALID PREVIEW ROW;-12.34;NOK\n;INVALID PREVIEW ROW;-2.00;NOK\n",
    "utf8"
  );
  return path;
}

function writeLargeCsvFixture(rowCount: number, invalidRowIndex?: number): string {
  const directory = createTemporaryDirectory();
  const path = join(directory, `large-${rowCount}.csv`);
  const rows = Array.from({ length: rowCount }, (_, index) =>
    `${index === invalidRowIndex ? "" : "23.05.2026"};LARGE STATEMENT ROW ${String(index + 1).padStart(5, "0")};-1.00;NOK`
  );
  writeFileSync(path, `Date;Description;Amount Out;Currency\n${rows.join("\n")}`, "utf8");
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
  test("cancelling a 10,000-row preflight leaves the ledger unchanged", async ({ csvImport, databasePath }) => {
    const transactionsBeforePreview = loadPersistedTransactions(databasePath);
    await csvImport.enterFilePath(writeLargeCsvFixture(10_000));
    await csvImport.importButton.click();

    const progress = csvImport.importSection.getByRole("status", { name: "Import preflight progress" });
    await expect(progress).toBeVisible();
    await expect(csvImport.importSection.getByRole("button", { name: "Cancel preview", exact: true })).toBeEnabled();
    await csvImport.importSection.getByRole("button", { name: "Cancel preview", exact: true }).click();

    await expect(progress).toContainText("Preview cancelled");
    await expect(csvImport.previewRegion).not.toBeVisible();
    expect(loadPersistedTransactions(databasePath)).toEqual(transactionsBeforePreview);
  });

  test("10,000-row preview pages stay bounded and validation identifies affected rows", async ({ csvImport }) => {
    await csvImport.enterFilePath(writeLargeCsvFixture(10_000, 500));
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    const previewTable = csvImport.previewRegion.getByRole("table", {
      name: "CSV statement preview rows and validation states",
    });
    await expect(previewTable.getByRole("row")).toHaveCount(101);
    await expect(csvImport.previewRegion.getByRole("button", { name: "Next rows", exact: true })).toBeEnabled();

    const validationReport = csvImport.previewRegion.locator("details.import-validation-report");
    await expect(validationReport).toBeVisible();
    await validationReport.getByText("Validation report", { exact: false }).click();
    await expect(validationReport).toContainText("Row 501");

    await csvImport.previewRegion.getByRole("button", { name: "Next rows", exact: true }).click();
    await expect(previewTable.getByRole("row")).toHaveCount(101);
    await expect(csvImport.previewRegion.getByText(/Rows 101-200 of 10/)).toBeVisible();
  });

  test("import history summarizes a run and requires confirmation before undo", async ({ csvImport, window }) => {
    await csvImport.submitImport(writeAliasHeaderCsvFixture());

    const history = window.getByRole("region", { name: "Import history", exact: true });
    await expect(history).toBeVisible();
    const jobRow = history.getByRole("row").nth(1);
    await expect(jobRow).toContainText("CSV");
    await expect(jobRow).toContainText("Brukskonto");
    await expect(jobRow).toContainText("1 imported");
    await expect(jobRow.getByRole("button", { name: /Undo/ })).toBeVisible();
    await jobRow.getByRole("button", { name: /Undo/ }).click();

    const confirmation = history.getByRole("group", { name: "Undo import confirmation" });
    await expect(confirmation).toContainText("unchanged transactions");
    await expect(confirmation).toContainText(/later category corrections and unrelated transactions will be kept/i);
    await confirmation.getByRole("button", { name: "Confirm undo" }).click();

    await expect(history.getByRole("status")).toContainText("Removed 1 transaction");
    await expect(history.getByRole("status")).toContainText("Retained 0 changed transactions");
  });

  test("history keeps repeated imports of the same CSV as separate runs", async ({ csvImport, window }) => {
    const filePath = writeAliasHeaderCsvFixture();
    await csvImport.submitImport(filePath);
    await csvImport.enterFilePath(filePath);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    const previewRows = csvImport.previewRegion.getByRole("table", {
      name: "CSV statement preview rows and validation states",
    }).getByRole("row").filter({ hasText: "Duplicate candidate" });
    for (const row of await previewRows.all()) {
      await row.getByRole("radio", { name: "Skip duplicate" }).check();
    }
    await csvImport.confirmImportButton.click();

    const historyTable = window.getByRole("region", { name: "Import history", exact: true })
      .getByRole("table", { name: "Completed local import jobs" });
    await expect(historyTable.getByRole("row")).toHaveCount(3);
  });

  test("CSV duplicate candidates require explicit per-row skip or import decisions", async ({ csvImport }) => {
    await csvImport.submitImport(FIXTURE_PATH);
    await csvImport.enterFilePath(FIXTURE_PATH);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    const previewTable = csvImport.previewRegion.getByRole("table", {
      name: "CSV statement preview rows and validation states",
    });
    const duplicateRows = previewTable.getByRole("row").filter({ hasText: "Duplicate candidate" });
    await expect(duplicateRows).toHaveCount(16);
    await expect(duplicateRows.first()).toContainText(/Matched by (source reference|transaction fingerprint)/);
    await expect(csvImport.confirmImportButton).toBeDisabled();

    for (const row of await duplicateRows.all()) {
      await row.getByRole("radio", { name: "Skip duplicate" }).check();
    }
    await duplicateRows.first().getByRole("radio", { name: "Import duplicate" }).check();
    await expect(csvImport.confirmImportButton).toBeEnabled();
    await csvImport.confirmImportButton.click();

    await expect(csvImport.successStatus).toHaveText("Added 1 transaction to your ledger.");
    await expect(csvImport.importSection.getByText("15 duplicate rows skipped.", { exact: true })).toBeVisible();
  });

  test("a CSV profile saves the explicit account and mapping for reuse", async ({ csvImport }) => {
    await csvImport.enterFilePath(FIXTURE_PATH);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();
    await csvImport.mappingSelect("Description").selectOption("Beskrivelse");

    const manageProfiles = csvImport.importSection.getByText("Manage CSV profiles", { exact: false });
    await expect(manageProfiles).toBeVisible();
    await manageProfiles.click();
    await csvImport.importSection.getByRole("textbox", { name: "Profile name" }).fill("Norwegian bank profile");
    await csvImport.importSection.getByRole("combobox", { name: "Profile account" }).selectOption("sample-acc");
    await csvImport.importSection.getByRole("button", { name: "Save CSV profile", exact: true }).click();

    await expect(csvImport.importSection.getByText("Norwegian bank profile", { exact: true })).toBeVisible();
    await csvImport.importSection.getByRole("button", { name: "Use profile Norwegian bank profile", exact: true }).click();
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();
    await expect(csvImport.mappingSelect("Description")).toHaveValue("Beskrivelse");
    await expect(csvImport.importSection.getByText("Import account: Brukskonto", { exact: true })).toBeVisible();

    await csvImport.importSection.getByRole("button", { name: "Delete profile Norwegian bank profile", exact: true }).click();
    await expect(csvImport.importSection.getByText("Norwegian bank profile", { exact: true })).not.toBeVisible();
  });

  test("format selection exposes only the chosen import workflow", async ({ appShell, window }) => {
    await appShell.openWorkspace("Import");
    await expect(window.getByRole("group", { name: "Choose import format" })).toBeVisible();
    await expect(window.getByRole("region", { name: "CSV Import", exact: true })).not.toBeVisible();
    await expect(window.getByRole("region", { name: "PDF Import", exact: true })).not.toBeVisible();
    await expect(window.getByRole("region", { name: "Manual Entry", exact: true })).not.toBeVisible();
    await expect(window.getByRole("button", { name: "CSV statement", exact: true })).toBeVisible();
    await window.getByRole("button", { name: "CSV statement", exact: true }).click();

    await expect(window.getByRole("region", { name: "CSV Import", exact: true })).toBeVisible();
    await expect(window.getByRole("region", { name: "PDF Import", exact: true })).not.toBeVisible();
    await expect(window.getByRole("region", { name: "Manual Entry", exact: true })).not.toBeVisible();
  });

  test("@visual Visual: import format selection stays legible in desktop and compact windows", async ({
    appShell,
    electronApp,
    window,
  }) => {
    await appShell.openWorkspace("Import");
    await window.getByRole("button", { name: "CSV statement", exact: true }).click();
    await expect(window.getByText("Manage CSV profiles (0)", { exact: true })).toBeVisible();
    const csvChoice = window.getByRole("button", { name: "CSV statement", exact: true });
    await expect(csvChoice).toHaveAttribute("aria-pressed", "true");
    await csvChoice.hover();
    const selectedColors = await csvChoice.evaluate((button) => {
      const style = getComputedStyle(button);
      return { background: style.backgroundColor, border: style.borderColor };
    });
    const inactiveColors = await window.getByRole("button", { name: "Digital PDF", exact: true }).evaluate((button) => {
      const style = getComputedStyle(button);
      return { background: style.backgroundColor, border: style.borderColor };
    });
    expect(selectedColors.background).not.toBe(inactiveColors.background);
    expect(selectedColors.border).not.toBe(inactiveColors.border);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await expect(window).toHaveScreenshot("import-workspace-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });
    const compactDimensions = await window.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      formatOptionsHeight: document.querySelector(".import-format-options")?.getBoundingClientRect().height ?? 0,
      choiceHeights: [...document.querySelectorAll(".import-format-choice")].map((choice) =>
        choice.getBoundingClientRect().height
      ),
    }));
    expect(compactDimensions.documentWidth).toBeLessThanOrEqual(compactDimensions.viewportWidth);
    expect(compactDimensions.choiceHeights).toHaveLength(3);
    expect(compactDimensions.choiceHeights.every((height) => height >= 44)).toBe(true);
    expect(compactDimensions.formatOptionsHeight).toBeLessThanOrEqual(112);
    await expect(window).toHaveScreenshot("import-workspace-compact.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.015,
    });
  });

  test.describe("native CSV file selection", () => {
    test.use({ importFileDialogBehavior: "csv-selected" });

    test("choosing a CSV file makes it the statement being previewed", async ({ csvImport, window }) => {
      await csvImport.chooseFileButton.click();

      await expect(window.getByText(FIXTURE_PATH, { exact: true })).toBeVisible();
      await expect(csvImport.importButton).toBeEnabled();
    });

    test("a valid preview marks earlier stages complete and confirmation as the next action", async ({ csvImport }) => {
      await csvImport.chooseFileButton.click();
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();

      const stages = csvImport.importSection.getByRole("list", { name: "CSV import progress" }).getByRole("listitem");
      await expect(stages).toHaveCount(4);
      await expect(stages.nth(0)).toHaveAttribute("data-state", "complete");
      await expect(stages.nth(1)).toHaveAttribute("data-state", "complete");
      await expect(stages.nth(2)).toHaveAttribute("aria-current", "step");
      await expect(csvImport.confirmImportButton).toBeEnabled();
    });

    test("a successful import offers a direct route to review or the ledger", async ({ appShell, csvImport, window }) => {
      await csvImport.chooseFileButton.click();
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();
      await csvImport.confirmImportButton.click();
      await expect(csvImport.successStatus).toContainText("Added 16 transactions to your ledger");

      const stageProgress = csvImport.importSection.getByRole("navigation", { name: "CSV import stages" });
      const stages = stageProgress.getByRole("listitem");
      await expect(stages.nth(3)).toContainText("Complete");
      await expect(stageProgress.locator('[aria-current="step"]')).toHaveCount(0);

      await expect(window.getByRole("button", { name: "Review uncategorized transactions", exact: true })).toBeVisible();
      await expect(window.getByRole("button", { name: "Return to ledger", exact: true })).toBeVisible();

      await window.getByRole("button", { name: "Review uncategorized transactions", exact: true }).click();
      await expect(appShell.destination("Transactions")).toHaveAttribute("aria-current", "page");
      await expect(window.getByRole("region", { name: "Categorization Review", exact: true })).toBeVisible();
      await expect(window.getByRole("combobox", { name: /Category for/ }).first()).toBeFocused();
    });

    test("successful import reports duplicate skips separately from imported transactions", async ({ csvImport }) => {
      await csvImport.submitImport(FIXTURE_PATH);
      await expect(csvImport.successStatus).toContainText("Added 16 transactions to your ledger");

      await csvImport.enterFilePath(FIXTURE_PATH);
      await csvImport.importButton.click();
      await expect(csvImport.previewRegion).toBeVisible();
      const duplicateRows = csvImport.previewRegion.getByRole("table", {
        name: "CSV statement preview rows and validation states",
      }).getByRole("row").filter({ hasText: "Duplicate candidate" });
      await expect(duplicateRows).toHaveCount(16);
      for (const row of await duplicateRows.all()) {
        await row.getByRole("radio", { name: "Skip duplicate" }).check();
      }
      await csvImport.confirmImportButton.click();

      const result = csvImport.importSection.getByRole("region", { name: "Import result summary" });
      await expect(result.getByRole("status", { name: "Transactions imported" })).toHaveText(
        "Added 0 transactions to your ledger."
      );
      await expect(result.getByText("16 duplicate rows skipped.", { exact: true })).toBeVisible();
    });
  });

  test("mixed-validity preview keeps ready rows and links disabled confirmation to an invalid row", async ({ csvImport, databasePath }) => {
    const transactionsBeforePreview = loadPersistedTransactions(databasePath);
    await csvImport.importSection.getByText("Advanced: enter a file path", { exact: true }).click();
    await csvImport.filePathInput.fill(writeMixedValidityCsvFixture());
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    const previewTable = csvImport.previewRegion.getByRole("table", {
      name: "CSV statement preview rows and validation states",
    });
    const rows = previewTable.getByRole("row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toHaveAttribute("data-state", "ready");
    await expect(rows.nth(2)).toHaveAttribute("data-state", "invalid");
    await expect(csvImport.confirmImportButton).toBeDisabled();
    await expect(csvImport.importSection.locator("#csv-confirm-help")).toContainText("Row 2 needs attention");
    expect(loadPersistedTransactions(databasePath)).toEqual(transactionsBeforePreview);
  });

  test("CSV confirmation invalidates a file changed after preview", async ({ csvImport }) => {
    const mutablePath = join(createTemporaryDirectory(), `mutable-${randomUUID()}.csv`);
    writeFileSync(mutablePath, readFileSync(FIXTURE_PATH));
    await csvImport.enterFilePath(mutablePath);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    writeFileSync(mutablePath, `${readFileSync(FIXTURE_PATH, "utf8")}changed after preview\n`, "utf8");
    await csvImport.confirmImportButton.click();

    await expect(csvImport.errorAlert).toBeVisible();
    await expect(csvImport.confirmImportButton).toBeDisabled();
    await expect(csvImport.previewRegion).not.toBeVisible();
    await expect(csvImport.importSection.locator("#csv-confirm-help").getByRole("link", {
      name: "Preview CSV",
    })).toHaveAttribute("href", "#csv-preview-button");
  });

  test("Scenario 1: importing the supported synthetic CSV reports success and updates dashboard totals", async ({ appShell, csvImport, dashboard }) => {
    // AC-1: native file selection is primary; direct path entry stays advanced.
    await expect(csvImport.importSection).toBeVisible();
    await expect(csvImport.importHeading).toBeVisible();
    await expect(csvImport.chooseFileButton).toBeVisible();
    await expect(csvImport.filePathInput).not.toBeVisible();
    await expect(csvImport.importButton).toBeVisible();

    // Capture baseline dashboard income value before import.
    await appShell.openWorkspace("Review");
    const monthSelector = dashboard.monthSelector;
    await monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = ((await dashboard.incomeValue.textContent()) ?? "").trim();

    // AC-1, AC-2: submit the fixture CSV path via the renderer input.
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(FIXTURE_PATH);

    // AC-1: success status is shown after import.
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.successStatus).toContainText(/Added 16 transactions to your ledger/i);

    // The app reloads dashboard state after successful import and remounts the import section.
    // Wait for the remounted input to clear as a stable completion signal.
    await expect(csvImport.filePathInput).toHaveValue("", { timeout: 10_000 });

    // AC-4: dashboard automatically reloads after import success;
    // wait for the monthly totals section to re-render and values to change.
    await appShell.openWorkspace("Review");
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
    await csvImport.enterFilePath(writeAliasHeaderCsvFixture());
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
    const filePath = join(createTemporaryDirectory(), `reference-${randomUUID()}.csv`);
    const header = "Date;Description;Amount Out;Currency;Transaction ID";
    writeFileSync(filePath, `${header}\n23.05.2026;KIWI;-12.50;NOK;BANK-100`, "utf8");

    await csvImport.enterFilePath(filePath);
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
    const firstImport = loadPersistedTransactions(databasePath).filter((transaction) => transaction.merchantRaw === "KIWI");
    expect(firstImport).toHaveLength(1);
    expect(firstImport[0]?.sourceReference).toBe("BANK-100");

    writeFileSync(filePath, `${header}\n23.05.2026;KIWI;-12.50;NOK;BANK-100\n23.05.2026;KIWI;-12.50;NOK;BANK-200`, "utf8");
    await csvImport.enterFilePath(filePath);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();
    await csvImport.mappingSelect("Execution date").selectOption("Date");
    await csvImport.mappingSelect("Description").selectOption("Description");
    await csvImport.mappingSelect("Amount out").selectOption("Amount Out");
    await csvImport.mappingSelect("Currency").selectOption("Currency");
    await csvImport.mappingSelect("Reference").selectOption("Transaction ID");
    await csvImport.importButton.click();
    const previewTable = csvImport.previewRegion.getByRole("table", {
      name: "CSV statement preview rows and validation states",
    });
    await expect(previewTable.getByRole("row")).toHaveCount(3);
    const duplicateRow = previewTable.getByRole("row").filter({ hasText: "Duplicate candidate" });
    await expect(duplicateRow).toHaveCount(1);
    await duplicateRow.getByRole("radio", { name: "Skip duplicate" }).check();
    await expect(csvImport.confirmImportButton).toBeEnabled();
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toHaveText("Added 1 transaction to your ledger.");
    await expect(csvImport.importSection.getByText("1 duplicate row skipped.", { exact: true })).toBeVisible();

    expect(loadPersistedTransactions(databasePath).filter((transaction) => transaction.merchantRaw === "KIWI")).toHaveLength(2);
  });

  test("Scenario 1: user-defined CSV column mapping imports arbitrary headers", async ({ csvImport }) => {
    await csvImport.enterFilePath(writeCustomHeaderCsvFixture());
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
    await expect(csvImport.successStatus).toContainText(/Added 16 transactions to your ledger/i);

    // Refresh now runs without tearing down the section and clears the input for next import.
    await expect(csvImport.filePathInput).toHaveValue("", { timeout: 10_000 });
    await expect(csvImport.importSection).toBeVisible();
  });

  test("destination switching preserves successful import feedback", async ({ appShell, csvImport }) => {
    await csvImport.submitImport(FIXTURE_PATH);
    await expect(csvImport.successStatus).toContainText(/Added 16 transactions to your ledger/i);
    const successMessage = (await csvImport.successStatus.innerText()).trim();

    await appShell.openWorkspace("Transactions");
    await appShell.openWorkspace("Import");

    await expect(csvImport.successStatus).toHaveText(successMessage);
  });

  test("Regression: refresh failure preserves the loaded dashboard and shows recovery feedback", async ({ appShell, csvImport, dashboard, electronApp, window }) => {
    await appShell.openWorkspace("Review");
    await dashboard.monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const incomeBeforeRefreshFailure = await dashboard.incomeValue.textContent();

    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"] = "1";
    });

    await appShell.openWorkspace("Import");
    await csvImport.submitImport(FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.importSection).toBeVisible();
    await expect(window.getByRole("alert")).toContainText("Review refresh failed");
    await expect(window.getByRole("alert")).toContainText("Synthetic dashboard refresh failure.");
    await expect(window.getByRole("button", { name: "Try again" })).toBeVisible();
    await appShell.openWorkspace("Review");
    await expect(dashboard.monthlyTotalsSection).toBeVisible({ timeout: 10_000 });
    await expect(dashboard.incomeValue).toHaveText(incomeBeforeRefreshFailure ?? "");
  });

  test("Regression: successful import preserves the currently selected month", async ({ appShell, csvImport, dashboard }) => {
    await appShell.openWorkspace("Review");
    const selectedMonth = await dashboard.selectDifferentMonth("2026-05");

    await appShell.openWorkspace("Import");
    await csvImport.submitImport(FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.filePathInput).toHaveValue("", { timeout: 10_000 });
    await appShell.openWorkspace("Review");
    await expect(dashboard.monthSelector).toHaveValue(selectedMonth, { timeout: 10_000 });
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
  });

  test("Regression: importing the same CSV twice does not duplicate persisted transactions", async ({
    appShell,
    csvImport,
    dashboard,
    databasePath,
  }) => {
    await appShell.openWorkspace("Review");
    await dashboard.monthSelector.selectOption("2026-05");
    const incomeBeforeImport = ((await dashboard.incomeValue.textContent()) ?? "").trim();
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    const transactionsAfterFirstImport = loadPersistedTransactions(databasePath);
    await appShell.openWorkspace("Review");
    await expect
      .poll(async () => ((await dashboard.incomeValue.textContent()) ?? "").trim(), { timeout: 10_000 })
      .not.toBe(incomeBeforeImport);
    const incomeAfterFirstImport = ((await dashboard.incomeValue.textContent()) ?? "").trim();

    await appShell.openWorkspace("Import");
    await csvImport.submitImport(FIXTURE_PATH);
    const duplicateRows = csvImport.previewRegion.getByRole("table", {
      name: "CSV statement preview rows and validation states",
    }).getByRole("row").filter({ hasText: "Duplicate candidate" });
    await expect(duplicateRows).toHaveCount(16);
    for (const row of await duplicateRows.all()) {
      await row.getByRole("radio", { name: "Skip duplicate" }).check();
    }
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.successStatus).toHaveText("Added 0 transactions to your ledger.");
    await expect(csvImport.importSection.getByText("16 duplicate rows skipped.", { exact: true })).toBeVisible();
    const transactionsAfterSecondImport = loadPersistedTransactions(databasePath);

    expect(transactionsAfterSecondImport).toEqual(transactionsAfterFirstImport);
    await appShell.openWorkspace("Review");
    await expect(dashboard.incomeValue).toHaveText(incomeAfterFirstImport);
  });

  test("Scenario 2: importing an unsupported CSV shape reports validation errors and leaves dashboard unchanged", async ({ appShell, csvImport, dashboard }) => {
    // Ensure dashboard is in a known state before the invalid import.
    await appShell.openWorkspace("Review");
    await dashboard.monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";

    const invalidPath = writeInvalidCsvFixture();

    // AC-1, AC-3: submit invalid CSV path via renderer input.
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(invalidPath);

    // AC-3: alert with validation failure is shown.
    await expect(csvImport.errorAlert).toBeVisible({ timeout: 10_000 });
    const alertText = await csvImport.errorAlert.textContent();
    expect(alertText).toMatch(/needs attention/i);

    // AC-4: dashboard totals remain unchanged after a failed import.
    await appShell.openWorkspace("Review");
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
    appShell,
    csvImport,
    dashboard,
  }) => {
    const mutablePath = join(createTemporaryDirectory(), `mutable-${randomUUID()}.csv`);
    writeFileSync(mutablePath, readFileSync(FIXTURE_PATH));
    await appShell.openWorkspace("Review");
    await dashboard.monthSelector.selectOption("2026-05");
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";
    const beforeExpenseText = (await dashboard.expenseValue.textContent()) ?? "";
    const beforeNetText = (await dashboard.netValue.textContent()) ?? "";

    await appShell.openWorkspace("Import");
    await csvImport.enterFilePath(mutablePath);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    writeFileSync(mutablePath, `${readFileSync(FIXTURE_PATH, "utf8")}changed after preview\n`, "utf8");
    await csvImport.confirmImportButton.click();

    await expect(csvImport.errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.errorAlert).toContainText("Import validation failed");
    await expect(csvImport.errorAlert).toContainText("The file changed after preview.");
    await appShell.openWorkspace("Review");
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
