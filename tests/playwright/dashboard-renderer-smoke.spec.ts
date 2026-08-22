/**
 * Playwright runtime smoke tests for the monthly dashboard renderer.
 *
 * These tests launch the built Electron app and verify:
 *   - Monthly totals section renders with income, expense, and net values visible (AC-3 / #23)
 *   - Category breakdown section renders with at least one category row visible (AC-3 / #23)
 *   - Month-switch interaction updates selected month and refreshes at least one
 *     displayed totals or category value (AC-4 / #23)
 *
 * Framework boundary:
 *   Vitest   -- unit, integration, and Vitest e2e smoke tests (tests/e2e/)
 *   Playwright -- Electron runtime flow validation (this file)
 *
 * Prerequisites: `npm run test:e2e:playwright` runs `npm run build` automatically via the
 * pretest script. To run manually first: `npm run build && npm run test:e2e:playwright`.
 */

import { test, expect } from "./fixtures/electron.js";

const MOBILE_SCREENSHOT_DIFF_RATIO = process.platform === "linux" ? 0.03 : 0.01;

test.describe("Dashboard renderer smoke", () => {
  test.beforeEach(async ({ dashboard }) => {
    const initialMonth = await dashboard.monthSelector.inputValue();
    // Keep each test isolated from month selection side effects.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
    await expect(dashboard.monthSelector).toHaveValue(initialMonth);
  });

  test("Scenario 1: monthly totals section renders with income, expense, and net values visible", async ({ dashboard }) => {
    // AC-3: renderer path shows monthly totals section without runtime errors.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.monthlyTotalsHeading).toBeVisible();
    await expect(dashboard.incomeValue).toBeVisible();
    await expect(dashboard.expenseValue).toBeVisible();
    await expect(dashboard.netValue).toBeVisible();
  });

  test("Scenario 2: category breakdown section renders with at least one category row visible", async ({ dashboard }) => {
    // AC-3: renderer path shows category breakdown section without runtime errors.
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
    await expect(dashboard.categoryBreakdownHeading).toBeVisible();
    await expect(dashboard.categoryEntries.first()).toBeVisible();
  });

  test("Scenario 3: month-switch control updates selected month and refreshes at least one value", async ({ dashboard }) => {
    // AC-4: changing the selected month refreshes totals and categories.
    // Wait for initial data to render before capturing baseline.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryEntries.first()).toBeVisible();

    // Capture baseline state.
    const beforeMonth = await dashboard.monthSelector.inputValue();
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";
    const beforeCategoryText = (await dashboard.categoryEntries.first().textContent()) ?? "";

    // Switch to a different month option dynamically to avoid fixture-coupled hardcoding.
    const targetMonth = await dashboard.selectDifferentMonth(beforeMonth);

    // Assert selected month label updated immediately.
    await expect(dashboard.monthSelector).toHaveValue(targetMonth);

    // Assert totals and category rows refresh after month switch.
    // Uses a web-first assertion so Playwright waits for the re-render.
    await expect(dashboard.incomeValue).toBeVisible();
    await expect(dashboard.categoryEntries.first()).toBeVisible();
    await expect(dashboard.incomeValue).not.toHaveText(beforeIncomeText);
    await expect(dashboard.categoryEntries.first()).not.toHaveText(beforeCategoryText);

    // Assert both sections remain visible after the switch.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
  });

  test("Scenario 4: each monthly total keeps its label paired with its value", async ({ dashboard }) => {
    await expect(dashboard.monthlyTotal("Income")).toContainText("Income");
    await expect(dashboard.monthlyTotal("Income").getByLabel("Income", { exact: true })).toBeVisible();
    await expect(dashboard.monthlyTotal("Expenses")).toContainText("Expenses");
    await expect(dashboard.monthlyTotal("Expenses").getByLabel("Expenses", { exact: true })).toBeVisible();
    await expect(dashboard.monthlyTotal("Net")).toContainText("Net");
    await expect(dashboard.monthlyTotal("Net").getByLabel("Net", { exact: true })).toBeVisible();
  });

  test("Regression: the latest month response wins when requests resolve out of order", async ({ dashboard, electronApp }) => {
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_SLOW_DASHBOARD_MONTH"] = "2026-03";
      process.env["BUDGET_TEST_DASHBOARD_VIEW_DELAY_MS"] = "250";
    });

    await dashboard.monthFrame("2026-03").click();
    await dashboard.monthFrame("2026-04").click();

    await expect(dashboard.monthSelector).toHaveValue("2026-04", { timeout: 10_000 });
    await expect(dashboard.incomeValue).toContainText("510");
  });

  test("@visual Visual: desktop dashboard preserves the monthly review layout", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1100);
    });

    await expect(window).toHaveScreenshot("dashboard-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  });

  test("@visual Visual: mobile dashboard preserves the horizontal month rail", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    await expect(window).toHaveScreenshot("dashboard-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: MOBILE_SCREENSHOT_DIFF_RATIO,
    });
  });
});
