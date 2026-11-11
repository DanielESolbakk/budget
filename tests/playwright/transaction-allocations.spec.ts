import { _electron as electron, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { assertVisualScreenshot } from "./visualScreenshot.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

async function tabTo(window: Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await window.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Keyboard tab navigation did not reach the expected allocation control.");
}

test.describe("transaction category allocations", () => {
  test("explains how to split and shows the partial balance for an incomplete draft", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor.getByLabel("Allocation category 1")).toHaveValue("groceries");
    await expect(allocationEditor.getByLabel("Allocation amount 1")).toHaveValue("-72.00");
    await expect(allocationEditor.getByLabel("Allocation category 2")).toHaveValue("");
    await expect(allocationEditor.getByLabel("Allocation amount 2")).toHaveValue("");
    await expect(allocationEditor.getByText(/Allocated so far:/))
      .toContainText(/72,00\s*kr/);
    await expect(allocationEditor.getByText(/Balance after entered amounts:/))
      .toContainText(/0,00\s*kr/);
    await expect(allocationEditor).toContainText("1 allocation is incomplete.");
    await expect(allocationEditor).toContainText(
      "Your saved transaction stays unchanged. Adjust the first amount, then choose a second category and amount."
    );
    await expect(allocationEditor.getByRole("button", { name: "Move allocation 1 down" }))
      .toBeDisabled();
    await allocationEditor.getByRole("button", { name: "Add allocation" }).click();
    await expect(allocationEditor.getByLabel("Allocation category 3")).toHaveValue("");
    await expect(allocationEditor.getByLabel("Allocation amount 3")).toHaveValue("");
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).click();
    await expect(allocationEditor.getByRole("alert"))
      .toContainText("Choose a category for allocation 2.");
    await expect(transactionRow).toContainText("Groceries & food");
  });

  test("saves two allocations and leaves cashflow on the single source transaction", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await expect(transactionRow).toBeVisible();
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor).toBeVisible();
    await expect(allocationEditor.getByText(/Source transaction:/))
      .toContainText(/72,00\s*kr/);
    await expect(allocationEditor.getByText(/Allocated so far:/))
      .toContainText(/72,00\s*kr/);
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).click();

    await expect(transactionRow).toContainText("Groceries & food");
    await expect(transactionRow).toContainText("Housing");
    await expect(transactionRow).toContainText(/72,00\s*kr/);
    await expect(transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }))
      .toBeVisible();
  });

  test("removes a saved split and restores the original categorization", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).click();
    await expect(transactionRow).toContainText("Housing");

    await window.setViewportSize({ width: 1280, height: 800 });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();
    const restoreButton = allocationEditor.getByRole("button", {
      name: "Remove split for Kiwi",
    });
    await expect(restoreButton).toBeVisible();
    await assertVisualScreenshot("allocation-editor-split-desktop.png", () =>
      expect(allocationEditor).toHaveScreenshot("allocation-editor-split-desktop.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      }));

    await window.setViewportSize({ width: 390, height: 844 });
    await assertVisualScreenshot("allocation-editor-split-mobile.png", () =>
      expect(allocationEditor).toHaveScreenshot("allocation-editor-split-mobile.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      }));
    const horizontalOverflow = await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBe(false);
    await restoreButton.click();

    await expect(allocationEditor).toBeHidden();
    await expect(transactionRow).toContainText("Groceries & food");
    await expect(transactionRow).not.toContainText("Housing");
  });

  test("shows a partial balance and incomplete-row status until the draft is valid", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor.getByText(/Allocated so far:/))
      .toContainText(/72,00\s*kr/);
    await expect(allocationEditor.getByText(/Balance after entered amounts:/))
      .toContainText(/0,00\s*kr/);
    await expect(allocationEditor).toContainText("1 allocation is incomplete.");
  });

  test("associates category errors with their field and clears them after correction", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    const secondCategory = allocationEditor.getByLabel("Allocation category 2");
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).click();

    const error = allocationEditor.getByRole("alert");
    await expect(error).toHaveText("Choose a category for allocation 2.");
    await expect(secondCategory).toHaveAttribute("aria-invalid", "true");
    await expect(secondCategory).toHaveAttribute("aria-describedby", "transaction-allocation-error");

    await secondCategory.selectOption("housing");
    await expect(error).toHaveCount(0);
    await expect(secondCategory).not.toHaveAttribute("aria-invalid", "true");
  });

  test("announces the partial balance when amount entry leaves the field", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const ledger = window.getByRole("region", { name: "Ledger" });
    const allocationEditor = ledger.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    const firstAmount = allocationEditor.getByLabel("Allocation amount 1");
    await firstAmount.fill("-40.00");
    await firstAmount.press("Tab");

    const status = ledger.getByRole("status", { name: "Allocation status" });
    await expect(status).toContainText("Current allocation total");
    await expect(status).toContainText(/32,00\s*kr/);
    await expect(status).toContainText("1 allocation is incomplete");
  });

  test("announces successful allocation saves after the editor closes", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const ledger = window.getByRole("region", { name: "Ledger" });
    const allocationEditor = ledger.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).click();

    await expect(allocationEditor).toBeHidden();
    await expect(ledger.getByRole("status", { name: "Allocation status" }))
      .toContainText("Allocations saved for Kiwi.");
  });

  test("labels an excess allocation as over-allocated", async ({ appShell, window }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();
    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-40.00");

    await expect(allocationEditor.getByText(/Over-allocated by:/))
      .toContainText(/8,00\s*kr/);
    await expect(allocationEditor.getByText(/Remaining to allocate:/)).toHaveCount(0);
  });

  test("@visual Visual: allocation balance summary fits desktop and compact windows", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();
    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor.getByText(/Balance after entered amounts:/))
      .toContainText(/0,00\s*kr/);
    await expect(allocationEditor).toContainText("1 allocation is incomplete.");

    await window.setViewportSize({ width: 1280, height: 800 });
    await expect(allocationEditor).toHaveScreenshot("allocation-editor-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await window.setViewportSize({ width: 390, height: 844 });
    await expect(allocationEditor).toHaveScreenshot("allocation-editor-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await window.setViewportSize({ width: 1280, height: 800 });
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await expect(allocationEditor.getByText(/Allocation total:/)).toContainText(/72,00\s*kr/);
    await expect(allocationEditor).toHaveScreenshot("allocation-editor-valid-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
    await window.setViewportSize({ width: 390, height: 844 });
    await expect(allocationEditor).toHaveScreenshot("allocation-editor-valid-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await window.setViewportSize({ width: 1280, height: 800 });
    await allocationEditor.getByLabel("Allocation amount 2").fill("-40.00");
    await expect(allocationEditor.getByText(/Over-allocated by:/)).toContainText(/8,00\s*kr/);
    await expect(allocationEditor).toHaveScreenshot("allocation-editor-overallocated-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
    await window.setViewportSize({ width: 390, height: 844 });
    await expect(allocationEditor).toHaveScreenshot("allocation-editor-overallocated-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await window.setViewportSize({ width: 1280, height: 800 });
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).click();
    await expect(allocationEditor.getByRole("alert"))
      .toHaveText("Category allocations must sum exactly to the source transaction amount.");
    await expect(allocationEditor).toHaveScreenshot("allocation-editor-rejected-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
    await window.setViewportSize({ width: 390, height: 844 });
    await expect(allocationEditor).toHaveScreenshot("allocation-editor-rejected-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    const editorWidth = await allocationEditor.evaluate((element) =>
      element.getBoundingClientRect().width
    );
    expect(editorWidth).toBeLessThanOrEqual(390);
  });

  test("keeps the allocation balance in view while editing on a compact window", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    await window.setViewportSize({ width: 390, height: 844 });
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    const balance = allocationEditor.getByText(/Balance after entered amounts:/);
    const addButton = allocationEditor.getByRole("button", { name: "Add allocation" });
    for (let index = 0; index < 4; index++) {
      await addButton.click();
    }
    await allocationEditor.getByLabel("Allocation amount 6").scrollIntoViewIfNeeded();

    await expect(balance).toBeInViewport();
    const horizontalOverflow = await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBe(false);
  });

  test("adds and removes allocation rows with keyboard navigation", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    const editButton = transactionRow.getByRole("button", {
      name: "Edit category allocations for Kiwi",
    });
    await editButton.focus();
    await window.keyboard.press("Enter");

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    const addButton = allocationEditor.getByRole("button", { name: "Add allocation" });
    await tabTo(window, addButton);
    await expect(addButton).toBeFocused();
    await window.keyboard.press("Enter");

    const thirdCategory = allocationEditor.getByLabel("Allocation category 3");
    const removeButton = allocationEditor.getByRole("button", { name: "Remove allocation 3" });
    await expect(thirdCategory).toBeVisible();
    await expect(addButton).toBeFocused();
    await window.keyboard.press("Shift+Tab");
    await expect(removeButton).toBeFocused();
    await window.keyboard.press("Enter");

    await expect(thirdCategory).toHaveCount(0);
    await expect(allocationEditor.getByRole("button", { name: /Remove allocation/ })).toHaveCount(0);
  });

  test("announces an invalid sum and preserves the previous allocations", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).click();
    await expect(transactionRow).toContainText("Groceries & food");

    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();
    await allocationEditor.getByLabel("Allocation amount 1").fill("-30.00");
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).click();

    await expect(allocationEditor.getByRole("alert"))
      .toHaveText("Category allocations must sum exactly to the source transaction amount.");
    await expect(transactionRow).toContainText("Groceries & food");
    await expect(transactionRow).toContainText("Housing");
  });

  test("creates, edits, and reorders allocations with the keyboard at desktop and compact widths", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    await window.setViewportSize({ width: 1280, height: 800 });
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).focus();
    await window.keyboard.press("Enter");

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor.getByLabel("Allocation category 1")).toBeFocused();
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    const moveDown = allocationEditor.getByRole("button", { name: "Move allocation 1 down" });
    await moveDown.focus();
    await window.keyboard.press("Enter");
    await expect(allocationEditor.getByLabel("Allocation category 1")).toHaveValue("housing");
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).focus();
    await window.keyboard.press("Enter");
    await expect(transactionRow).toContainText("Housing");
    await expect(transactionRow).toContainText("Groceries & food");
    await expect(transactionRow).toContainText(/72,00\s*kr/);

    await window.setViewportSize({ width: 390, height: 844 });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).focus();
    await window.keyboard.press("Enter");
    await expect(allocationEditor.getByLabel("Allocation category 1")).toBeFocused();
    await allocationEditor.getByLabel("Allocation amount 1").fill("-33.00");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-39.00");
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).focus();
    await window.keyboard.press("Enter");
    await expect(transactionRow).toContainText(/72,00\s*kr/);
    await expect(allocationEditor).toBeHidden();
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).focus();
    await window.keyboard.press("Enter");
    await expect(allocationEditor.getByLabel("Allocation amount 1")).toHaveValue("-33.00");
    await expect(allocationEditor.getByLabel("Allocation amount 2")).toHaveValue("-39.00");
    const horizontalOverflow = await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBe(false);
  });

  test("retains the reordered category sequence after saving allocations", async ({ appShell, window }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor.getByLabel("Allocation category 1")).toHaveValue("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByRole("button", { name: "Move allocation 1 down" }).click();
    await expect(allocationEditor.getByLabel("Allocation category 1")).toHaveValue("housing");
    await expect(allocationEditor.getByLabel("Allocation category 2")).toHaveValue("groceries");

    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).click();
    await expect(allocationEditor).toBeHidden();
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();
    await expect(allocationEditor.getByLabel("Allocation category 1")).toHaveValue("housing");
    await expect(allocationEditor.getByLabel("Allocation category 2")).toHaveValue("groceries");
  });

  test("reloads saved allocation details after an Electron relaunch", async ({
    appShell,
    databasePath,
    electronApp,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }).click();
    await expect(transactionRow).toContainText("Groceries & food");
    await expect(transactionRow).toContainText("Housing");

    await electronApp.close();
    const restartedApp = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BUDGET_DB_PATH: databasePath,
      },
    });

    try {
      const restartedWindow = await restartedApp.firstWindow();
      await restartedWindow.waitForLoadState("domcontentloaded");
      await new AppShellPage(restartedWindow).openWorkspace("Transactions");
      const restartedRow = restartedWindow.getByRole("row", { name: /Ledger transaction Kiwi/ });
      await expect(restartedRow).toContainText("Groceries & food");
      await expect(restartedRow).toContainText("Housing");

      await restartedRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();
      const restartedEditor = restartedWindow.getByRole("region", {
        name: "Transaction category allocations for Kiwi",
      });
      await expect(restartedEditor.getByLabel("Allocation category 1")).toHaveValue("groceries");
      await expect(restartedEditor.getByLabel("Allocation amount 1")).toHaveValue("-40.00");
      await expect(restartedEditor.getByLabel("Allocation category 2")).toHaveValue("housing");
      await expect(restartedEditor.getByLabel("Allocation amount 2")).toHaveValue("-32.00");
    } finally {
      await restartedApp.close();
    }
  });

});
