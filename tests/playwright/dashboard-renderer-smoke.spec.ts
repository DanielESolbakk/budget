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

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { join } from "node:path";
import { DashboardPage } from "./pom/DashboardPage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

test.describe("Dashboard renderer smoke", () => {
  let app: ElectronApplication;
  let window: Page;
  let dashboard: DashboardPage;
  let initialMonth: string;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test" },
    });
    window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    dashboard = new DashboardPage(window);
    initialMonth = await dashboard.monthSelector.inputValue();
  });

  test.beforeEach(async () => {
    // Keep tests isolated from month selection side effects in previous scenarios.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
    const currentMonth = await dashboard.monthSelector.inputValue();
    if (currentMonth !== initialMonth) {
      await dashboard.monthSelector.selectOption(initialMonth);
      await expect(dashboard.monthSelector).toHaveValue(initialMonth);
    }
  });

  test.afterAll(async () => {
    await app.close();
  });

  test("Scenario 1: monthly totals section renders with income, expense, and net values visible", async () => {
    // AC-3: renderer path shows monthly totals section without runtime errors.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.monthlyTotalsHeading).toBeVisible();
    await expect(dashboard.incomeValue).toBeVisible();
    await expect(dashboard.expenseValue).toBeVisible();
    await expect(dashboard.netValue).toBeVisible();
  });

  test("Scenario 2: category breakdown section renders with at least one category row visible", async () => {
    // AC-3: renderer path shows category breakdown section without runtime errors.
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
    await expect(dashboard.categoryBreakdownHeading).toBeVisible();
    await expect(dashboard.categoryEntries.first()).toBeVisible();
  });

  test("Scenario 3: month-switch control updates selected month and refreshes at least one value", async () => {
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
});
