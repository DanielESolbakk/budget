/**
 * Playwright runtime startup smoke guard for the Electron application.
 *
 * These tests launch the built Electron app and assert on:
 *   - Window boot and root render without a blank-screen failure (AC-4 / AC-1)
 *   - Preload bridge availability and dashboard contract fields (AC-2)
 *   - Forecast section output visibility in the renderer (AC-1)
 *   - Forecast fallback or projected-month rendering path is active (AC-3)
 *
 * Framework boundary:
 *   Vitest   -- unit, integration, and component-level smoke tests
 *   Playwright -- Electron runtime flow validation (this file)
 *
 * Prerequisites: run `npm run build` before executing these tests.
 */

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { join } from "node:path";
import { AppShellPage } from "./pom/AppShellPage.js";
import { ForecastPage } from "./pom/ForecastPage.js";
import { PreloadBridgePage } from "./pom/PreloadBridgePage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

/**
 * Shared Electron app instance for all scenarios in this file.
 *
 * One Electron process is launched in `beforeAll` and closed in `afterAll`.
 * The playwright.config.ts `fullyParallel: false` setting prevents concurrent
 * test file execution, so these module-level variables are safe to share
 * across the sequential tests in this describe block.
 */
let app: ElectronApplication;
let window: Page;
let shell: AppShellPage;
let forecast: ForecastPage;
let bridge: PreloadBridgePage;

test.beforeAll(async () => {
  app = await electron.launch({ args: [MAIN_ENTRY] });
  window = await app.firstWindow();
  shell = new AppShellPage(window);
  forecast = new ForecastPage(window);
  bridge = new PreloadBridgePage(window);
});

test.afterAll(async () => {
  await app.close();
});

test.describe("Electron startup smoke", () => {
  test("Scenario 1: window opens and root shell renders without blank-screen failure", async () => {
    // AC-1, AC-4: renderer reaches a loaded state with the application heading.
    await shell.waitForShell();
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
    await forecast.waitForSection();
    await forecast.assertForecastOutputVisible();

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
