/**
 * Playwright runtime smoke tests for the category target entry renderer path.
 *
 * These tests launch the built Electron app and verify:
 *   - Category target entry form renders and is interactive (AC-1 / #69)
 *   - Save interaction persists a target value that survives window reload (AC-2 / #69)
 *   - Invalid input shows visible validation feedback without blank-screen failure (AC-3 / #69)
 *
 * Framework boundary:
 *   Vitest   -- unit, integration, and Vitest e2e smoke tests (tests/e2e/ and tests/integration/)
 *   Playwright -- Electron runtime flow validation (this file)
 *
 * Prerequisites: `npm run test:e2e:playwright` runs `npm run build` automatically via the
 * pretest script. To run manually first: `npm run build && npm run test:e2e:playwright`.
 */

import { test, expect } from "./fixtures/electron.js";

test.describe("Category target entry renderer smoke", () => {
  test.beforeEach(async ({ dashboard }) => {
    await dashboard.monthSelector.selectOption("2026-05");
  });

  test("Scenario 1: category target entry form renders in the Electron window and is interactive", async ({ appShell, categoryTarget }) => {
    // AC-1: renderer path shows the target entry section without runtime errors.
    await expect(appShell.heading).toBeVisible();
    await expect(categoryTarget.section).toBeVisible();
    await expect(categoryTarget.heading).toBeVisible();
    await expect(categoryTarget.addTargetButton).toBeVisible();
    await expect(categoryTarget.categoryIdInput).not.toBeVisible();

    await categoryTarget.addTargetButton.click();
    await expect(categoryTarget.categoryIdInput).toBeVisible();
    await expect(categoryTarget.targetAmountInput).toBeVisible();
    await expect(categoryTarget.saveButton).toBeVisible();

    // Verify form fields accept input.
    await categoryTarget.categoryIdInput.fill("groceries");
    await expect(categoryTarget.categoryIdInput).toHaveValue("groceries");
    await categoryTarget.targetAmountInput.fill("100");
    await expect(categoryTarget.targetAmountInput).toHaveValue("100");

    // Reset fields so subsequent tests start clean.
    await categoryTarget.categoryIdInput.fill("");
    await categoryTarget.targetAmountInput.fill("");
  });

  test("editing a saved target opens the form with its current values", async ({ categoryTarget }) => {
    await categoryTarget.editTargetButton("groceries").click();

    await expect(categoryTarget.categoryIdInput).toBeVisible();
    await expect(categoryTarget.categoryIdInput).toHaveValue("groceries");
    await expect(categoryTarget.targetAmountInput).toHaveValue("90.00");
  });

  // Note: Scenario 2 (save + reload persistence) is intentionally placed in a
  // separate describe block below so it can use its own isolated Electron instance
  // with a clean in-memory store.  This describe block covers Scenario 1 and 3.
  test("Scenario 3: invalid input shows visible validation feedback without blank-screen failure", async ({ appShell, categoryTarget }) => {
    // AC-3: submitting an empty category ID shows an explicit validation error.
    await categoryTarget.addTargetButton.click();
    await categoryTarget.categoryIdInput.fill("");
    await categoryTarget.targetAmountInput.fill("50");
    await categoryTarget.saveButton.click();

    await expect(categoryTarget.validationError).toHaveText("Category ID is required.");
    // Confirm the app shell and section are still visible (no blank-screen regression).
    await expect(appShell.heading).toBeVisible();
    await expect(categoryTarget.section).toBeVisible();

    // The number input rejects a negative amount through native validation.
    await categoryTarget.categoryIdInput.fill("transport");
    await categoryTarget.targetAmountInput.fill("-10");
    await categoryTarget.saveButton.click();

    expect(await categoryTarget.targetAmountInput.evaluate(
      (input: HTMLInputElement) => input.validity.rangeUnderflow
    )).toBe(true);
    await expect(categoryTarget.savedTargetItem("transport")).toHaveCount(0);
    await expect(appShell.heading).toBeVisible();
    await expect(categoryTarget.section).toBeVisible();
  });
});

test.describe("Category target entry renderer smoke — save and reload persistence", () => {
  /**
  * The shared Electron fixture gives this test its own application process
  * and database, so the save + reload flow is isolated from other scenarios.
   */
  test.beforeEach(async ({ dashboard }) => {
    await dashboard.monthSelector.selectOption("2026-05");
  });

  test("Scenario 2: save interaction persists target value and reload preserves displayed value", async ({ window, categoryTarget }) => {
    // AC-2: save a target for a category not in the default store, then reload.
    // The default sampleTargetStore in main.ts includes groceries/2026-05 but not transport.
    await categoryTarget.addTargetButton.click();
    await categoryTarget.categoryIdInput.fill("transport");
    await categoryTarget.targetAmountInput.fill("500");
    await categoryTarget.saveButton.click();

    // Confirmation visible after save.
    await expect(categoryTarget.savedConfirmation).toBeVisible();

    // The saved targets list should include the new transport amount.
    await expect(categoryTarget.savedTargetsList).toBeVisible();
    await expect(categoryTarget.savedTargetItem("transport")).toContainText(/500,00\s*kr/);

    // Reload the renderer while the main process remains running.
    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("combobox", { name: "Select month" }).selectOption("2026-05");

    // After reload the saved targets list re-loads via categoryTarget:listByMonth IPC.
    await expect(categoryTarget.savedTargetsList).toBeVisible();
    await expect(categoryTarget.savedTargetItem("transport")).toContainText(/500,00\s*kr/);
  });

  test("editing a saved target updates its existing value", async ({ categoryTarget }) => {
    await categoryTarget.editTargetButton("groceries").click();
    await categoryTarget.targetAmountInput.fill("125");
    await categoryTarget.saveButton.click();

    await expect(categoryTarget.savedConfirmation).toBeVisible();
    await expect(categoryTarget.savedTargetItem("groceries")).toContainText("125,00");
    await expect(categoryTarget.categoryIdInput).not.toBeVisible();
  });

  test("saving a target synchronizes its monthly comparison and over-target checks", async ({
    categoryTarget,
    dashboard,
  }) => {
    const groceries = dashboard.targetVsActualSection.getByRole("row").filter({ hasText: "groceries" });
    await categoryTarget.editTargetButton("groceries").click();
    await categoryTarget.targetAmountInput.fill("10");
    await categoryTarget.saveButton.click();

    await expect(categoryTarget.savedConfirmation).toBeVisible();
    await expect(groceries.getByRole("cell").nth(1)).toContainText("10,00");
    await expect(groceries.getByRole("cell").nth(2)).toContainText("85,00");
    await expect(groceries.getByRole("cell").nth(3)).toContainText("75,00");
    await expect(dashboard.overTargetLink).toHaveText("Review 1 category over target");
    await expect(dashboard.monthSelector).toHaveValue("2026-05");

    await categoryTarget.editTargetButton("groceries").click();
    await categoryTarget.targetAmountInput.fill("125");
    await categoryTarget.saveButton.click();
    await expect(groceries.getByRole("cell").nth(1)).toContainText("125,00");
    await expect(groceries.getByRole("cell").nth(3)).toContainText("−40,00");
    await expect(dashboard.monthlyAttention).toContainText("No categories over target.");
  });

  test("a failed post-save refresh explains stale review data and retries without losing the target", async ({
    categoryTarget,
    dashboard,
    electronApp,
    window,
  }) => {
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"] = "1";
    });
    await categoryTarget.editTargetButton("groceries").click();
    await categoryTarget.targetAmountInput.fill("10");
    await categoryTarget.saveButton.click();

    await expect(categoryTarget.savedConfirmation).toBeVisible();
    await expect(categoryTarget.savedTargetItem("groceries")).toContainText("10,00");
    const failure = window.getByRole("alert").filter({ hasText: "Review refresh failed" });
    await expect(failure).toBeVisible();
    await expect(dashboard.targetVsActualSection.getByRole("row").filter({ hasText: "groceries" }))
      .toContainText("90,00");
    await electronApp.evaluate(() => {
      delete process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"];
    });
    await failure.getByRole("button", { name: "Try again" }).click();
    await expect(failure).not.toBeVisible();
    await expect(dashboard.targetVsActualSection.getByRole("row").filter({ hasText: "groceries" })
      .getByRole("cell").nth(3)).toContainText("75,00");
    await expect(dashboard.monthSelector).toHaveValue("2026-05");
  });
});
