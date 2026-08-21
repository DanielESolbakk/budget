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

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { join } from "node:path";
import { AppShellPage } from "./pom/AppShellPage.js";
import { ForecastPage } from "./pom/ForecastPage.js";
import { PreloadBridgePage } from "./pom/PreloadBridgePage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

test.describe("Electron startup smoke", () => {
  let app: ElectronApplication;
  let window: Page;
  let shell: AppShellPage;
  let forecast: ForecastPage;
  let bridge: PreloadBridgePage;

  test.beforeEach(async () => {
    app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test" },
    });
    window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    shell = new AppShellPage(window);
    forecast = new ForecastPage(window);
    bridge = new PreloadBridgePage(window);
  });

  test.afterEach(async () => {
    await app.close();
  });

  test("Scenario 1: window opens and root shell renders without blank-screen failure", async () => {
    // AC-1, AC-4: renderer reaches a loaded state with the application heading.
    await expect(shell.heading).toBeVisible();
    await expect(shell.introText).toBeVisible();
  });

  test("Scenario 2: preload bridge exposes window.budgetApi with dashboard contract methods", async () => {
    // AC-2: confirm the preload bridge wires dashboard.getData and that the
    // resolved value exposes the expected monthlyTotals and forecast fields.
    const hasDashboard = await bridge.hasDashboardGetData();
    expect(hasDashboard).toBe(true);

    const fields = await bridge.getDashboardContractFields();
    expect(fields.hasMonthlyTotals).toBe(true);
    expect(fields.hasForecast).toBe(true);
  });

  test("Scenario 3: forecast section is visible and shows projected or fallback output", async () => {
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

  test("Scenario 4: application window title matches product name", async () => {
    // AC-4: minimal renderer path does not break window titling.
    const title = await window.title();
    expect(title).toBe("Budget Planner");
  });
});

test.describe("Electron startup smoke — fallback branch", () => {
  /**
   * Separate Electron instance used to test the insufficient-history fallback
   * label in isolation.  The IPC handler for `dashboard:getData` is replaced in
   * the main process before the renderer reloads, so React's useEffect receives
   * `usedFallback: true` data and renders the explicit fallback label.
   */
  let fallbackApp: ElectronApplication;
  let fallbackWindow: Page;
  let fallbackForecast: ForecastPage;

  test.beforeEach(async () => {
    fallbackApp = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test" },
    });
    fallbackWindow = await fallbackApp.firstWindow();
    await fallbackWindow.waitForLoadState("domcontentloaded");
    fallbackForecast = new ForecastPage(fallbackWindow);

    // Override the dashboard IPC handler in the main process to return
    // insufficient-history data.  This targets the IPC boundary directly so
    // the full renderer rendering path (preload → IPC → React → ForecastSection)
    // is exercised without altering the app's production source code.
    await fallbackApp.evaluate(async ({ ipcMain }) => {
      ipcMain.removeHandler("dashboard:getData");
      ipcMain.handle("dashboard:getData", async () => ({
        monthlyTotals: [],
        forecast: { usedFallback: true, entries: [] },
      }));
    });
    await fallbackWindow.reload();
  });

  test.afterEach(async () => {
    await fallbackApp.close();
  });

  test("Scenario 5: fallback label is visible when dashboard data indicates insufficient history", async () => {
    // AC-3: explicit fallback label renders at the Electron runtime level when
    // the IPC response signals insufficient transaction history.
    await expect(fallbackForecast.sectionHeading).toBeVisible();
    await expect(fallbackForecast.fallbackLabel).toBeVisible();
    await expect(fallbackForecast.projectedDescription).not.toBeVisible();
  });
});
