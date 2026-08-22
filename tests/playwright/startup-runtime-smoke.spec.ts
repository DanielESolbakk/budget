/**
 * Playwright runtime startup smoke guard for the Electron application.
 *
 * These tests launch the built Electron app and assert on:
 *   - Window boot and root render without a blank-screen failure (AC-4 / AC-1)
 *   - Preload bridge availability and dashboard contract fields (AC-2)
 *   - Forecast section output visibility in the renderer (AC-1)
 *   - Forecast fallback or projected-month rendering path is active (AC-3)
 *   - Fallback label renders in isolation when the IPC handler returns insufficient history (AC-3)
 *
 * Framework boundary:
 *   Vitest   -- unit, integration, and component-level smoke tests
 *   Playwright -- Electron runtime flow validation (this file)
 *
 * Prerequisites: `npm run test:e2e:playwright` runs `npm run build` automatically via the
 * pretest script. To run manually first: `npm run build && npm run test:e2e:playwright`.
 */

import { test, expect } from "./fixtures/electron.js";

test.describe("Electron startup smoke", () => {
  test("Scenario 1: window opens and root shell renders without blank-screen failure", async ({ appShell }) => {
    // AC-1, AC-4: renderer reaches a loaded state with the application heading.
    await expect(appShell.heading).toBeVisible();
    await expect(appShell.banner).toBeVisible();
  });

  test("Scenario 2: preload bridge exposes window.budgetApi with dashboard contract methods", async ({ preloadBridge }) => {
    // AC-2: confirm the preload bridge wires dashboard.getData and that the
    // resolved value exposes the expected monthlyTotals and forecast fields.
    const hasDashboard = await preloadBridge.hasDashboardGetData();
    expect(hasDashboard).toBe(true);

    const fields = await preloadBridge.getDashboardContractFields();
    expect(fields.hasMonthlyTotals).toBe(true);
    expect(fields.hasForecast).toBe(true);
  });

  test("Scenario 3: forecast section is visible and shows projected or fallback output", async ({ forecast }) => {
    // AC-1, AC-3: the renderer displays forecast section content after IPC resolves.
    // Waits for loading state to transition to either projected or fallback forecast.
    await expect(forecast.sectionHeading).toBeVisible();
    await expect(forecast.section).toBeVisible();

    // Verify one of the two labeling paths is active in the renderer.
    // The app boots with sample monthly totals (sufficient history), so the
    // projected-months description is expected; the fallback label confirms
    // the renderer handles the insufficient-history path without crashing.
    const projectedVisible = await forecast.projectedDescription.isVisible();
    const fallbackVisible = await forecast.fallbackLabel.isVisible();
    expect(projectedVisible || fallbackVisible).toBe(true);
  });

  test("Scenario 4: application window title matches product name", async ({ window }) => {
    // AC-4: minimal renderer path does not break window titling.
    const title = await window.title();
    expect(title).toBe("Budget Planner");
  });
});

test.describe("Electron startup smoke — fallback branch", () => {
  /**
  * The shared fixture provides an isolated Electron process. A test-only
  * environment control is enabled before the renderer reloads, so React's
  * normal preload and IPC path receives `usedFallback: true` data.
   */
  test.beforeEach(async ({ electronApp, window }) => {
    // Enable the main-process test fault control before reloading the real
    // preload → IPC → React → ForecastSection path.
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_FORECAST_FALLBACK"] = "1";
    });
    await window.reload();
  });

  test("Scenario 5: fallback label is visible when dashboard data indicates insufficient history", async ({ forecast }) => {
    // AC-3: explicit fallback label renders at the Electron runtime level when
    // the IPC response signals insufficient transaction history.
    await expect(forecast.sectionHeading).toBeVisible();
    await expect(forecast.fallbackLabel).toBeVisible();
    await expect(forecast.projectedDescription).not.toBeVisible();
  });
});
