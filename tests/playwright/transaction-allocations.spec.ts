import { test, expect } from "./fixtures/electron.js";

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

  test("keeps allocation controls keyboard reachable at desktop and compact widths", async ({
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
    await window.setViewportSize({ width: 390, height: 844 });
    await expect(allocationEditor.getByRole("button", { name: "Save allocations for Kiwi" }))
      .toBeVisible();
    const horizontalOverflow = await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBe(false);
  });
});
