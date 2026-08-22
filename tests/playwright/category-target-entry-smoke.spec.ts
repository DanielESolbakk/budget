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
  test("Scenario 1: category target entry form renders in the Electron window and is interactive", async ({ appShell, categoryTarget }) => {
    // AC-1: renderer path shows the target entry section without runtime errors.
    await expect(appShell.heading).toBeVisible();
    await expect(categoryTarget.section).toBeVisible();
    await expect(categoryTarget.heading).toBeVisible();
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

  // Note: Scenario 2 (save + reload persistence) is intentionally placed in a
  // separate describe block below so it can use its own isolated Electron instance
  // with a clean in-memory store.  This describe block covers Scenario 1 and 3.
  test("Scenario 3: invalid input shows visible validation feedback without blank-screen failure", async ({ appShell, categoryTarget }) => {
    // AC-3: submitting an empty category ID shows an explicit validation error.
    await categoryTarget.categoryIdInput.fill("");
    await categoryTarget.targetAmountInput.fill("50");
    await categoryTarget.saveButton.click();

    await expect(categoryTarget.validationError).toBeVisible();
    // Confirm the app shell and section are still visible (no blank-screen regression).
    await expect(appShell.heading).toBeVisible();
    await expect(categoryTarget.section).toBeVisible();

    // AC-3: submitting a negative amount also surfaces a validation error.
    await categoryTarget.categoryIdInput.fill("transport");
    await categoryTarget.targetAmountInput.fill("-10");
    await categoryTarget.saveButton.click();

    await expect(categoryTarget.validationError).toBeVisible();
    await expect(appShell.heading).toBeVisible();
    await expect(categoryTarget.section).toBeVisible();
  });
});

test.describe("Category target entry renderer smoke — save and reload persistence", () => {
  /**
  * The shared Electron fixture gives this test its own application process
  * and database, so the save + reload flow is isolated from other scenarios.
   */
  test("Scenario 2: save interaction persists target value and reload preserves displayed value", async ({ window, categoryTarget }) => {
    // AC-2: save a target for a category not in the default store, then reload.
    // The default sampleTargetStore in main.ts includes groceries/2026-05 but not transport.
    await categoryTarget.categoryIdInput.fill("transport");
    await categoryTarget.targetAmountInput.fill("500");
    await categoryTarget.saveButton.click();

    // Confirmation visible after save.
    await expect(categoryTarget.savedConfirmation).toBeVisible();

    // The saved targets list should now include the new transport target.
    await expect(categoryTarget.savedTargetsList).toBeVisible();
    await expect(categoryTarget.savedTargetItem("transport")).toBeVisible();

    // Reload the window to verify persistence in the in-memory store (main process
    // keeps running across renderer reloads; the stored target survives the reload).
    await window.reload();
    await window.waitForLoadState("domcontentloaded");

    // After reload the saved targets list re-loads via categoryTarget:listByMonth IPC.
    await expect(categoryTarget.savedTargetsList).toBeVisible();
    await expect(categoryTarget.savedTargetItem("transport")).toBeVisible();
  });
});
