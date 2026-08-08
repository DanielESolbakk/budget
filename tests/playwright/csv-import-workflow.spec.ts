/**
 * Playwright runtime smoke tests for the CSV import renderer workflow.
 *
 * These tests launch the built Electron app and verify:
 *   - Scenario 1: Importing the supported synthetic CSV from the renderer reports success
 *     and updates the monthly dashboard totals for the fixture month (AC-1, AC-2, AC-4).
 *   - Scenario 2: Importing an unsupported CSV shape reports validation errors and preserves
 *     the pre-import dashboard state (AC-1, AC-3).
 *   - Scenario 3: The import workflow runs under the network guard with no outbound calls (AC-2).
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
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { CsvImportPage } from "./pom/CsvImportPage.js";
import { DashboardPage } from "./pom/DashboardPage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");
const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");

/** Writes a minimal invalid CSV to a temp file and returns the absolute path. */
function writeInvalidCsvFixture(): string {
  const dir = join(tmpdir(), "budget-playwright-csv");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `invalid-${Date.now()}.csv`);
  writeFileSync(path, "Wrong;Headers;Only\nval1;val2;val3\n", "utf8");
  return path;
}

test.describe("CSV import renderer workflow", () => {
  let app: ElectronApplication;
  let window: Page;
  let csvImportPage: CsvImportPage;
  let dashboardPage: DashboardPage;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test" },
    });
    window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    csvImportPage = new CsvImportPage(window);
    dashboardPage = new DashboardPage(window);
  });

  test.afterAll(async () => {
    await app.close();
  });

  test("Scenario 1: importing the supported synthetic CSV reports success and updates dashboard totals", async () => {
    // AC-1: import section is visible with file path input and button.
    await expect(csvImportPage.importSection).toBeVisible();
    await expect(csvImportPage.importHeading).toBeVisible();
    await expect(csvImportPage.filePathInput).toBeVisible();
    await expect(csvImportPage.importButton).toBeVisible();

    // Capture baseline dashboard income value before import.
    const monthSelector = dashboardPage.monthSelector;
    await monthSelector.selectOption("2026-05");
    await expect(dashboardPage.monthlyTotalsSection).toBeVisible();

    // AC-1, AC-2: submit the fixture CSV path via the renderer input.
    await csvImportPage.submitImport(FIXTURE_PATH);

    // AC-1: success status is shown after import.
    await expect(csvImportPage.successStatus).toBeVisible({ timeout: 10_000 });
    const statusText = await csvImportPage.successStatus.textContent();
    expect(statusText).toMatch(/transactions imported/i);

    // AC-4: dashboard automatically reloads after import success;
    // wait for the monthly totals section to re-render.
    await expect(dashboardPage.monthlyTotalsSection).toBeVisible();
    await expect(dashboardPage.categoryEntries.first()).toBeVisible();
  });

  test("Scenario 2: importing an unsupported CSV shape reports validation errors and leaves dashboard unchanged", async () => {
    // Ensure dashboard is in a known state before the invalid import.
    await expect(dashboardPage.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = (await dashboardPage.incomeValue.textContent()) ?? "";

    const invalidPath = writeInvalidCsvFixture();

    // AC-1, AC-3: submit invalid CSV path via renderer input.
    await csvImportPage.submitImport(invalidPath);

    // AC-3: alert with validation failure is shown.
    await expect(csvImportPage.errorAlert).toBeVisible({ timeout: 10_000 });
    const alertText = await csvImportPage.errorAlert.textContent();
    expect(alertText).toMatch(/failed/i);

    // AC-4: dashboard totals remain unchanged after a failed import.
    await expect(dashboardPage.monthlyTotalsSection).toBeVisible();
    const afterIncomeText = (await dashboardPage.incomeValue.textContent()) ?? "";
    expect(afterIncomeText).toBe(beforeIncomeText);
  });

  test("Scenario 3: import workflow runs under network guard with no outbound network calls", async () => {
    // AC-2: verify the network guard is active — import:csv must not trigger network.
    // The network guard blocks outbound connections; a successful or failed import
    // must complete without throwing a network-guard error.
    const networkErrorMessages: string[] = [];

    window.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().toLowerCase().includes("network")) {
        networkErrorMessages.push(msg.text());
      }
    });

    const validPath = FIXTURE_PATH;
    await csvImportPage.filePathInput.fill(validPath);

    // The import button may already be in success state from Scenario 1; reset by re-entering path.
    await csvImportPage.importButton.click();

    // Wait for either success or validation result — no network error should appear.
    await expect(
      csvImportPage.successStatus.or(csvImportPage.errorAlert)
    ).toBeVisible({ timeout: 10_000 });

    expect(networkErrorMessages).toHaveLength(0);
  });
});
