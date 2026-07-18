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

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { CategoryTargetPage } from "./pom/CategoryTargetPage.js";
import { AppShellPage } from "./pom/AppShellPage.js";

const MAIN_ENTRY = fileURLToPath(new URL("../../out/main/index.js", import.meta.url));

async function launchCategoryTargetWindow(): Promise<{
  app: ElectronApplication;
  window: Page;
  targetPage: CategoryTargetPage;
  shell: AppShellPage;
}> {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: "test" },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  return {
    app,
    window,
    targetPage: new CategoryTargetPage(window),
    shell: new AppShellPage(window),
  };
}

test.describe("Category target entry renderer smoke", () => {
  /**
   * Tests in this describe block share one Electron instance (beforeAll/afterAll) because
   * Scenario 1 and Scenario 3 are stateless from the perspective of each other:
   * Scenario 1 clears the form inputs before finishing, and Scenario 3's validation error
   * state does not affect Scenario 1's assertions (visibility of form elements only).
   * Tests are defined in execution order so there is no execution-order ambiguity.
   */
  let app: ElectronApplication;
  let window: Page;
  let targetPage: CategoryTargetPage;
  let shell: AppShellPage;

  test.beforeAll(async () => {
    ({ app, window, targetPage, shell } = await launchCategoryTargetWindow());
  });

  test.afterAll(async () => {
    await app.close();
  });

  test("Scenario 1: category target entry form renders in the Electron window and is interactive", async () => {
    // AC-1: renderer path shows the target entry section without runtime errors.
    await expect(shell.heading).toBeVisible();
    await expect(targetPage.section).toBeVisible();
    await expect(targetPage.heading).toBeVisible();
    await expect(targetPage.categoryIdInput).toBeVisible();
    await expect(targetPage.targetAmountInput).toBeVisible();
    await expect(targetPage.saveButton).toBeVisible();

    // Verify form fields accept input.
    await targetPage.categoryIdInput.fill("groceries");
    await expect(targetPage.categoryIdInput).toHaveValue("groceries");
    await targetPage.targetAmountInput.fill("100");
    await expect(targetPage.targetAmountInput).toHaveValue("100");

    // Reset fields so subsequent tests start clean.
    await targetPage.categoryIdInput.fill("");
    await targetPage.targetAmountInput.fill("");
  });

  // Note: Scenario 2 (save + reload persistence) is intentionally placed in a
  // separate describe block below so it can use its own isolated Electron instance
  // with a clean in-memory store.  This describe block covers Scenario 1 and 3.
  test("Scenario 3: invalid input shows visible validation feedback without blank-screen failure", async () => {
    // AC-3: submitting an empty category ID shows an explicit validation error.
    await targetPage.categoryIdInput.fill("");
    await targetPage.targetAmountInput.fill("50");
    await targetPage.saveButton.click();

    await expect(targetPage.validationError).toBeVisible();
    // Confirm the app shell and section are still visible (no blank-screen regression).
    await expect(shell.heading).toBeVisible();
    await expect(targetPage.section).toBeVisible();

    // AC-3: submitting a negative amount also surfaces a validation error.
    await targetPage.categoryIdInput.fill("transport");
    await targetPage.targetAmountInput.fill("-10");
    await targetPage.saveButton.click();

    await expect(targetPage.validationError).toBeVisible();
    await expect(shell.heading).toBeVisible();
    await expect(targetPage.section).toBeVisible();
  });
});

test.describe("Category target entry renderer smoke — save and reload persistence", () => {
  /**
   * A separate Electron instance is used so the in-memory store starts fresh
   * (populated only with the default sample targets from main.ts) and the
   * save + reload flow runs in isolation from the render scenario tests.
   */
  let persistApp: ElectronApplication;
  let persistWindow: Page;
  let persistTargetPage: CategoryTargetPage;

  test.beforeAll(async () => {
    ({ app: persistApp, window: persistWindow, targetPage: persistTargetPage } =
      await launchCategoryTargetWindow());
  });

  test.afterAll(async () => {
    await persistApp.close();
  });

  test("Scenario 2: save interaction persists target value and reload preserves displayed value", async () => {
    // AC-2: save a target for a category not in the default store, then reload.
    // The default sampleTargetStore in main.ts includes groceries/2026-05 but not transport.
    await persistTargetPage.categoryIdInput.fill("transport");
    await persistTargetPage.targetAmountInput.fill("500");
    await persistTargetPage.saveButton.click();

    // Confirmation visible after save.
    await expect(persistTargetPage.savedConfirmation).toBeVisible();

    // The saved targets list should now include the new transport target.
    await expect(persistTargetPage.savedTargetsList).toBeVisible();
    await expect(persistTargetPage.savedTargetItem("transport")).toBeVisible();

    // Reload the window to verify persistence in the in-memory store (main process
    // keeps running across renderer reloads; the stored target survives the reload).
    await persistWindow.reload();
    await persistWindow.waitForLoadState("domcontentloaded");

    // After reload the saved targets list re-loads via categoryTarget:listByMonth IPC.
    await expect(persistTargetPage.savedTargetsList).toBeVisible();
    await expect(persistTargetPage.savedTargetItem("transport")).toBeVisible();
  });
});
