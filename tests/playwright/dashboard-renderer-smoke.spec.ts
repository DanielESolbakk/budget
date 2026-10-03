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

  test("Scenario 5: monthly attention status and totals fit the review viewport", async ({
    dashboard,
    electronApp,
    window,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });

    await expect(dashboard.monthlyAttention).toContainText("No uncategorized transactions this month.");
    await expect(dashboard.monthlyAttention).toContainText("No categories over target.");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();

    const totalsPrecedeAttention = await dashboard.monthlyTotalsSection.evaluate((totals) => {
      const attention = document.querySelector('[aria-label="Monthly attention"]');
      return attention !== null &&
        (totals.compareDocumentPosition(attention) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(totalsPrecedeAttention).toBe(true);

    const attentionBottom = await dashboard.monthlyAttention.evaluate((element) =>
      element.getBoundingClientRect().bottom
    );
    const totalsBottom = await dashboard.monthlyTotalsSection.evaluate((element) =>
      element.getBoundingClientRect().bottom
    );
    const viewportHeight = await window.evaluate(() => document.documentElement.clientHeight);

    expect(attentionBottom).toBeLessThanOrEqual(viewportHeight);
    expect(totalsBottom).toBeLessThanOrEqual(viewportHeight);
  });

  test("compact Target vs Actual exposes its horizontal scroll and column headers", async ({
    dashboard,
    electronApp,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    const headers = dashboard.targetVsActualSection.getByRole("columnheader");
    await expect(headers).toHaveCount(4);
    for (const header of await headers.all()) {
      await expect(header).toHaveAttribute("scope", "col");
    }

    const scrollState = await dashboard.targetVsActualSection.evaluate((section) => ({
      clientWidth: section.clientWidth,
      scrollWidth: section.scrollWidth,
      scrollbarHeight: getComputedStyle(section, "::-webkit-scrollbar").height,
    }));
    expect(scrollState.scrollWidth).toBeGreaterThan(scrollState.clientWidth);
    expect(scrollState.scrollbarHeight).toBe("10px");
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

  test("Regression: the latest month response wins when requests resolve out of order", async ({ dashboard, electronApp }) => {
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_SLOW_DASHBOARD_MONTH"] = "2026-04";
      process.env["BUDGET_TEST_DASHBOARD_VIEW_DELAY_MS"] = "250";
    });

    await dashboard.monthSelector.selectOption("2026-04");
    await dashboard.monthSelector.selectOption("2026-05");

    await expect(dashboard.monthSelector).toHaveValue("2026-05", { timeout: 10_000 });
    await expect(dashboard.incomeValue).toContainText("540");
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

  test("compact review action buttons meet 44px touch targets", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

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

    const documentWidth = await window.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = await window.evaluate(() => document.documentElement.clientWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewportWidth);

    await expect(window).toHaveScreenshot("dashboard-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: MOBILE_SCREENSHOT_DIFF_RATIO,
    });
  });
});
