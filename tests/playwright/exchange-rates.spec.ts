import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { dirname, join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import {
  installMainProcessNetworkProbe,
  mainProcessNetworkRequests,
} from "./helpers/networkProbe.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

interface RatesWorkspace {
  ratesApp: ElectronApplication;
  window: Page;
  rates: Locator;
  rateBookTab: Locator;
  monthlyReportTab: Locator;
  rateCurrency: Locator;
  rateAmount: Locator;
  rateDate: Locator;
  rateType: Locator;
  rateSource: Locator;
  saveRateButton: Locator;
  importRateButton: Locator;
  reportMonth: Locator;
  loadReportButton: Locator;
  report: Locator;
  rendererRequests: string[];
}

async function tabTo(window: Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await window.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Keyboard tab navigation did not reach the expected exchange-rate control.");
}

function addSyntheticForeignCurrencyActivity(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare(`
      INSERT INTO accounts (id, household_id, name, currency_code)
      VALUES (?, ?, ?, ?)
    `).run("acc-eur-e2e", "sample-hh", "Synthetic euro account", "EUR");
    database.prepare(`
      INSERT INTO accounts (id, household_id, name, currency_code)
      VALUES (?, ?, ?, ?)
    `).run("acc-sek-e2e", "sample-hh", "Synthetic krona account", "SEK");
    const insertTransaction = database.prepare(`
      INSERT INTO transactions (
        id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        merchant_search, currency_code, source_type, source_reference, category_id,
        import_job_id, categorization_json, category_allocations_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertTransaction.run(
      "tx-eur-e2e",
      "sample-hh",
      "acc-eur-e2e",
      "2026-05-10T00:00:00Z",
      10_000,
      "Synthetic EUR income",
      "SYNTHETIC EUR INCOME",
      "EUR",
      "manual",
      null,
      "salary",
      null,
      null,
      null
    );
    insertTransaction.run(
      "tx-sek-e2e",
      "sample-hh",
      "acc-sek-e2e",
      "2026-05-12T00:00:00Z",
      -5_000,
      "Synthetic SEK expense",
      "SYNTHETIC SEK EXPENSE",
      "SEK",
      "manual",
      null,
      "other",
      null,
      null,
      null
    );
  } finally {
    database.close();
  }
}

async function openRatesWorkspace(
  databasePath: string,
  electronApp: ElectronApplication
): Promise<RatesWorkspace> {
  await electronApp.close();
  addSyntheticForeignCurrencyActivity(databasePath);
  const rateImportPath = join(dirname(databasePath), "exchange-rates.csv");
  writeFileSync(
    rateImportPath,
    "currencyCode,rateNokPerUnit,effectiveDate,kind\nEUR,12.00,2026-06-01,dated\n",
    "utf8"
  );
  const ratesApp = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      NODE_ENV: "test",
      BUDGET_DB_PATH: databasePath,
      BUDGET_TEST_EXCHANGE_RATE_IMPORT_PATH: rateImportPath,
    },
  });

  try {
    await installMainProcessNetworkProbe(ratesApp);
    const window = await ratesApp.firstWindow();
    const rendererRequests: string[] = [];
    await window.route(/^https?:\/\//, async (route) => {
      rendererRequests.push(route.request().url());
      await route.abort();
    });
    await window.waitForLoadState("domcontentloaded");
    await window.setViewportSize({ width: 1280, height: 800 });
    const householdButton = window.getByRole("button", { name: "Household", exact: true });
    await householdButton.focus();
    await window.keyboard.press("Enter");
    const exchangeRatesTab = window
      .getByRole("navigation", { name: "Household tools" })
      .getByRole("button", { name: "Exchange rates", exact: true });
    await exchangeRatesTab.focus();
    await window.keyboard.press("Enter");

    const rates = window.getByRole("region", { name: "Exchange rates", exact: true });
    const rateBookTab = rates.getByRole("button", { name: "Rate book", exact: true });
    const monthlyReportTab = rates.getByRole("button", { name: "Monthly report", exact: true });
    const rateCurrency = rates.getByLabel("Rate currency");
    const rateAmount = rates.getByLabel("Rate NOK per 1 unit");
    const rateDate = rates.getByLabel("Rate effective date");
    const rateType = rates.getByLabel("Rate type");
    const rateSource = rates.getByLabel("Rate source");
    const saveRateButton = rates.getByRole("button", { name: "Save local exchange rate" });
    const importRateButton = rates.getByRole("button", { name: "Import local rate CSV" });
    const reportMonth = rates.getByLabel("Report month");
    const loadReportButton = rates.getByRole("button", { name: "Load converted report" });
    const report = rates.getByRole("region", { name: "Converted monthly report" });

    return {
      ratesApp,
      window,
      rates,
      rateBookTab,
      monthlyReportTab,
      rateCurrency,
      rateAmount,
      rateDate,
      rateType,
      rateSource,
      saveRateButton,
      importRateButton,
      reportMonth,
      loadReportButton,
      report,
      rendererRequests,
    };
  } catch (error: unknown) {
    await ratesApp.close();
    throw error;
  }
}

test.describe("local dated exchange-rate workflow", () => {
  test("reports local rate provenance and supports keyboard entry at desktop and compact widths", async ({
    databasePath,
    electronApp,
  }) => {
    const {
      ratesApp,
      window,
      rates,
      rateBookTab,
      monthlyReportTab,
      rateCurrency,
      rateAmount,
      rateDate,
      rateType,
      rateSource,
      saveRateButton,
      importRateButton,
      reportMonth,
      loadReportButton,
      report,
      rendererRequests,
    } = await openRatesWorkspace(databasePath, electronApp);
    try {
      await rateCurrency.focus();
      await window.keyboard.press("ArrowDown");
      await expect(rateCurrency).toHaveValue("SEK");
      await window.keyboard.press("ArrowUp");
      await expect(rateCurrency).toHaveValue("EUR");
      await tabTo(window, rateAmount);
      await expect(rateAmount).toBeFocused();
      await window.keyboard.insertText("11.50");
      await tabTo(window, rateDate);
      await expect(rateDate).toBeFocused();
      await rateDate.fill("2026-05-01");
      await tabTo(window, rateType);
      await expect(rateType).toBeFocused();
      await tabTo(window, rateSource);
      await expect(rateSource).toBeFocused();
      await window.keyboard.insertText("Synthetic manual rate");
      await tabTo(window, saveRateButton);
      await window.keyboard.press("Enter");
      await expect(rates.getByText("Synthetic manual rate")).toBeVisible();

      await importRateButton.focus();
      await window.keyboard.press("Enter");
      await expect(rates.getByText("exchange-rates.csv")).toBeVisible();
      const importedRates = rates.getByRole("table", { name: "Saved local exchange rates" });
      const importedEuroRate = importedRates.getByRole("row", {
        name: /EUR.*2026-06-01.*exchange-rates\.csv/,
      });
      await expect(importedEuroRate).toContainText("12.00");
      await expect(importedEuroRate).toContainText("Local file");

      await monthlyReportTab.click();
      await reportMonth.fill("2026-05");
      await loadReportButton.focus();
      await window.keyboard.press("Enter");
      const euroTransaction = report.getByRole("group", { name: "Synthetic EUR income" });
      await expect(euroTransaction).toContainText("EUR 100,00");
      await expect(euroTransaction).toContainText("NOK 1 150,00");
      await expect(euroTransaction)
        .toContainText("Rate 11.50 NOK per EUR — 2026-05-01, Synthetic manual rate");
      await expect(report).toContainText("NOK subtotal incomplete");
      await expect(report).toContainText(/SEK\s*[−-]50,00/);
      const sekWithoutRate = report.getByRole("group", { name: "Synthetic SEK expense" });
      await expect(sekWithoutRate).toContainText("NOK conversion incomplete");
      await expect(sekWithoutRate).not.toContainText(/NOK\s*[−-]\s*50,00/);

      await rateBookTab.click();
      await rateCurrency.focus();
      await window.keyboard.press("ArrowDown");
      await expect(rateCurrency).toHaveValue("SEK");
      await rateAmount.focus();
      await window.keyboard.insertText("1.05");
      await rateDate.fill("2026-05-01");
      await rateType.focus();
      await window.keyboard.press("ArrowDown");
      await expect(rateType).toHaveValue("monthly-reference");
      await rateSource.fill("Synthetic monthly reference");
      await saveRateButton.focus();
      await window.keyboard.press("Enter");
      const monthlyEstimate = rates.getByLabel("Use monthly estimate for SEK (2026-05-01)");
      await monthlyEstimate.focus();
      await window.keyboard.press("Space");
      await expect(monthlyEstimate).toBeChecked();
      await monthlyReportTab.click();
      await loadReportButton.focus();
      await window.keyboard.press("Enter");

      const kronaTransaction = report.getByRole("group", { name: "Synthetic SEK expense" });
      await expect(kronaTransaction).toContainText(/SEK\s*[−-]50,00/);
      await expect(kronaTransaction).toContainText(/NOK\s*[−-]52,50/);
      await expect(kronaTransaction)
        .toContainText("Rate 1.05 NOK per SEK — 2026-05-01, Synthetic monthly reference");
      await expect(kronaTransaction).toContainText("estimate");

      const latestRateScenario = rates.getByLabel("Use latest rate scenario");
      await latestRateScenario.focus();
      await window.keyboard.press("Space");
      await expect(latestRateScenario).toBeChecked();
      await expect(euroTransaction).toContainText("Scenario NOK 1 200,00");
      await expect(euroTransaction).toContainText("NOK 1 150,00");

      await window.setViewportSize({ width: 390, height: 844 });
      await expect(report).toBeVisible();
      await reportMonth.focus();
      await tabTo(window, loadReportButton);
      await expect(loadReportButton).toBeFocused();
      await window.keyboard.press("Enter");
      await expect(euroTransaction)
        .toContainText("Rate 11.50 NOK per EUR — 2026-05-01, Synthetic manual rate");

      await latestRateScenario.focus();
      await window.keyboard.press("Space");
      await expect(latestRateScenario).not.toBeChecked();
      await rateBookTab.click();
      await rateCurrency.focus();
      await window.keyboard.press("ArrowUp");
      await expect(rateCurrency).toHaveValue("EUR");
      await window.keyboard.press("ArrowDown");
      await expect(rateCurrency).toHaveValue("SEK");
      await tabTo(window, rateAmount);
      await window.keyboard.press("Control+A");
      await window.keyboard.insertText("1.06");
      await tabTo(window, rateDate);
      await expect(rateDate).toHaveValue("2026-05-01");
      await tabTo(window, rateType);
      await window.keyboard.press("ArrowUp");
      await expect(rateType).toHaveValue("dated");
      await tabTo(window, rateSource);
      await window.keyboard.press("Control+A");
      await window.keyboard.insertText("Synthetic compact rate");
      await tabTo(window, saveRateButton);
      await window.keyboard.press("Enter");
      await expect(rates.getByText("Synthetic compact rate")).toBeVisible();
      await monthlyReportTab.click();
      await loadReportButton.focus();
      await window.keyboard.press("Enter");
      await expect(kronaTransaction).toContainText(/NOK\s*[−-]53,00/);
      await expect(kronaTransaction)
        .toContainText("Rate 1.06 NOK per SEK — 2026-05-01, Synthetic compact rate");
      await expect(kronaTransaction).not.toContainText("estimate");

      const horizontalOverflow = await window.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(horizontalOverflow).toBe(false);
      expect(rendererRequests).toEqual([]);
      expect(await mainProcessNetworkRequests(ratesApp)).toEqual([]);
    } finally {
      await ratesApp.close();
    }
  });

  test("@visual Visual: converted report states remain readable at desktop and compact widths", async ({
    databasePath,
    electronApp,
  }) => {
    const {
      ratesApp,
      window,
      rates,
      rateBookTab,
      monthlyReportTab,
      rateCurrency,
      rateAmount,
      rateDate,
      rateType,
      rateSource,
      saveRateButton,
      importRateButton,
      reportMonth,
      loadReportButton,
      report,
    } = await openRatesWorkspace(databasePath, electronApp);

    try {
      await rateCurrency.selectOption("EUR");
      await rateAmount.fill("11.50");
      await rateDate.fill("2026-05-01");
      await rateType.selectOption("dated");
      await rateSource.fill("Synthetic manual rate");
      await saveRateButton.click();
      await importRateButton.click();
      await expect(rates.getByRole("table", { name: "Saved local exchange rates" }))
        .toContainText("Local file");

      await monthlyReportTab.click();
      await reportMonth.fill("2026-05");
      await loadReportButton.click();
      const euroTransaction = report.getByRole("group", { name: "Synthetic EUR income" });
      const sekTransaction = report.getByRole("group", { name: "Synthetic SEK expense" });
      await expect(sekTransaction).toContainText("NOK conversion incomplete");
      await expect(report).toHaveScreenshot("exchange-report-missing-desktop.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
      await window.setViewportSize({ width: 390, height: 844 });
      await expect(report).toHaveScreenshot("exchange-report-missing-mobile.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
      await window.setViewportSize({ width: 1280, height: 800 });

      await rateBookTab.click();
      await rateCurrency.selectOption("SEK");
      await rateAmount.fill("1.05");
      await rateDate.fill("2026-05-01");
      await rateType.selectOption("monthly-reference");
      await rateSource.fill("Synthetic monthly reference");
      await saveRateButton.click();
      await rates.getByLabel("Use monthly estimate for SEK (2026-05-01)").check();
      await monthlyReportTab.click();
      await loadReportButton.click();
      await expect(sekTransaction).toContainText("estimate");
      await expect(report).toHaveScreenshot("exchange-report-estimate-desktop.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
      await window.setViewportSize({ width: 390, height: 844 });
      await expect(report).toHaveScreenshot("exchange-report-estimate-mobile.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
      await window.setViewportSize({ width: 1280, height: 800 });

      await rates.getByLabel("Use latest rate scenario").check();
      await expect(euroTransaction).toContainText("Scenario NOK 1 200,00");
      await expect(euroTransaction).toContainText("NOK 1 150,00");
      await expect(report).toHaveScreenshot("exchange-report-scenario-desktop.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
      await window.setViewportSize({ width: 390, height: 844 });
      await expect(report).toHaveScreenshot("exchange-report-scenario-mobile.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
    } finally {
      await ratesApp.close();
    }
  });
});