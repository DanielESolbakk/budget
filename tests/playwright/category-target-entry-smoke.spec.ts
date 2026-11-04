/**
 * Playwright runtime smoke tests for the category target entry renderer path.
 *
 * These tests launch the built Electron app and verify:
 *   - Existing targets can be edited and refresh dependent budget views (AC-1 / #69)
 *   - Invalid input shows visible validation feedback without blank-screen failure (AC-3 / #69)
 * Full application-relaunch persistence is covered in target-persistence-relaunch.spec.ts.
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

  test("editing a saved target opens the form with its current values", async ({ categoryTarget }) => {
    await categoryTarget.editTargetButton("groceries").click();

    await expect(categoryTarget.categoryIdInput).toBeVisible();
    await expect(categoryTarget.categoryIdInput).toHaveValue("groceries");
    await expect(categoryTarget.targetAmountInput).toHaveValue("90.00");
  });

  test("invalid input shows validation feedback without a blank-screen failure", async ({ appShell, categoryTarget }) => {
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

test.describe("Category target entry renderer smoke — save and refresh behavior", () => {
  test.beforeEach(async ({ dashboard }) => {
    await dashboard.monthSelector.selectOption("2026-05");
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
    const groceries = dashboard.targetVsActualSection.getByRole("row").filter({ hasText: "Groceries & food" });
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
    await expect(dashboard.targetVsActualSection.getByRole("row").filter({ hasText: "Groceries & food" }))
      .toContainText("90,00");
    await electronApp.evaluate(() => {
      delete process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"];
    });
    await failure.getByRole("button", { name: "Try again" }).click();
    await expect(failure).not.toBeVisible();
    await expect(dashboard.targetVsActualSection.getByRole("row").filter({ hasText: "Groceries & food" })
      .getByRole("cell").nth(3)).toContainText("75,00");
    await expect(dashboard.monthSelector).toHaveValue("2026-05");
  });
});
