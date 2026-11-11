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
import { DatabaseSync } from "node:sqlite";

test.describe("Category target entry renderer smoke", () => {
  test.beforeEach(async ({ dashboard }) => {
    await dashboard.selectMonth("2026-05");
  });

  test("Scenario 1: category target entry form renders in the Electron window and is interactive", async ({ appShell, categoryTarget }) => {
    // AC-1: renderer path shows the target entry section without runtime errors.
    await expect(appShell.heading).toBeVisible();
    await expect(categoryTarget.section).toBeVisible();
    await expect(categoryTarget.heading).toBeVisible();
    await expect(categoryTarget.addTargetButton).toBeVisible();
    await expect(categoryTarget.categorySelect).not.toBeVisible();

    await categoryTarget.addTargetButton.click();
    await expect(categoryTarget.categorySelect).toBeVisible();
    await expect(categoryTarget.targetAmountInput).toBeVisible();
    await expect(categoryTarget.saveButton).toBeVisible();

    // Verify form fields accept input.
    await categoryTarget.categorySelect.selectOption("groceries");
    await expect(categoryTarget.categorySelect).toHaveValue("groceries");
    await categoryTarget.targetAmountInput.fill("100");
    await expect(categoryTarget.targetAmountInput).toHaveValue("100");
  });

  test("category target entry offers named categories instead of an internal ID field", async ({
    categoryTarget,
  }) => {
    await categoryTarget.addTargetButton.click();

    await expect(categoryTarget.categorySelect).toBeVisible();
    expect(await categoryTarget.categorySelect.getByRole("option", {
      name: "Groceries & food",
    }).getAttribute("value")).toBe("groceries");
    await expect(categoryTarget.section.getByRole("textbox", { name: "Category ID" })).toHaveCount(0);
  });

  test("editing a saved target opens the form with its current values", async ({ categoryTarget }) => {
    await categoryTarget.editTargetButton("groceries").click();

    await expect(categoryTarget.categorySelect).toBeVisible();
    await expect(categoryTarget.categorySelect).toHaveValue("groceries");
    await expect(categoryTarget.categorySelect).toBeDisabled();
    await expect(categoryTarget.targetAmountInput).toHaveValue("90.00");
  });

  for (const action of ["add", "edit"] as const) {
    test(`unfinished target ${action} prevents accidental month and form replacement until cancelled`, async ({
      categoryTarget, dashboard, window,
    }, testInfo) => {
      const opener = action === "add" ? categoryTarget.addTargetButton : categoryTarget.editTargetButton("groceries");
      await opener.click();
      await categoryTarget.targetAmountInput.fill("125,50");
      await expect(dashboard.monthSelector).toBeDisabled();
      await expect(categoryTarget.addTargetButton).toBeDisabled();
      await expect(categoryTarget.editTargetButton("groceries")).toBeDisabled();
      await expect(categoryTarget.section.getByText(/save or cancel.*before/i)).toBeVisible();
      await expect(categoryTarget.targetAmountInput).toHaveValue("125,50");
      if (action === "edit") {
        for (const width of [1280, 390]) {
          await window.setViewportSize({ width, height: 900 });
          const path = testInfo.outputPath(`target-draft-${width}.png`);
          await categoryTarget.section.screenshot({ path, animations: "disabled" });
          await testInfo.attach(`Target draft ${width}`, { path, contentType: "image/png" });
          const dimensions = await window.evaluate(() => ({
            width: globalThis.window.innerWidth,
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          }));
          expect(dimensions.width).toBe(width);
          expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
        }
      }
      await categoryTarget.section.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dashboard.monthSelector).toBeEnabled();
      await expect(opener).toBeEnabled();
      await expect(opener).toBeFocused();
      await dashboard.selectMonth("2026-04");
      await expect(dashboard.monthSelector).toHaveValue("2026-04");
    });
  }

  for (const [amount, expectedMinor] of [["12,50", 1250], ["90071992547409.91", Number.MAX_SAFE_INTEGER]] as const) {
    test(`target NOK entry saves ${amount} exactly and edits without losing precision`, async ({ categoryTarget, dashboard, window }) => {
      await categoryTarget.addTargetButton.click();
      const amountInput = categoryTarget.section.getByLabel("Target amount", { exact: true });
      await expect(amountInput).toHaveAttribute("type", "text");
      await categoryTarget.categorySelect.selectOption("transport");
      await amountInput.fill(amount);
      await categoryTarget.saveButton.click();
      await expect(categoryTarget.savedConfirmation).toBeVisible();
      const displayedAmount = expectedMinor === Number.MAX_SAFE_INTEGER ? "409,91" : "12,50";
      await expect(categoryTarget.savedTargetItem("transport")).toContainText(displayedAmount);
      const row = dashboard.targetVsActualSection.getByRole("row").filter({ hasText: "Transport" });
      await expect(row.getByRole("cell").nth(1)).toContainText(displayedAmount);
      await expect(row.getByRole("cell").nth(3)).toContainText(displayedAmount);
      await expect(row.getByRole("cell").nth(3)).toContainText("under target");
      const saved = await window.evaluate(() => globalThis.window.budgetApi.categoryTargets.listByMonth("2026-05"));
      expect(saved.find((target) => target.categoryId === "transport")?.targetMinor).toBe(expectedMinor);
      await categoryTarget.editTargetButton("transport").click();
      await expect(amountInput).toHaveValue(amount.replace(",", "."));
      await expect(amountInput).toBeFocused();
    });
  }

  for (const amount of ["-1", "12,345", "90071992547409.92", "12abc"]) {
    test(`target entry rejects ${amount} with field-specific recoverable feedback`, async ({ categoryTarget }) => {
      await categoryTarget.addTargetButton.click();
      const amountInput = categoryTarget.section.getByLabel("Target amount", { exact: true });
      await expect(amountInput).toHaveAttribute("type", "text");
      await categoryTarget.categorySelect.selectOption("transport");
      await amountInput.fill(amount);
      await categoryTarget.saveButton.click();
      await expect(amountInput).toHaveAttribute("aria-invalid", "true");
      await expect(amountInput).toBeFocused();
      await expect(categoryTarget.section.getByRole("alert")).toContainText("non-negative NOK amount");
      await categoryTarget.categorySelect.selectOption("groceries");
      await expect(categoryTarget.section.getByRole("alert")).toBeVisible();
      await amountInput.fill("0");
      await expect(categoryTarget.section.getByRole("alert")).toBeHidden();
      await expect(amountInput).not.toHaveAttribute("aria-invalid", "true");
      await categoryTarget.saveButton.click();
      await expect(categoryTarget.savedTargetItem("groceries")).toContainText("0,00");
    });
  }

  for (const action of ["add", "edit"] as const) {
    test(`cancelling a target ${action} restores focus to its opener`, async ({ categoryTarget }) => {
      const opener = action === "add" ? categoryTarget.addTargetButton : categoryTarget.editTargetButton("groceries");
      await opener.click();
      await categoryTarget.section.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(opener).toBeFocused();
      await expect(categoryTarget.section.getByRole("form")).toBeHidden();
    });

    test(`saving a target ${action} restores focus after removing the form`, async ({ categoryTarget }) => {
      const opener = action === "add" ? categoryTarget.addTargetButton : categoryTarget.editTargetButton("groceries");
      await opener.click();
      if (action === "add") await categoryTarget.categorySelect.selectOption("transport");
      await categoryTarget.targetAmountInput.fill("125.50");
      await categoryTarget.saveButton.click();
      await expect(categoryTarget.savedConfirmation).toBeVisible();
      await expect(opener).toBeFocused();
    });
  }

  test("target save failure keeps its draft and offers recovery without exposing raw errors first", async ({
    categoryTarget, databasePath,
  }) => {
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("BEGIN IMMEDIATE");
      await categoryTarget.editTargetButton("groceries").click();
      await categoryTarget.targetAmountInput.fill("125.50");
      await categoryTarget.saveButton.click();
      await expect(categoryTarget.section.getByRole("alert")).toContainText("Check the saved targets before trying again");
      await expect(categoryTarget.targetAmountInput).toHaveValue("125.50");
      await expect(categoryTarget.section.getByRole("button", { name: "Save target" })).toBeEnabled();
      await expect(categoryTarget.section.getByText("Error details", { exact: true })).toBeVisible();
      database.exec("ROLLBACK");
      await categoryTarget.saveButton.click();
      await expect(categoryTarget.savedTargetItem("groceries")).toContainText("125,50");
    } finally {
      database.close();
    }
  });

  test("uncertain target save can refresh persisted values without losing its draft", async ({
    categoryTarget, databasePath, dashboard, window,
  }) => {
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("BEGIN IMMEDIATE");
      await categoryTarget.editTargetButton("groceries").click();
      await categoryTarget.targetAmountInput.fill("125.50");
      await categoryTarget.saveButton.click();
      await expect(categoryTarget.section.getByRole("alert")).toContainText("could not be confirmed");
      database.exec("ROLLBACK");
      await window.evaluate(() => globalThis.window.budgetApi.categoryTargets.upsert({
        yearMonth: "2026-05", categoryId: "groceries", targetMinor: 10000,
      }));
      await expect(categoryTarget.savedTargetItem("groceries")).toContainText("90,00");
      await categoryTarget.section.getByRole("button", { name: "Refresh saved targets", exact: true }).click();
      await expect(categoryTarget.savedTargetItem("groceries")).toContainText("100,00");
      await expect(categoryTarget.targetAmountInput).toHaveValue("125.50");
      await expect(dashboard.monthSelector).toBeDisabled();
      await categoryTarget.saveButton.click();
      await expect(categoryTarget.savedTargetItem("groceries")).toContainText("125,50");
      await expect(dashboard.monthSelector).toBeEnabled();
    } finally {
      database.close();
    }
  });

  // Note: Scenario 2 (save + reload persistence) is intentionally placed in a
  // separate describe block below so it can use its own isolated Electron instance
  // with a clean in-memory store.  This describe block covers Scenario 1 and 3.
  test("Scenario 3: invalid input shows visible validation feedback without blank-screen failure", async ({ appShell, categoryTarget }) => {
    // AC-3: the category picker prevents saving until a category is selected.
    await categoryTarget.addTargetButton.click();
    await categoryTarget.targetAmountInput.fill("50");
    await categoryTarget.saveButton.click();

    await expect(categoryTarget.categorySelect).toHaveAttribute("aria-invalid", "true");
    await expect(categoryTarget.categorySelect).toBeFocused();
    await expect(categoryTarget.section.getByRole("alert")).toHaveText("Choose a category.");
    // Confirm the app shell and section are still visible (no blank-screen regression).
    await expect(appShell.heading).toBeVisible();
    await expect(categoryTarget.section).toBeVisible();

    // A negative target is rejected with actionable field feedback.
    await categoryTarget.categorySelect.selectOption("transport");
    await categoryTarget.targetAmountInput.fill("-10");
    await categoryTarget.saveButton.click();

    await expect(categoryTarget.targetAmountInput).toHaveAttribute("aria-invalid", "true");
    await expect(categoryTarget.section.getByRole("alert")).toContainText("non-negative NOK amount");
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
    await dashboard.selectMonth("2026-05");
  });

  test("Scenario 2: save interaction persists target value and reload preserves displayed value", async ({ window, categoryTarget, dashboard }) => {
    // AC-2: save a target for a category not in the default store, then reload.
    // The default sampleTargetStore in main.ts includes groceries/2026-05 but not transport.
    await categoryTarget.addTargetButton.click();
    await categoryTarget.categorySelect.selectOption("transport");
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
    await dashboard.selectMonth("2026-05");
    await window.getByText("Manage category targets", { exact: true }).click();

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
    await expect(categoryTarget.categorySelect).not.toBeVisible();
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
    await expect(groceries.getByRole("cell").nth(3)).toHaveText(/75,00\s*kr over target/);
    await expect(dashboard.overTargetLink).toHaveText("Review 1 category over target");
    await expect(dashboard.monthSelector).toHaveValue("2026-05");

    await categoryTarget.editTargetButton("groceries").click();
    await categoryTarget.targetAmountInput.fill("125");
    await categoryTarget.saveButton.click();
    await expect(groceries.getByRole("cell").nth(1)).toContainText("125,00");
    await expect(groceries.getByRole("cell").nth(3)).toHaveText(/40,00\s*kr under target/);
    await expect(dashboard.monthlyAttention).toContainText("No category reviews or over-target categories this month.");
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
