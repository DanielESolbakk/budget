import { _electron as electron, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { LedgerPage } from "./pom/LedgerPage.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");
const longDescription = "SYNTHETIC BANK DESCRIPTION 7332 01.01 NOK 72.00 KOLUMBUS Kurs: 1.0000 representative long imported description. ".repeat(4);
const longDescriptionTest = test.extend({
  databasePath: async ({ databasePath }, use) => {
    const ledger = createLocalLedgerDatabase({ dbPath: databasePath, seedData: {
      household: { id: "sample-hh", name: "Synthetic household", createdAtIso: "2026-01-01T00:00:00Z" },
      accounts: [{ id: "sample-acc", householdId: "sample-hh", name: "Brukskonto", currencyCode: "NOK" }],
      transactions: [{
        id: "tx-long", householdId: "sample-hh", accountId: "sample-acc",
        bookedAtIso: "2026-05-23", amountMinor: -7200, currencyCode: "NOK",
        merchantRaw: longDescription, categoryId: "groceries",
      }],
      importJobs: [], monthlyCategoryTargets: [],
    } });
    ledger.close();
    await use(databasePath);
  },
});

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
    await new LedgerPage(window).openSplitEditor("Kiwi");

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect.soft(allocationEditor.getByRole("heading", { name: "Split transaction", exact: true })).toBeVisible();
    await expect.soft(allocationEditor.getByRole("button", { name: "Manage categories for this split", exact: true }))
      .toHaveCount(1);
    await expect.soft(allocationEditor.getByRole("status", { name: "Split draft status" }))
      .toContainText("Adjust an existing amount to make room for row 2");
    const balance = allocationEditor.getByRole("status", { name: "Split draft status" });
    await expect(balance).toContainText(/Remaining:.*0,00\s*kr/);
    await expect(allocationEditor.getByText("Kiwi", { exact: true })).toHaveCount(0);
    await expect(allocationEditor.getByText("20. apr. 2026", { exact: true })).toHaveCount(0);
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40");
    await expect(balance).toContainText(/Remaining:.*32,00\s*kr/);
    await allocationEditor.getByLabel("Allocation amount 1").fill("-72.00");
    const saveButton = allocationEditor.getByRole("button").filter({ hasText: /^Save split$/ });
    await expect.soft(saveButton).toHaveAccessibleName("Save split for Kiwi");
    await expect(allocationEditor.getByLabel("Allocation category 1")).toHaveValue("groceries");
    await expect(allocationEditor.getByLabel("Allocation amount 1")).toHaveValue("-72.00");
    await expect(allocationEditor.getByLabel("Allocation category 2")).toHaveValue("");
    await expect(allocationEditor.getByLabel("Allocation amount 2")).toHaveValue("");
    await expect(allocationEditor.getByText(/Allocated so far:/))
      .toContainText(/72,00\s*kr/);
    await expect(allocationEditor.getByText(/Balance after entered amounts:/))
      .toContainText(/0,00\s*kr/);
    await expect(allocationEditor).toContainText("1 allocation is incomplete.");
    await expect(allocationEditor).toContainText("Changes apply only when you save.");
    await allocationEditor.getByRole("button", { name: "Add allocation" }).click();
    await expect(allocationEditor.getByLabel("Allocation category 3")).toHaveValue("");
    await expect(allocationEditor.getByLabel("Allocation amount 3")).toHaveValue("");
    await allocationEditor.getByText("Row actions", { exact: true }).first().click();
    await expect(allocationEditor.getByRole("button", { name: "Move allocation 1 down" }))
      .toBeDisabled();
    await expect(allocationEditor.getByRole("group", { name: "Allocation 1", exact: true }))
      .toContainText("Finish all rows before reordering.");
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).click();
    await expect(allocationEditor.getByRole("alert"))
      .toContainText("Choose a category for allocation 2.");
    await expect(transactionRow).toContainText("Groceries & food");
  });

  test("guides the user to make room for an empty split row", async ({ appShell, window }) => {
    await appShell.openWorkspace("Transactions");
    await new LedgerPage(window).openSplitEditor("Kiwi");
    const editor = window.getByRole("region", { name: "Transaction category allocations for Kiwi" });
    const status = editor.getByRole("status", { name: "Split draft status" });

    await expect(status).toContainText("Adjust an existing amount to make room for row 2");
    await editor.getByLabel("Allocation amount 1").focus();
    await editor.getByLabel("Allocation amount 1").blur();
    await expect(window.getByRole("status", { name: "Allocation status" }))
      .toContainText("Adjust an existing amount to make room for row 2");
    await editor.getByLabel("Allocation amount 1").fill("-40");
    await expect(status).not.toContainText("make room");
    await expect(status).toContainText(/Remaining:.*32,00\s*kr/);
  });

  test("offers row actions only when an action is available", async ({ appShell, window }) => {
    await appShell.openWorkspace("Transactions");
    await new LedgerPage(window).openSplitEditor("Kiwi");
    const editor = window.getByRole("region", { name: "Transaction category allocations for Kiwi" });

    await expect(editor.getByText("Row actions", { exact: true })).toHaveCount(0);
    await editor.getByRole("button", { name: "Add allocation" }).click();
    await editor.getByText("Row actions", { exact: true }).nth(2).click();
    await expect(editor.getByRole("button", { name: "Remove allocation 3" })).toBeEnabled();
    await editor.getByRole("button", { name: "Remove allocation 3" }).click();
    await editor.getByLabel("Allocation amount 1").fill("-40");
    await editor.getByLabel("Allocation category 2").selectOption("housing");
    await editor.getByLabel("Allocation amount 2").fill("-32");
    await editor.getByText("Row actions", { exact: true }).first().click();
    await expect(editor.getByRole("button", { name: "Move allocation 1 down" })).toBeEnabled();
  });

  test("explains the sign and accepted decimal separators to amount fields", async ({ appShell, window }) => {
    await appShell.openWorkspace("Transactions");
    await new LedgerPage(window).openSplitEditor("Kiwi");
    const editor = window.getByRole("region", { name: "Transaction category allocations for Kiwi" });

    await expect(editor.getByLabel("Allocation amount 1")).toHaveAccessibleDescription(
      /negative amounts.*comma or period/i,
    );
    await editor.getByLabel("Allocation amount 1").fill("-40,00");
    await editor.getByLabel("Allocation category 2").selectOption("housing");
    await editor.getByLabel("Allocation amount 2").fill("-32,00");
    await expect(editor.getByRole("status", { name: "Split draft status" })).toContainText("Ready to save");
    await editor.getByRole("button", { name: "Cancel category editing for Kiwi" }).click();
    await new LedgerPage(window).openSplitEditor("Lønn AS");
    const incomeEditor = window.getByRole("region", { name: "Transaction category allocations for Lønn AS" });
    await expect(incomeEditor.getByLabel("Allocation amount 1")).toHaveAccessibleDescription(
      /positive amounts.*comma or period/i,
    );
  });

  test("saves two allocations and leaves cashflow on the single source transaction", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await expect(transactionRow).toBeVisible();
    await new LedgerPage(window).openSplitEditor("Kiwi");

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
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).click();

    await expect(transactionRow).toContainText("Groceries & food");
    await expect(transactionRow).toContainText("Housing");
    await expect(transactionRow).toContainText(/72,00\s*kr/);
    await expect(transactionRow.getByRole("button", { name: /Allocate categories|Edit category allocations/ }))
      .toHaveCount(0);
    await expect(transactionRow.getByRole("button", { name: "Edit category for Kiwi" }))
      .toBeVisible();
  });

  test("replaces a saved split with one category without changing the source amount", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await new LedgerPage(window).openSplitEditor("Kiwi");

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).click();
    await expect(transactionRow).toContainText("Housing");

    await window.setViewportSize({ width: 1280, height: 800 });
    await new LedgerPage(window).openSplitEditor("Kiwi");
    const categoryEditor = window.getByRole("region", { name: "Edit category for Kiwi" });
    await categoryEditor.getByRole("button", { name: "Use one category" }).click();
    await expect(categoryEditor).toContainText("replaces the entire saved split");

    await window.setViewportSize({ width: 390, height: 844 });
    const horizontalOverflow = await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBe(false);
    await categoryEditor.getByRole("button", { name: "Save category for Kiwi" }).click();

    await expect(allocationEditor).toBeHidden();
    await expect(transactionRow).toContainText("Groceries & food");
    await expect(transactionRow).not.toContainText("Housing");
    await expect(transactionRow).toContainText(/72,00\s*kr/);
  });

  test("shows a partial balance and incomplete-row status until the draft is valid", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    await new LedgerPage(window).openSplitEditor("Kiwi");

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor.getByText(/Allocated so far:/))
      .toContainText(/72,00\s*kr/);
    await expect(allocationEditor.getByText(/Balance after entered amounts:/))
      .toContainText(/0,00\s*kr/);
    await expect(allocationEditor).toContainText("1 allocation is incomplete.");
    const status = allocationEditor.getByRole("status", { name: "Split draft status" });
    await expect(status).not.toContainText("Ready to save");
    await allocationEditor.getByLabel("Allocation amount 1").fill("invalid");
    await expect(status).toContainText("Remaining: unavailable");
    await allocationEditor.getByLabel("Allocation amount 1").blur();
    await expect(window.getByRole("status", { name: "Allocation status" }))
      .toContainText("Enter a valid amount for row 1 before calculating the balance.");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-72");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("0");
    await expect(status).toContainText("non-zero");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-80");
    await allocationEditor.getByLabel("Allocation amount 2").fill("8");
    await expect(status).toContainText("source transaction sign");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-20");
    await expect(status).toContainText(/Remaining:.*12,00\s*kr/);
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32");
    await expect(status).toContainText("Ready to save");
  });

  test("associates category errors with their field and clears them after correction", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    await new LedgerPage(window).openSplitEditor("Kiwi");

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    const secondCategory = allocationEditor.getByLabel("Allocation category 2");
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).click();

    const error = allocationEditor.getByRole("alert");
    await expect(error).toHaveText("Choose a category for allocation 2.");
    await expect(secondCategory).toHaveAttribute("aria-invalid", "true");
    await expect(secondCategory).toHaveAttribute("aria-describedby", "transaction-allocation-error");
    await expect(secondCategory).toBeFocused();
    await expect(allocationEditor.getByRole("group", { name: "Allocation 2", exact: true }).getByRole("alert"))
      .toHaveText("Choose a category for allocation 2.");

    await secondCategory.selectOption("housing");
    await expect(error).toHaveCount(0);
    await expect(secondCategory).not.toHaveAttribute("aria-invalid", "true");
  });

  test("announces the partial balance when amount entry leaves the field", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    await new LedgerPage(window).openSplitEditor("Kiwi");

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
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    const secondAmount = allocationEditor.getByLabel("Allocation amount 2");
    await firstAmount.fill("-72");
    await secondAmount.fill("0");
    await secondAmount.press("Tab");
    await expect.soft(status).toContainText("non-zero");
    await firstAmount.fill("-80");
    await secondAmount.fill("8");
    await secondAmount.press("Tab");
    await expect.soft(status).toContainText("source transaction sign");
    await firstAmount.fill("-40");
    await secondAmount.fill("-32");
    await secondAmount.press("Tab");
    await expect.soft(status).toContainText("Ready to save");
  });

  test("announces successful allocation saves after the editor closes", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    await new LedgerPage(window).openSplitEditor("Kiwi");

    const ledger = window.getByRole("region", { name: "Ledger" });
    const allocationEditor = ledger.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).click();

    await expect(allocationEditor).toBeHidden();
    await expect(ledger.getByRole("status", { name: "Category edit status" }))
      .toContainText("Category saved");
  });

  test("labels an excess allocation as over-allocated", async ({ appShell, window }) => {
    await appShell.openWorkspace("Transactions");
    await new LedgerPage(window).openSplitEditor("Kiwi");
    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-40.00");

    await expect(allocationEditor.getByRole("status", { name: "Split draft status" }))
      .toContainText(/Over-allocated:.*8,00\s*kr/);
    await expect(allocationEditor.getByText(/Over-allocated by:/))
      .toContainText(/8,00\s*kr/);
    await expect(allocationEditor.getByText(/Remaining to allocate:/)).toHaveCount(0);
  });

  test("@visual Visual: allocation balance summary fits desktop and compact windows", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    await new LedgerPage(window).openSplitEditor("Kiwi");
    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor.getByText(/Balance after entered amounts:/))
      .toContainText(/0,00\s*kr/);
    await expect(allocationEditor).toContainText("1 allocation is incomplete.");

    await window.setViewportSize({ width: 390, height: 844 });
    await window.setViewportSize({ width: 1280, height: 800 });
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await expect(allocationEditor.getByText(/Allocation total:/)).toContainText(/72,00\s*kr/);
    await window.setViewportSize({ width: 390, height: 844 });

    await window.setViewportSize({ width: 1280, height: 800 });
    await allocationEditor.getByLabel("Allocation amount 2").fill("-40.00");
    await expect(allocationEditor.getByText(/Over-allocated by:/)).toContainText(/8,00\s*kr/);
    await window.setViewportSize({ width: 390, height: 844 });

    await window.setViewportSize({ width: 1280, height: 800 });
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).click();
    await expect(allocationEditor.getByRole("alert"))
      .toHaveText("Category allocations must sum exactly to the source transaction amount.");
    await window.setViewportSize({ width: 390, height: 844 });

    const editorWidth = await allocationEditor.evaluate((element) =>
      element.getBoundingClientRect().width
    );
    expect(editorWidth).toBeLessThanOrEqual(390);
  });

  longDescriptionTest("keeps the allocation balance in view while editing on a compact window", async ({
    appShell,
    window,
    electronApp,
  }) => {
    await appShell.openWorkspace("Transactions");
    await window.setViewportSize({ width: 390, height: 844 });
    await new LedgerPage(window).openSplitEditor(longDescription);

    const allocationEditor = window.getByRole("region", {
      name: /^Transaction category allocations for SYNTHETIC BANK DESCRIPTION/,
    });
    const balance = allocationEditor.getByRole("status", { name: "Split draft status" });
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
    for (const summary of [
      allocationEditor.getByText("Split details", { exact: true }),
      allocationEditor.getByText("Row actions", { exact: true }).first(),
    ]) {
      expect.soft(await summary.evaluate((element) => element.getBoundingClientRect().height))
        .toBeGreaterThanOrEqual(44);
    }
    await allocationEditor.getByText("Split details", { exact: true }).click();
    await expect(allocationEditor.getByText(`Original description: ${longDescription}`, { exact: true })).toBeVisible();
    for (const context of [
      { width: 390, height: 844, zoom: 1 },
      { width: 1280, height: 800, zoom: 2 },
    ]) {
      await window.setViewportSize({ width: context.width, height: context.height });
      await electronApp.evaluate(({ webContents }, zoom) => webContents.getAllWebContents()
        .filter((contents) => contents.getType() === "window")
        .forEach((contents) => contents.setZoomFactor(zoom)), context.zoom);
      await allocationEditor.getByLabel("Allocation category 1").focus();
      for (let step = 0; step < 4; step++) await window.keyboard.press("Tab");
      const secondAmount = allocationEditor.getByLabel("Allocation amount 2");
      await expect(secondAmount).toBeFocused();
      await expect.poll(() => secondAmount.evaluate((input) => {
        const box = input.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === input;
      })).toBe(true);
      await expect(balance).toBeInViewport();
    }
  });

  test("adds and removes allocation rows with keyboard navigation", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    await new LedgerPage(window).openSplitEditor("Kiwi", true);
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
    const thirdActions = allocationEditor.getByText("Row actions", { exact: true }).nth(2);
    await thirdActions.focus();
    await window.keyboard.press("Enter");
    await tabTo(window, removeButton);
    await expect(removeButton).toBeFocused();
    await window.keyboard.press("Enter");

    await expect(thirdCategory).toHaveCount(0);
    await expect(allocationEditor.getByRole("button", { name: /Remove allocation/, includeHidden: true })).toHaveCount(0);
    await expect(addButton).toBeFocused();
  });

  test("announces an invalid sum and preserves the previous allocations", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const transactionRow = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await new LedgerPage(window).openSplitEditor("Kiwi");

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).click();
    await expect(transactionRow).toContainText("Groceries & food");

    await new LedgerPage(window).openSplitEditor("Kiwi");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-30.00");
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).click();

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
    await new LedgerPage(window).openSplitEditor("Kiwi", true);
    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor.getByLabel("Allocation category 1")).toBeFocused();
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByText("Row actions", { exact: true }).first().click();
    const moveDown = allocationEditor.getByRole("button", { name: "Move allocation 1 down" });
    await moveDown.focus();
    await window.keyboard.press("Enter");
    await expect(allocationEditor.getByLabel("Allocation category 1")).toHaveValue("housing");
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).focus();
    await window.keyboard.press("Enter");
    await expect(transactionRow).toContainText("Housing");
    await expect(transactionRow).toContainText("Groceries & food");
    await expect(transactionRow).toContainText(/72,00\s*kr/);

    await window.setViewportSize({ width: 390, height: 844 });
    await transactionRow.getByRole("button", { name: "Edit category for Kiwi" }).focus();
    await window.keyboard.press("Enter");
    await expect(allocationEditor.getByLabel("Allocation category 1")).toBeFocused();
    await allocationEditor.getByLabel("Allocation amount 1").fill("-33.00");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-39.00");
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).focus();
    await window.keyboard.press("Enter");
    await expect(transactionRow).toContainText(/72,00\s*kr/);
    await expect(allocationEditor).toBeHidden();
    await transactionRow.getByRole("button", { name: "Edit category for Kiwi" }).focus();
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
    await new LedgerPage(window).openSplitEditor("Kiwi");

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(allocationEditor.getByLabel("Allocation category 1")).toHaveValue("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByText("Row actions", { exact: true }).first().click();
    await allocationEditor.getByRole("button", { name: "Move allocation 1 down" }).click();
    await expect(allocationEditor.getByLabel("Allocation category 1")).toHaveValue("housing");
    await expect(allocationEditor.getByLabel("Allocation category 2")).toHaveValue("groceries");

    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).click();
    await expect(allocationEditor).toBeHidden();
    await new LedgerPage(window).openSplitEditor("Kiwi");
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
    await new LedgerPage(window).openSplitEditor("Kiwi");

    const allocationEditor = window.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await allocationEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await allocationEditor.getByLabel("Allocation amount 1").fill("-40.00");
    await allocationEditor.getByLabel("Allocation category 2").selectOption("housing");
    await allocationEditor.getByLabel("Allocation amount 2").fill("-32.00");
    await allocationEditor.getByRole("button", { name: "Save split for Kiwi" }).click();
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

      await new LedgerPage(restartedWindow).openSplitEditor("Kiwi");
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
