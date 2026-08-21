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

  test.beforeEach(async () => {
    app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test" },
    });
    window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    csvImportPage = new CsvImportPage(window);
    dashboardPage = new DashboardPage(window);
  });

  test.afterEach(async () => {
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
    const beforeIncomeText = ((await dashboardPage.incomeValue.textContent()) ?? "").trim();

    // AC-1, AC-2: submit the fixture CSV path via the renderer input.
    await csvImportPage.submitImport(FIXTURE_PATH);

    // AC-1: success status is shown after import.
    await expect(csvImportPage.successStatus).toBeVisible({ timeout: 10_000 });
    const statusText = await csvImportPage.successStatus.textContent();
    expect(statusText).toMatch(/transactions imported/i);

    // The app reloads dashboard state after successful import and remounts the import section.
    // Wait for the remounted input to clear as a stable completion signal.
    await expect(csvImportPage.filePathInput).toHaveValue("", { timeout: 10_000 });

    // AC-4: dashboard automatically reloads after import success;
    // wait for the monthly totals section to re-render and values to change.
    await expect(dashboardPage.monthlyTotalsSection).toBeVisible();
    await expect(dashboardPage.categoryEntries.first()).toBeVisible();
    await expect
      .poll(async () => ((await dashboardPage.incomeValue.textContent()) ?? "").trim(), {
        timeout: 10_000,
      })
      .not.toBe(beforeIncomeText);
  });

  test("Regression: successful import keeps success feedback visible before and after dashboard refresh", async () => {
    await expect(csvImportPage.importSection).toBeVisible();

    await csvImportPage.submitImport(FIXTURE_PATH);

    // Regression guard for the previous refresh race: success feedback must be observable.
    await expect(csvImportPage.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(csvImportPage.successStatus).toContainText(/transactions imported/i);

    // Refresh now runs without tearing down the section and clears the input for next import.
    await expect(csvImportPage.filePathInput).toHaveValue("", { timeout: 10_000 });
    await expect(csvImportPage.importSection).toBeVisible();
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
    const onConsole = (msg: { type: () => string; text: () => string }): void => {
      if (msg.type() === "error" && msg.text().toLowerCase().includes("network")) {
        networkErrorMessages.push(msg.text());
      }
    };

    window.on("console", onConsole);

    // Use a deterministic invalid shape so completion feedback remains visible in this view.
    const invalidPath = writeInvalidCsvFixture();
    await csvImportPage.filePathInput.fill(invalidPath);

    // Trigger the import flow while network guard is active.
    await csvImportPage.importButton.click();

    // Wait for explicit completion feedback and assert network-guard silence.
    await expect(csvImportPage.errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(csvImportPage.errorAlert).toContainText(/failed/i);

    window.off("console", onConsole);
    expect(networkErrorMessages).toHaveLength(0);
  });
});
