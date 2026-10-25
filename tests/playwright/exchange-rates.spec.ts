import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { _electron as electron } from "@playwright/test";
import { dirname, join } from "node:path";
import { test, expect } from "./fixtures/electron.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

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

test.describe("local dated exchange-rate workflow", () => {
  test("shows native and NOK values, incomplete totals, and scenario-only latest-rate restatement", async ({
    databasePath,
    electronApp,
  }) => {
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
      const window = await ratesApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await window.getByRole("button", { name: "Settings" }).click();

      const rates = window.getByRole("region", { name: "Exchange rates" });
      await rates.getByLabel("Rate currency").selectOption("EUR");
      await rates.getByLabel("Rate NOK per 1 unit").fill("11.50");
      await rates.getByLabel("Rate effective date").fill("2026-05-01");
      await rates.getByLabel("Rate source").fill("Synthetic manual rate");
      await rates.getByRole("button", { name: "Save local exchange rate" }).click();
      await expect(rates.getByText("Synthetic manual rate")).toBeVisible();

      await rates.getByRole("button", { name: "Import local rate CSV" }).click();
      await expect(rates.getByText("exchange-rates.csv")).toBeVisible();

      await rates.getByLabel("Report month").fill("2026-05");
      await rates.getByRole("button", { name: "Load converted report" }).click();
      const report = rates.getByRole("region", { name: "Converted monthly report" });
      const euroTransaction = report.getByRole("group", { name: "Synthetic EUR income" });
      await expect(euroTransaction).toContainText("EUR 100,00");
      await expect(euroTransaction).toContainText("NOK 1 150,00");
      await expect(report).toContainText("NOK subtotal incomplete");
      await expect(report).toContainText(/SEK\s*[−-]50,00/);

      await rates.getByLabel("Rate currency").selectOption("SEK");
      await rates.getByLabel("Rate NOK per 1 unit").fill("1.05");
      await rates.getByLabel("Rate effective date").fill("2026-05-01");
      await rates.getByLabel("Rate type").selectOption("monthly-reference");
      await rates.getByLabel("Rate source").fill("Synthetic monthly reference");
      await rates.getByRole("button", { name: "Save local exchange rate" }).click();
      await rates.getByLabel("Use monthly estimate for SEK (2026-05-01)").check();
      await rates.getByRole("button", { name: "Load converted report" }).click();

      const kronaTransaction = report.getByRole("group", { name: "Synthetic SEK expense" });
      await expect(kronaTransaction).toContainText(/SEK\s*[−-]50,00/);
      await expect(kronaTransaction).toContainText(/NOK\s*[−-]52,50/);
      await expect(kronaTransaction).toContainText("estimate");

      await rates.getByLabel("Use latest rate scenario").check();
      await expect(euroTransaction).toContainText("Scenario NOK 1 200,00");
      await expect(euroTransaction).toContainText("NOK 1 150,00");

      await window.setViewportSize({ width: 390, height: 844 });
      await expect(report).toBeVisible();
      const horizontalOverflow = await window.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(horizontalOverflow).toBe(false);
    } finally {
      await ratesApp.close();
    }
  });
});
