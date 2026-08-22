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

import { test, expect } from "./fixtures/electron.js";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");

/** Writes a minimal invalid CSV to a temp file and returns the absolute path. */
function writeInvalidCsvFixture(): string {
  const dir = join(tmpdir(), "budget-playwright-csv");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `invalid-${randomUUID()}.csv`);
  writeFileSync(path, "Wrong;Headers;Only\nval1;val2;val3\n", "utf8");
  return path;
}

test.describe("CSV import renderer workflow", () => {
  test("Scenario 1: importing the supported synthetic CSV reports success and updates dashboard totals", async ({ csvImport, dashboard }) => {
    // AC-1: import section is visible with file path input and button.
    await expect(csvImport.importSection).toBeVisible();
    await expect(csvImport.importHeading).toBeVisible();
    await expect(csvImport.filePathInput).toBeVisible();
    await expect(csvImport.importButton).toBeVisible();

    // Capture baseline dashboard income value before import.
    const monthSelector = dashboard.monthSelector;
    await monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = ((await dashboard.incomeValue.textContent()) ?? "").trim();

    // AC-1, AC-2: submit the fixture CSV path via the renderer input.
    await csvImport.submitImport(FIXTURE_PATH);

    // AC-1: success status is shown after import.
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    const statusText = await csvImport.successStatus.textContent();
    expect(statusText).toMatch(/transactions imported/i);

    // The app reloads dashboard state after successful import and remounts the import section.
    // Wait for the remounted input to clear as a stable completion signal.
    await expect(csvImport.filePathInput).toHaveValue("", { timeout: 10_000 });

    // AC-4: dashboard automatically reloads after import success;
    // wait for the monthly totals section to re-render and values to change.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryEntries.first()).toBeVisible();
    await expect
      .poll(async () => ((await dashboard.incomeValue.textContent()) ?? "").trim(), {
        timeout: 10_000,
      })
      .not.toBe(beforeIncomeText);
  });

  test("Regression: successful import keeps success feedback visible before and after dashboard refresh", async ({ csvImport }) => {
    await expect(csvImport.importSection).toBeVisible();

    await csvImport.submitImport(FIXTURE_PATH);

    // Regression guard for the previous refresh race: success feedback must be observable.
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.successStatus).toContainText(/transactions imported/i);

    // Refresh now runs without tearing down the section and clears the input for next import.
    await expect(csvImport.filePathInput).toHaveValue("", { timeout: 10_000 });
    await expect(csvImport.importSection).toBeVisible();
  });

  test("Regression: refresh failure preserves the loaded dashboard and shows recovery feedback", async ({ csvImport, dashboard, electronApp, window }) => {
    await expect(dashboard.monthlyTotalsSection).toBeVisible();

    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"] = "1";
    });

    await csvImport.submitImport(FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(dashboard.monthlyTotalsSection).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.importSection).toBeVisible();
    await expect(window.getByRole("alert")).toContainText("Review refresh failed");
    await expect(window.getByRole("alert")).toContainText("Synthetic dashboard refresh failure.");
  });

  test("Regression: successful import preserves the currently selected month", async ({ csvImport, dashboard }) => {
    const selectedMonth = await dashboard.selectDifferentMonth("2026-05");

    await csvImport.submitImport(FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.filePathInput).toHaveValue("", { timeout: 10_000 });
    await expect(dashboard.monthSelector).toHaveValue(selectedMonth, { timeout: 10_000 });
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
  });

  test("Scenario 2: importing an unsupported CSV shape reports validation errors and leaves dashboard unchanged", async ({ csvImport, dashboard }) => {
    // Ensure dashboard is in a known state before the invalid import.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";

    const invalidPath = writeInvalidCsvFixture();

    // AC-1, AC-3: submit invalid CSV path via renderer input.
    await csvImport.submitImport(invalidPath);

    // AC-3: alert with validation failure is shown.
    await expect(csvImport.errorAlert).toBeVisible({ timeout: 10_000 });
    const alertText = await csvImport.errorAlert.textContent();
    expect(alertText).toMatch(/failed/i);

    // AC-4: dashboard totals remain unchanged after a failed import.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const afterIncomeText = (await dashboard.incomeValue.textContent()) ?? "";
    expect(afterIncomeText).toBe(beforeIncomeText);
  });

  test("Scenario 3: import workflow runs under network guard with no outbound network calls", async ({ csvImport, window }) => {
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
    await csvImport.filePathInput.fill(invalidPath);

    // Trigger the import flow while network guard is active.
    await csvImport.importButton.click();

    // Wait for explicit completion feedback and assert network-guard silence.
    await expect(csvImport.errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(csvImport.errorAlert).toContainText(/failed/i);

    window.off("console", onConsole);
    expect(networkErrorMessages).toHaveLength(0);
  });
});
