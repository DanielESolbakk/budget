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
    await dashboard.monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
    await expect(dashboard.monthSelector).toHaveValue("2026-05");
  });

  test("Scenario 3: month-switch control updates selected month and refreshes at least one value", async ({ dashboard }) => {
    // AC-4: changing the selected month refreshes totals and categories.
    // Wait for initial data to render before capturing baseline.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
    await expect(dashboard.categoryBreakdownHeading).toBeVisible();
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
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.monthlyTotalsHeading).toBeVisible();
    await expect(dashboard.incomeValue).toBeVisible();
    await expect(dashboard.expenseValue).toBeVisible();
    await expect(dashboard.netValue).toBeVisible();
    await expect(dashboard.monthlyTotal("Income")).toContainText("Income");
    await expect(dashboard.monthlyTotal("Income").getByLabel("Income", { exact: true })).toBeVisible();
    await expect(dashboard.monthlyTotal("Expenses")).toContainText("Expenses");
    await expect(dashboard.monthlyTotal("Expenses").getByLabel("Expenses", { exact: true })).toBeVisible();
    await expect(dashboard.monthlyTotal("Net")).toContainText("Net");
    await expect(dashboard.monthlyTotal("Net").getByLabel("Net", { exact: true })).toBeVisible();
  });

  test("category breakdown uses registered category display names", async ({ dashboard }) => {
    await expect(dashboard.categoryBreakdownSection).toContainText("Salary / wages");
    await expect(dashboard.categoryBreakdownSection).toContainText("Groceries & food");
    await expect(dashboard.categoryBreakdownSection).not.toContainText("salary");
    await expect(dashboard.targetVsActualSection).toContainText("Salary / wages");
    await expect(dashboard.targetVsActualSection).toContainText("Groceries & food");
    await expect(dashboard.categoryTargetEntrySection).toContainText("Groceries & food");
  });

  test("category breakdown separates spending from money-in categories", async ({ dashboard }) => {
    await expect(dashboard.inflowCategories).toContainText("Salary / wages");
    await expect(dashboard.spendingCategories).toContainText("Groceries & food");
    await expect(dashboard.spendingCategories).not.toContainText("Salary / wages");
  });

  test("monthly totals explain expense change from the previous month", async ({ dashboard }) => {
    await expect(dashboard.monthlyComparison).toContainText(/spending increased by 13,00.*apr\.? 2026/i);
  });

  test("monthly attention shows the current review and budget states", async ({ dashboard }) => {
    await expect(dashboard.monthlyAttention).toContainText("No category decisions need review this month.");
    await expect(dashboard.monthlyAttention).toContainText("No categories over target.");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
  });

  test("compact Target vs Actual keeps its financial columns available", async ({
    dashboard,
    dashboardTarget,
    window,
  }) => {
    await window.setViewportSize({ width: 390, height: 844 });
    const headers = dashboard.targetVsActualSection.getByRole("columnheader");
    await expect(headers).toHaveCount(4);
    for (const label of ["Category", "Target", "Actual", "Delta"]) {
      const header = dashboard.targetVsActualSection.getByRole("columnheader", { name: label });
      await expect(header).toBeVisible();
      await expect(header).toHaveAttribute("scope", "col");
    }
    await expect(dashboardTarget.categoryRow("groceries")).toBeVisible();
    await expect(dashboardTarget.targetCell("groceries")).toBeVisible();
    await expect(dashboardTarget.actualCell("groceries")).toBeVisible();
    await expect(dashboardTarget.deltaCell("groceries")).toBeVisible();
  });

  test("Scenario 6: target overruns link to their monthly details", async ({ dashboard }) => {
    await dashboard.monthSelector.selectOption("2026-04");

    await expect(dashboard.overTargetLink).toHaveText("Review 1 category over target");
    await expect(dashboard.overTargetLink).toHaveAttribute("href", "#target-vs-actual");
  });

  test("Regression: failed month changes preserve review data and explain retry", async ({
    dashboard,
    electronApp,
  }) => {
    const originalIncome = await dashboard.incomeValue.textContent();
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"] = "1";
    });

    await dashboard.monthSelector.selectOption("2026-04");

    await expect(dashboard.monthChangeError).toContainText(
      "Your current review remains visible. Select a month again to retry."
    );
    await expect(dashboard.monthSelector).toHaveValue("2026-05");
    await expect(dashboard.incomeValue).toHaveText(originalIncome ?? "");

    await electronApp.evaluate(() => {
      delete process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"];
    });
    await dashboard.monthSelector.selectOption("2026-04");
    await expect(dashboard.monthSelector).toHaveValue("2026-04");
    await expect(dashboard.incomeValue).toContainText("510");
  });

  test("Regression: the latest month response wins when requests resolve out of order", async ({ dashboard, electronApp, window }) => {
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_SLOW_DASHBOARD_MONTH"] = "2026-04";
      process.env["BUDGET_TEST_DASHBOARD_VIEW_DELAY_MS"] = "250";
    });

    await dashboard.monthSelector.selectOption("2026-04");
    await expect(window.getByRole("status").filter({ hasText: "Updating month..." })).toBeVisible();
    await dashboard.monthSelector.selectOption("2026-05");

    await expect(dashboard.monthSelector).toHaveValue("2026-05", { timeout: 10_000 });
    await expect(dashboard.incomeValue).toContainText("540");
    await window.evaluate(() => globalThis.window.budgetApi.dashboard.getViewData("2026-04"));
    await expect(dashboard.monthSelector).toHaveValue("2026-05");
    await expect(dashboard.incomeValue).toContainText("540");
  });

  test("@visual Visual: desktop dashboard preserves the monthly review layout", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1100);
    });
    await expect(window.getByRole("region", { name: "Account coverage status" }))
      .toContainText("No statement periods recorded");

    await expect(window).toHaveScreenshot("dashboard-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  });

  test("compact review action buttons meet 44px touch targets", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    await expect(window.getByRole("button").first()).toBeVisible();
    const undersizedButtons = await window.getByRole("button").evaluateAll((buttons) =>
      buttons
        .map((button) => ({
          label: button.textContent?.trim() ?? "",
          height: button.getBoundingClientRect().height,
        }))
        .filter((button) => button.height < 44)
    );

    expect(undersizedButtons).toEqual([]);
  });

  test("@visual Visual: compact dashboard preserves primary workspace navigation", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });
    await expect(window.getByRole("region", { name: "Account coverage status" }))
      .toContainText("No statement periods recorded");

    const documentWidth = await window.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = await window.evaluate(() => document.documentElement.clientWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewportWidth);

    await expect(window).toHaveScreenshot("dashboard-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: MOBILE_SCREENSHOT_DIFF_RATIO,
    });
  });
});
