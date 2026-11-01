import { DatabaseSync } from "node:sqlite";
import type { Page } from "@playwright/test";
import { ManualEntryPage } from "./pom/ManualEntryPage.js";
import { test, expect } from "./fixtures/electron.js";

const CURRENT_LOCAL_MONTH = "2026-10";
const CURRENT_LOCAL_DATE = "2026-10-03";
const SELECTED_BOOKING_DATE = "2026-10-01";
const MANUAL_ENTRY_MERCHANT = "Local date default test";

async function reloadAtFrozenLocalDate(window: Page): Promise<void> {
  await window.clock.install({ time: new Date(2026, 9, 3, 12) });
  await window.reload();
}

test.describe("Current local date defaults", () => {
  test("selects the empty current month when only prior months have transactions", async ({
    dashboard,
    databasePath,
    electronApp,
    window,
  }) => {
    await reloadAtFrozenLocalDate(window);

    const database = new DatabaseSync(databasePath);
    try {
      const historicalMonths = database.prepare(`
        SELECT DISTINCT substr(booked_at_iso, 1, 7) AS year_month
        FROM transactions
        ORDER BY year_month
      `).all() as Array<{ year_month: string }>;
      expect(historicalMonths.map(({ year_month }) => year_month)).toEqual(["2026-04", "2026-05"]);
    } finally {
      database.close();
    }

    await expect(dashboard.monthSelector).toHaveValue(CURRENT_LOCAL_MONTH);
    await expect(dashboard.monthSelector.locator('option[value="2026-04"]')).toHaveCount(1);
    await expect(dashboard.monthSelector.locator('option[value="2026-05"]')).toHaveCount(1);
    await expect(dashboard.monthSelector.locator(`option[value="${CURRENT_LOCAL_MONTH}"]`)).toHaveCount(1);
    await expect(dashboard.zeroActivityStatus).toContainText("No activity has been recorded for this month.");

    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await electronApp.evaluate(({ BrowserWindow }, viewport) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(viewport.width, viewport.height);
      }, size);

      await expect(dashboard.monthSelector).toBeVisible();
      await expect(dashboard.zeroActivityStatus).toBeVisible();

      const documentWidth = await window.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(documentWidth.scrollWidth).toBeLessThanOrEqual(documentWidth.clientWidth);
    }
  });

  test("keeps the selected local booking date and review month through refresh", async ({
    appShell,
    dashboard,
    databasePath,
    window,
  }) => {
    await reloadAtFrozenLocalDate(window);
    await expect(dashboard.monthSelector).toHaveValue(CURRENT_LOCAL_MONTH);

    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("Manual transaction");
    const manualEntry = new ManualEntryPage(window);
    await expect(manualEntry.bookedDateInput).toHaveValue(CURRENT_LOCAL_DATE);

    await manualEntry.bookedDateInput.fill(SELECTED_BOOKING_DATE);
    await manualEntry.amountInput.fill("-1250");
    await manualEntry.merchantInput.fill(MANUAL_ENTRY_MERCHANT);
    await manualEntry.submitButton.click();
    await expect(manualEntry.successStatus).toHaveText(`Added ${MANUAL_ENTRY_MERCHANT} to your ledger.`);

    const database = new DatabaseSync(databasePath);
    try {
      const savedTransaction = database.prepare(
        "SELECT booked_at_iso FROM transactions WHERE merchant_raw = ?"
      ).get(MANUAL_ENTRY_MERCHANT) as { booked_at_iso: string } | undefined;
      expect(savedTransaction?.booked_at_iso).toBe(SELECTED_BOOKING_DATE);
    } finally {
      database.close();
    }

    await appShell.openWorkspace("Review");
    await dashboard.monthSelector.selectOption("2026-05");
    await expect(dashboard.monthSelector).toHaveValue("2026-05");
    await expect(dashboard.monthlyTotalsSection).not.toContainText("No transactions for this month.");
    await expect(dashboard.incomeValue).toBeVisible();

    await appShell.openWorkspace("Import");
    await expect(manualEntry.bookedDateInput).toHaveValue(CURRENT_LOCAL_DATE);

    await window.reload();
    await expect(dashboard.monthSelector).toHaveValue("2026-05");

    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("Manual transaction");
    await expect(manualEntry.bookedDateInput).toHaveValue(CURRENT_LOCAL_DATE);
  });
});
