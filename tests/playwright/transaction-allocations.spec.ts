import { _electron as electron } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { AppShellPage } from "./pom/AppShellPage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

test.describe("transaction category allocations", () => {
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
    await expect(allocationEditor.getByText(/Allocation total:/))
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

  test("shows the remaining amount separately from the allocation total", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).click();

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor.getByText(/Allocation total:/))
      .toContainText(/72,00\s*kr/);
    await expect(allocationEditor.getByText(/Remaining to allocate:/))
      .toContainText(/0,00\s*kr/);
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
    await expect(allocationEditor.getByText(/Remaining to allocate:/))
      .toContainText(/0,00\s*kr/);

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

    await expect(allocationEditor.getByRole("alert")).toContainText(/sum.*source transaction/i);
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
    await expect(allocationEditor.getByRole("button", { name: "Move allocation 1 down" }))
      .toBeVisible();

    await window.keyboard.press("Tab");
    await window.keyboard.press("Control+A");
    await window.keyboard.insertText("-40.00");
    await window.keyboard.press("Tab");
    await expect(allocationEditor.getByRole("button", { name: "Move allocation 1 down" }))
      .toBeFocused();
    await window.keyboard.press("Enter");
    await expect(allocationEditor.getByLabel("Allocation category 1")).toHaveValue("housing");
    await window.keyboard.press("Shift+Tab");
    await window.keyboard.press("Control+A");
    await window.keyboard.insertText("-32.00");
    for (let index = 0; index < 6; index++) {
      await window.keyboard.press("Tab");
    }
    await window.keyboard.press("Enter");
    await expect(transactionRow).toContainText("Housing");
    await expect(transactionRow).toContainText("Groceries & food");
    await expect(transactionRow).toContainText(/72,00\s*kr/);

    await window.setViewportSize({ width: 390, height: 844 });
    await transactionRow.getByRole("button", { name: "Edit category allocations for Kiwi" }).focus();
    await window.keyboard.press("Enter");
    await expect(allocationEditor.getByLabel("Allocation category 1")).toBeFocused();
    await window.keyboard.press("Tab");
    await window.keyboard.press("Control+A");
    await window.keyboard.insertText("-33.00");
    for (let index = 0; index < 3; index++) {
      await window.keyboard.press("Tab");
    }
    await window.keyboard.press("Control+A");
    await window.keyboard.insertText("-39.00");
    for (let index = 0; index < 3; index++) {
      await window.keyboard.press("Tab");
    }
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
    await expect(allocationEditor.getByLabel("Allocation category 2")).toHaveValue("housing");
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
