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
    await expect(dashboard.monthSelector).toHaveAttribute("type", "month");
    await expect(dashboard.zeroActivityStatus).toContainText("No activity has been recorded for this month.");
    await expect(window.getByRole("group", { name: "Monthly comparison" })).not.toBeVisible();
    await expect(dashboard.zeroActivityStatus).toContainText("Zero recorded totals do not establish that there was no spending.");
    await expect(dashboard.incomeValue).toContainText("0,00");
    await expect(dashboard.expenseValue).toContainText("0,00");
    await expect(dashboard.netValue).toContainText("0,00");
    await expect(dashboard.monthlyTotalsSection).not.toContainText("Spending was unchanged");
    await expect(dashboard.monthlyTotalsSection).not.toContainText("No transactions for this month.");
    await expect(dashboard.categoryBreakdownSection).toBeHidden();
    await dashboard.openPeriodControls();

    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await electronApp.evaluate(({ BrowserWindow }, viewport) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(viewport.width, viewport.height);
      }, size);

      await expect(dashboard.monthSelector).toBeVisible();
      await expect(dashboard.zeroActivityStatus).toBeVisible();

      const statusTypography = await dashboard.zeroActivityStatus.evaluate((element) => {
        const { fontFamily, fontSize } = getComputedStyle(element);
        return { fontFamily, fontSize: Number.parseFloat(fontSize) };
      });
      expect(statusTypography.fontSize).toBeGreaterThanOrEqual(14);
      expect(statusTypography.fontFamily).toContain("Segoe UI");

      const documentWidth = await window.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(documentWidth.scrollWidth).toBeLessThanOrEqual(documentWidth.clientWidth);
    }

    await dashboard.selectMonth("2026-05");
    await expect(dashboard.incomeValue).toBeVisible();
    await expect(dashboard.monthlyTotalsSection.getByLabel("Active reporting range"))
      .toHaveText("1 May 2026 - 31 May 2026");
    await expect(dashboard.monthlyTotalsSection.getByText("Custom view", { exact: true })).toHaveCount(0);
    await dashboard.monthlyTotalsSection.getByRole("button", { name: "Current month", exact: true }).click();
    await expect(dashboard.monthSelector).toHaveValue(CURRENT_LOCAL_MONTH);
    await expect(dashboard.monthlyTotalsSection.getByText("Custom view", { exact: true })).toHaveCount(0);
    expect(await window.evaluate(() => globalThis.window.budgetApi.reportingPreferences.getPeriodRule()))
      .toEqual({ type: "calendar-month" });
  });

  test("keeps an empty adjacent month in sync and does not report missing activity as savings", async ({
    dashboard,
    window,
  }) => {
    await reloadAtFrozenLocalDate(window);
    await dashboard.selectMonth("2026-05");
    await dashboard.monthlyTotalsSection.getByRole("button", { name: /^Next (month|period)/ }).click();
    await expect(dashboard.monthSelector).toHaveValue("2026-06");
    await expect(dashboard.monthlyTotalsSection.getByLabel("Active reporting range"))
      .toHaveText("1 June 2026 - 30 June 2026");
    await expect(dashboard.expenseValue).toContainText("0,00");
    await expect(dashboard.zeroActivityStatus).toContainText("No activity has been recorded");
    await expect(dashboard.monthlyComparison).not.toBeVisible();
    await expect(dashboard.monthlyTotalsSection).not.toContainText("Spending decreased");
    await dashboard.monthlyTotalsSection.getByRole("button", { name: "Current month", exact: true }).click();
    await expect(dashboard.monthSelector).toHaveValue(CURRENT_LOCAL_MONTH);
    await expect(dashboard.monthlyTotalsSection.getByRole("button", { name: /^Next month/ })).toBeEnabled();
  });

  test("browses an arbitrary future month as recorded activity rather than a forecast", async ({
    dashboard,
    window,
  }) => {
    await reloadAtFrozenLocalDate(window);
    await dashboard.openPeriodControls();
    await window.getByLabel("Select month", { exact: true }).fill("2028-02");
    await expect(dashboard.monthlyTotalsSection.getByLabel("Active reporting range"))
      .toHaveText("1 February 2028 - 29 February 2028");
    await expect(dashboard.monthlyTotalsSection.getByText("Future period", { exact: true })).toBeVisible();
    await expect(dashboard.monthlyComparison).toContainText("not a forecast");
    await dashboard.monthlyTotalsSection.getByRole("button", { name: /^Next month/ }).click();
    await expect(window.getByLabel("Select month", { exact: true })).toHaveValue("2028-03");
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
    await dashboard.selectMonth("2026-05");
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
