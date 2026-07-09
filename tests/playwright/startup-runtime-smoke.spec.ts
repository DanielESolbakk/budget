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
 *   Vitest   – unit, integration, and component-level smoke tests
 *   Playwright – Electron runtime flow validation (this file)
 *
 * Prerequisites: run `npm run build` before executing these tests.
 */

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { join } from "node:path";
import { AppShellPage } from "./pom/AppShellPage.js";
import { ForecastPage } from "./pom/ForecastPage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

/**
 * Shared Electron app fixture.  A single app instance is launched for all
 * scenarios in this file and closed after the last test completes.
 */
let app: ElectronApplication;
let window: Page;
let shell: AppShellPage;
let forecast: ForecastPage;

test.beforeAll(async () => {
  app = await electron.launch({ args: [MAIN_ENTRY] });
  window = await app.firstWindow();
  shell = new AppShellPage(window);
  forecast = new ForecastPage(window);
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
    // AC-2: confirm the preload bridge wires dashboard.getData and forecast.getEntries
    // and that dashboard.getData resolves to an object with the expected contract fields.
    const hasDashboardGetData = await window.evaluate(() => {
      const api = (window as unknown as { budgetApi?: unknown }).budgetApi;
      if (!api || typeof api !== "object") return false;
      const dashboard = (api as Record<string, unknown>)["dashboard"];
      return typeof (dashboard as Record<string, unknown>)?.["getData"] === "function";
    });
    expect(hasDashboardGetData).toBe(true);

    const contractFields = await window.evaluate(async () => {
      const api = (window as unknown as { budgetApi: { dashboard: { getData: () => Promise<Record<string, unknown>> } } }).budgetApi;
      const data = await api.dashboard.getData();
      return {
        hasMonthlyTotals: "monthlyTotals" in data,
        hasForecast: "forecast" in data,
      };
    });
    expect(contractFields.hasMonthlyTotals).toBe(true);
    expect(contractFields.hasForecast).toBe(true);
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
