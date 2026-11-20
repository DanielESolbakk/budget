import { _electron as electron } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/electron.js";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { CategoryManagementPage } from "./pom/CategoryManagementPage.js";
import { LedgerPage } from "./pom/LedgerPage.js";

const pagedCategoryTest = test.extend({
  databasePath: async ({ databasePath }, use) => {
    const householdId = "sample-hh";
    const accountId = "sample-acc";
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: { id: householdId, name: "Synthetic household", createdAtIso: "2026-01-01T00:00:00Z" },
        accounts: [{ id: accountId, householdId, name: "Brukskonto", currencyCode: "NOK" }],
        transactions: Array.from({ length: 54 }, (_, index) => ({
          id: `paged-category-${index}`, householdId, accountId, bookedAtIso: "2026-05-10",
          amountMinor: -100, currencyCode: "NOK", categoryId: "groceries",
          merchantRaw: `Kiwi ${String(index).padStart(2, "0")}`,
        })),
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });
    database.close();
    await use(databasePath);
  },
});

function setRememberedCategory(databasePath: string, categoryId: string): void {
  const database = createLocalLedgerDatabase({ dbPath: databasePath });
  try {
    database.upsertMerchantCategoryRule({ merchantAlias: "KIWI", categoryId });
  } finally {
    database.close();
  }
}

async function waitForInitialCatalog(window: Page): Promise<void> {
  await expect(window.getByLabel("Application status")).toContainText("Ready for review");
  const targets = window.getByText("Manage category targets", { exact: true });
  await targets.click();
  const section = window.getByRole("region", { name: "Category Target Entry" });
  await section.getByRole("button", { name: "Add target", exact: true }).click();
  const form = section.getByRole("form", { name: "Category target entry form" });
  await expect(form.getByRole("combobox", { name: "Category", exact: true })
    .getByRole("option", { name: "Groceries & food", exact: true })).toHaveCount(1);
  await expect(form.getByRole("button", { name: "Manage categories for budget targets" })).toBeEnabled();
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await targets.click();
}

test.describe("transaction category editing", () => {
  test("opens a category-first inline editor with future-only learning guidance", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const row = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    const trigger = row.getByRole("button", { name: "Edit category for Kiwi" });

    await trigger.focus();
    await window.keyboard.press("Enter");

    const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
    await expect(editor).toBeVisible();
    await expect(row.getByRole("button", { name: /Allocate categories|Edit category allocations/ })).toHaveCount(0);
    await expect.poll(() => editor.evaluate((element) =>
      element.closest("tr")?.previousElementSibling?.getAttribute("aria-label")
    )).toBe("Ledger transaction Kiwi");
    await expect(editor).toContainText("KIWI");
    const remember = editor.getByRole("checkbox", { name: "Remember for this merchant" });
    await expect(remember).toBeChecked();
    await expect(remember).toHaveAccessibleDescription(/Matching merchant: KIWI.*No category is currently remembered.*future matching transactions/s);
    await expect(editor).toContainText("future matching transactions");
    await expect(editor).toContainText("Existing history will not change.");

    await editor.getByRole("combobox", { name: "Category for Kiwi" }).selectOption("housing");
    await editor.getByRole("button", { name: "Save category for Kiwi" }).click();

    await expect(row).toContainText("Housing");
    await expect(editor).toBeHidden();
    await expect(window.getByRole("status", { name: "Category edit status" }))
      .toContainText("saved and remembered for future matching transactions");
  });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`keeps category controls keyboard-reachable at ${viewport.width}x${viewport.height}`, async ({
      appShell,
      window,
    }) => {
      await window.setViewportSize(viewport);
      await appShell.openWorkspace("Transactions");
      const editor = await new LedgerPage(window).openCategoryEditor("Kiwi", true);
      const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
      const remember = editor.getByRole("checkbox", { name: "Remember for this merchant" });
      const manage = editor.getByRole("button", { name: "Manage categories for this transaction" });
      const save = editor.getByRole("button", { name: "Save category for Kiwi" });
      const split = editor.getByRole("button", { name: "Split across categories" });

      await expect(category).toBeFocused();
      const splitBounds = await split.boundingBox();
      expect(splitBounds?.height).toBeGreaterThanOrEqual(44);
      const rememberBounds = await remember.boundingBox();
      expect(rememberBounds?.width).toBeLessThanOrEqual(24);
      await editor.getByText("Remember for this merchant", { exact: true }).click();
      await expect(remember).not.toBeChecked();
      await expect(remember).toHaveAccessibleDescription(/transaction-only correction/);
      await expect(editor).not.toContainText("No remembered category will be changed.");
      await editor.getByText("Remember for this merchant", { exact: true }).click();
      await expect(remember).toBeChecked();
      await category.focus();
      await window.keyboard.press("Tab");
      await expect(remember).toBeFocused();
      await window.keyboard.press("Tab");
      await expect(manage).toBeFocused();
      await window.keyboard.press("Tab");
      await expect(split).toBeFocused();
      await window.keyboard.press("Tab");
      await expect(save).toBeFocused();
      await expect(save).toBeInViewport();
      expect(await window.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )).toBe(true);
      await editor.getByRole("button", { name: "Cancel category editing for Kiwi" }).click();
    });
  }

  test("allows a transaction-only correction when merchant normalization yields no alias", async ({
    appShell,
    databasePath,
    window,
  }) => {
    await waitForInitialCatalog(window);
    const ledgerDatabase = createLocalLedgerDatabase({ dbPath: databasePath });
    const transactionId = ledgerDatabase.loadLedgerSnapshotData().transactions
      .find((transaction) => transaction.merchantRaw === "Kiwi")?.id;
    const originalRules = ledgerDatabase.listMerchantCategoryRules();
    ledgerDatabase.close();
    if (transactionId === undefined) throw new Error("Expected the seeded Kiwi transaction.");

    const database = new DatabaseSync(databasePath);
    try {
      database.prepare(
        "UPDATE transactions SET merchant_raw = ?, merchant_search = ? WHERE id = ?"
      ).run("AS", "AS", transactionId);
    } finally {
      database.close();
    }

    await appShell.openWorkspace("Transactions");
    const row = window.getByRole("row", { name: "Ledger transaction AS" });
    await row.getByRole("button", { name: "Edit category for AS" }).click();
    const editor = window.getByRole("region", { name: "Edit category for AS" });

    await expect(editor).toContainText("Matching merchant: No matching alias");
    await expect(editor).toContainText("Remembering is unavailable");
    await expect(editor.getByRole("checkbox", { name: "Remember for this merchant" })).toHaveCount(0);
    await editor.getByRole("combobox", { name: "Category for AS" }).selectOption("housing");
    await editor.getByRole("button", { name: "Save category for AS" }).click();

    await expect(window.getByRole("status", { name: "Category edit status" }))
      .toContainText("Category saved for this transaction only");
    const saved = createLocalLedgerDatabase({ dbPath: databasePath });
    try {
      expect(saved.getTransactionById(transactionId)).toMatchObject({
        merchantRaw: "AS",
        categoryId: "housing",
      });
      expect(saved.listMerchantCategoryRules()).toEqual(originalRules);
      expect(saved.listMerchantCategoryRules().some((rule) => rule.merchantAlias === "")).toBe(false);
    } finally {
      saved.close();
    }
  });

  test("preserves category, learning, and split drafts across mode changes and cancel", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const row = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await row.getByRole("button", { name: "Edit category for Kiwi" }).click();

    const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
    const remember = editor.getByRole("checkbox", { name: "Remember for this merchant" });
    await editor.getByRole("combobox", { name: "Category for Kiwi" }).selectOption("housing");
    await remember.uncheck();
    await editor.getByRole("button", { name: "Split across categories" }).click();

    const splitEditor = editor.getByRole("region", {
      name: "Transaction category allocations for Kiwi",
    });
    await expect(splitEditor.getByLabel("Allocation category 1")).toHaveValue("housing");
    await splitEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await splitEditor.getByLabel("Allocation amount 1").fill("-40");
    await splitEditor.getByLabel("Allocation category 2").selectOption("housing");
    await splitEditor.getByLabel("Allocation amount 2").fill("-32");
    await editor.getByRole("button", { name: "Use one category" }).click();

    await expect(editor.getByRole("combobox", { name: "Category for Kiwi" })).toHaveValue("housing");
    await expect(remember).not.toBeChecked();
    await editor.getByRole("combobox", { name: "Category for Kiwi" }).selectOption("fuel");
    await editor.getByRole("button", { name: "Split across categories" }).click();
    await expect(splitEditor.getByLabel("Allocation category 1")).toHaveValue("groceries");
    await expect(splitEditor.getByLabel("Allocation amount 1")).toHaveValue("-40");
    await expect(splitEditor.getByLabel("Allocation category 2")).toHaveValue("housing");
    await expect(splitEditor.getByLabel("Allocation amount 2")).toHaveValue("-32");

    await editor.getByRole("button", { name: "Cancel category editing for Kiwi" }).click();
    await expect(editor).toBeHidden();
    await expect(row).toContainText("Groceries & food");
    await expect(row).not.toContainText("Housing");
  });

  test("explains before saving that a split leaves remembered categories unchanged", async ({
    appShell,
    databasePath,
    window,
  }) => {
    await waitForInitialCatalog(window);
    setRememberedCategory(databasePath, "fuel");
    await appShell.openWorkspace("Transactions");
    const editor = await new LedgerPage(window).openCategoryEditor("Kiwi");
    await expect(editor.getByRole("checkbox", { name: "Remember for this merchant" })).toBeChecked();
    await editor.getByRole("button", { name: "Split across categories" }).click();
    const split = editor.getByRole("region", { name: "Transaction category allocations for Kiwi" });
    await expect(split).toContainText("Splitting does not change remembered categories for this merchant.");
    await expect(split.getByRole("button", { name: "Save split for Kiwi" }))
      .toHaveAccessibleDescription("Splitting does not change remembered categories for this merchant.");
    await split.getByLabel("Allocation amount 1").fill("-40");
    await split.getByLabel("Allocation category 2").selectOption("housing");
    await split.getByLabel("Allocation amount 2").fill("-32");
    await split.getByRole("button", { name: "Save split for Kiwi" }).click();
    await expect(editor).toBeHidden();
    const database = createLocalLedgerDatabase({ dbPath: databasePath });
    try {
      expect(database.listMerchantCategoryRules()).toEqual([{ merchantAlias: "KIWI", categoryId: "fuel" }]);
    } finally {
      database.close();
    }
  });

  test("does not treat an untouched seeded split as an unsaved edit", async ({ appShell, window }) => {
    await appShell.openWorkspace("Transactions");
    const editor = await new LedgerPage(window).openCategoryEditor("Kiwi");
    const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
    await category.selectOption("housing");
    await editor.getByRole("button", { name: "Split across categories" }).click();
    await editor.getByRole("button", { name: "Use one category" }).click();
    await category.selectOption("groceries");
    await window.getByRole("row", { name: "Ledger transaction Rema 1000" })
      .getByRole("button", { name: "Edit category for Rema 1000" }).click();

    await expect(window.getByRole("region", { name: "Edit category for Rema 1000" })).toBeVisible();
    await expect(window.getByRole("alert").filter({ hasText: "Unsaved category changes." })).toHaveCount(0);
  });

  test("saves a one-off correction without changing the remembered merchant category", async ({
    appShell,
    databasePath,
    window,
  }) => {
    await waitForInitialCatalog(window);
    setRememberedCategory(databasePath, "fuel");
    const database = createLocalLedgerDatabase({ dbPath: databasePath });
    const transactionId = database.loadLedgerSnapshotData().transactions
      .find((transaction) => transaction.merchantRaw === "Kiwi")?.id;
    database.close();
    expect(transactionId).toBeDefined();

    await appShell.openWorkspace("Transactions");
    const ledger = window.getByRole("region", { name: "Ledger", exact: true });
    const row = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await row.getByRole("button", { name: "Edit category for Kiwi" }).click();
    const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
    const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
    await expect(category).toBeEnabled({ timeout: 15_000 });
    const remember = editor.getByRole("checkbox", { name: "Remember for this merchant" });

    await expect(editor).toContainText("Currently remembered category: Fuel.");
    await remember.uncheck();
    await expect(editor).toContainText("The remembered Fuel category will remain unchanged.");
    await category.selectOption("housing");
    await editor.getByRole("button", { name: "Save category for Kiwi" }).click();

    await expect(ledger.getByRole("status", { name: "Category edit status" }))
      .toContainText("saved for this transaction only");
    const reopened = createLocalLedgerDatabase({ dbPath: databasePath });
    try {
      expect(reopened.getTransactionById(transactionId!)).toMatchObject({
        categoryId: "housing",
        categorization: { decisionSource: "manual", requiresReview: false },
      });
      expect(reopened.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "KIWI", categoryId: "fuel" },
      ]);
    } finally {
      reopened.close();
    }
  });

  test("retains the edit draft after a failed write and allows retry", async ({
    appShell,
    databasePath,
    window,
  }) => {
    await waitForInitialCatalog(window);
    await window.setViewportSize({ width: 390, height: 844 });
    setRememberedCategory(databasePath, "fuel");
    const setupDatabase = new DatabaseSync(databasePath);
    try {
      setupDatabase.exec(`
        CREATE TRIGGER transaction_category_edit_fault
        BEFORE UPDATE OF category_id ON transactions
        WHEN OLD.merchant_raw = 'Kiwi'
        BEGIN SELECT RAISE(ABORT, 'synthetic transaction category edit failure'); END;
      `);
    } finally {
      setupDatabase.close();
    }

    try {
      await appShell.openWorkspace("Transactions");
      const row = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
      await row.getByRole("button", { name: "Edit category for Kiwi" }).click();
      const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
      const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
      const remember = editor.getByRole("checkbox", { name: "Remember for this merchant" });

      await category.selectOption("housing");
      await remember.uncheck();
      await editor.getByRole("button", { name: "Save category for Kiwi" }).click();

      const saveFailure = editor.getByRole("alert");
      await expect(saveFailure).toContainText("synthetic transaction category edit failure");
      await expect(saveFailure).toContainText(/your draft is still available/i);
      await expect(saveFailure).toContainText(/try saving again/i);
      await expect(saveFailure).toContainText(/cancel.*reopen.*later/i);
      await expect(saveFailure).toBeVisible();
      expect(await window.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )).toBe(true);
      await expect(category).toHaveValue("housing");
      await expect(remember).not.toBeChecked();
      await expect(row).toContainText("Groceries & food");

      const dropTriggerDatabase = new DatabaseSync(databasePath);
      try {
        dropTriggerDatabase.exec("DROP TRIGGER transaction_category_edit_fault");
      } finally {
        dropTriggerDatabase.close();
      }
      await editor.getByRole("button", { name: "Save category for Kiwi" }).click();

      await expect(row).toContainText("Housing");
      await expect(editor).toBeHidden();
      await expect(window.getByRole("status", { name: "Category edit status" }))
        .toContainText("saved for this transaction only");
      const verificationDatabase = new DatabaseSync(databasePath);
      try {
        expect(verificationDatabase.prepare(
          "SELECT category_id FROM transactions WHERE merchant_raw = 'Kiwi'"
        ).get()?.category_id).toBe("housing");
        expect(verificationDatabase.prepare(
          "SELECT category_id FROM merchant_category_rules WHERE merchant_alias = 'KIWI'"
        ).get()?.category_id).toBe("fuel");
      } finally {
        verificationDatabase.close();
      }
    } finally {
      const cleanupDatabase = new DatabaseSync(databasePath);
      try {
        cleanupDatabase.exec("DROP TRIGGER IF EXISTS transaction_category_edit_fault");
      } finally {
        cleanupDatabase.close();
      }
    }
  });

  test("retains a split draft after a failed write and allows retry", async ({
    appShell,
    databasePath,
    window,
  }) => {
    await waitForInitialCatalog(window);
    setRememberedCategory(databasePath, "fuel");
    const original = createLocalLedgerDatabase({ dbPath: databasePath });
    const transactionId = original.loadLedgerSnapshotData().transactions
      .find((transaction) => transaction.merchantRaw === "Kiwi")?.id;
    original.close();
    if (transactionId === undefined) throw new Error("Expected the seeded Kiwi transaction.");

    const setupDatabase = new DatabaseSync(databasePath);
    try {
      setupDatabase.exec(`
        CREATE TRIGGER transaction_category_split_fault
        BEFORE INSERT ON transaction_category_edit_provenance
        BEGIN SELECT RAISE(ABORT, 'synthetic split category edit failure'); END;
      `);
    } finally {
      setupDatabase.close();
    }

    try {
      await appShell.openWorkspace("Transactions");
      const editor = await new LedgerPage(window).openCategoryEditor("Kiwi");
      await editor.getByRole("button", { name: "Split across categories" }).click();
      const split = editor.getByRole("region", { name: "Transaction category allocations for Kiwi" });
      await split.getByLabel("Allocation category 1").selectOption("fuel");
      await split.getByLabel("Allocation amount 1").fill("-40");
      await split.getByLabel("Allocation category 2").selectOption("housing");
      await split.getByLabel("Allocation amount 2").fill("-32");
      await split.getByRole("button", { name: "Save split for Kiwi" }).click();

      const saveFailure = editor.getByRole("alert");
      await expect(saveFailure).toContainText("synthetic split category edit failure");
      await expect(saveFailure).toContainText(/split draft is still available/i);
      await expect(saveFailure).toContainText(/save split to retry/i);
      await expect(split.getByLabel("Allocation category 1")).toHaveValue("fuel");
      await expect(split.getByLabel("Allocation amount 1")).toHaveValue("-40");
      await expect(split.getByLabel("Allocation category 2")).toHaveValue("housing");
      await expect(split.getByLabel("Allocation amount 2")).toHaveValue("-32");

      const dropTriggerDatabase = new DatabaseSync(databasePath);
      try {
        dropTriggerDatabase.exec("DROP TRIGGER transaction_category_split_fault");
      } finally {
        dropTriggerDatabase.close();
      }
      await split.getByRole("button", { name: "Save split for Kiwi" }).click();

      await expect(editor).toBeHidden();
      const saved = createLocalLedgerDatabase({ dbPath: databasePath });
      try {
        const transaction = saved.getTransactionById(transactionId);
        expect(transaction?.categoryAllocations?.map((allocation) => ({
          categoryId: allocation.categoryId,
          amountMinor: allocation.amountMinor,
        }))).toEqual([
          { categoryId: "fuel", amountMinor: -4000 },
          { categoryId: "housing", amountMinor: -3200 },
        ]);
        expect(saved.listMerchantCategoryRules()).toEqual([
          { merchantAlias: "KIWI", categoryId: "fuel" },
        ]);
      } finally {
        saved.close();
      }
    } finally {
      const cleanupDatabase = new DatabaseSync(databasePath);
      try {
        cleanupDatabase.exec("DROP TRIGGER IF EXISTS transaction_category_split_fault");
      } finally {
        cleanupDatabase.close();
      }
    }
  });

  test("directs a stale category edit to reopen and preserves its draft until canceled", async ({
    appShell,
    databasePath,
    window,
  }) => {
    await waitForInitialCatalog(window);
    setRememberedCategory(databasePath, "fuel");
    await appShell.openWorkspace("Transactions");
    const editor = await new LedgerPage(window).openCategoryEditor("Kiwi");
    const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
    const remember = editor.getByRole("checkbox", { name: "Remember for this merchant" });

    await category.selectOption("housing");
    await remember.uncheck();
    const concurrentDatabase = new DatabaseSync(databasePath);
    try {
      concurrentDatabase.prepare(
        "UPDATE merchant_category_rules SET category_id = ? WHERE merchant_alias = ?"
      ).run("groceries", "KIWI");
    } finally {
      concurrentDatabase.close();
    }

    await editor.getByRole("button", { name: "Save category for Kiwi" }).click();

    const saveFailure = editor.getByRole("alert");
    await expect(saveFailure).toContainText(/changed while you were editing/i);
    await expect(saveFailure).toContainText(/refresh ledger and discard draft/i);
    await expect(saveFailure).toContainText(/draft remains available until you choose/i);
    await expect(saveFailure).not.toContainText(/try saving again/i);
    await expect(category).toHaveValue("housing");
    await expect(remember).not.toBeChecked();
    const refreshLedger = editor.getByRole("button", { name: "Refresh ledger and discard draft" });
    await expect(refreshLedger).toBeVisible();
    await refreshLedger.click();
    await expect(editor).toBeHidden();

    const ledger = window.getByRole("region", { name: "Ledger", exact: true });
    const row = ledger.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Edit category for Kiwi" })).toBeFocused();
    await row.getByRole("button", { name: "Edit category for Kiwi" }).click();
    const refreshedEditor = window.getByRole("region", { name: "Edit category for Kiwi" });
    await expect(refreshedEditor.getByRole("combobox", { name: "Category for Kiwi" }))
      .toHaveValue("groceries");
    await expect(refreshedEditor).toContainText("Currently remembered category: Groceries & food.");
    await refreshedEditor.getByRole("button", { name: "Cancel category editing for Kiwi" }).click();
    const verificationDatabase = createLocalLedgerDatabase({ dbPath: databasePath });
    try {
      expect(verificationDatabase.loadLedgerSnapshotData().transactions
        .find((transaction) => transaction.merchantRaw === "Kiwi"))
        .toMatchObject({ categoryId: "groceries" });
      expect(verificationDatabase.listMerchantCategoryRules()).toEqual([
        expect.objectContaining({ merchantAlias: "KIWI", categoryId: "groceries" }),
      ]);
    } finally {
      verificationDatabase.close();
    }
  });

  test("directs a missing transaction to refresh the ledger instead of retrying", async ({
    appShell,
    databasePath,
    window,
  }) => {
    await waitForInitialCatalog(window);
    await appShell.openWorkspace("Transactions");
    const editor = await new LedgerPage(window).openCategoryEditor("Kiwi");
    const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
    await category.selectOption("housing");

    const concurrentDatabase = new DatabaseSync(databasePath);
    try {
      concurrentDatabase.prepare("DELETE FROM transactions WHERE merchant_raw = ?").run("Kiwi");
    } finally {
      concurrentDatabase.close();
    }

    await editor.getByRole("button", { name: "Save category for Kiwi" }).click();

    const saveFailure = editor.getByRole("alert");
    await expect(saveFailure).toContainText(/transaction is no longer available/i);
    await expect(saveFailure).toContainText(/refresh ledger and discard draft/i);
    await expect(saveFailure).not.toContainText(/try saving again|review the category/i);
    await expect(category).toHaveValue("housing");
    const refreshLedger = editor.getByRole("button", { name: "Refresh ledger and discard draft" });
    await expect(refreshLedger).toBeVisible();
    await refreshLedger.click();
    await expect(editor).toBeHidden();
    const ledger = window.getByRole("region", { name: "Ledger", exact: true });
    await expect(ledger.getByRole("row", { name: /Ledger transaction Kiwi/ })).toHaveCount(0);
    await expect(ledger.getByRole("heading", { name: "Ledger" })).toBeFocused();
  });

  test("keeps the selected category and split draft through a real category rename", async ({
    appShell,
    databasePath,
    window,
  }) => {
    await waitForInitialCatalog(window);
    const original = createLocalLedgerDatabase({ dbPath: databasePath });
    const transactionId = original.loadLedgerSnapshotData().transactions
      .find((transaction) => transaction.merchantRaw === "Kiwi")?.id;
    original.close();
    if (transactionId === undefined) throw new Error("Expected the seeded Kiwi transaction.");

    await appShell.openWorkspace("Transactions");
    const editor = await new LedgerPage(window).openCategoryEditor("Kiwi");
    const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
    const remember = editor.getByRole("checkbox", { name: "Remember for this merchant" });
    const manager = new CategoryManagementPage(window);

    await manager.openFrom("Manage categories for this transaction");
    await manager.create("Workshop costs");
    await expect(manager.result).toContainText("Created Workshop costs");
    await manager.close();
    await category.selectOption({ label: "Workshop costs" });
    const categoryId = await category.inputValue();
    await remember.uncheck();
    await editor.getByRole("button", { name: "Split across categories" }).click();
    const split = editor.getByRole("region", { name: "Transaction category allocations for Kiwi" });
    await split.getByLabel("Allocation category 1").selectOption("fuel");
    await split.getByLabel("Allocation amount 1").fill("-40");
    await split.getByLabel("Allocation category 2").selectOption(categoryId);
    await split.getByLabel("Allocation amount 2").fill("-32");
    await editor.getByRole("button", { name: "Use one category" }).click();

    await manager.openFrom("Manage categories for this transaction");
    await manager.dialog.getByRole("button", { name: "Rename Workshop costs", exact: true }).click();
    await manager.dialog.getByRole("textbox", { name: "Category name", exact: true })
      .fill("Household workshop");
    const focusDestination = manager.dialog.getByText("How categories work", { exact: true });
    const saveName = manager.dialog.getByRole("button", { name: "Save name", exact: true });
    const saveNameHandle = await saveName.elementHandle();
    if (saveNameHandle === null) throw new Error("Expected the category rename save button.");
    await focusDestination.evaluate((target, button) => {
      if (!(target instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
        throw new Error("Expected the category-management focus target and save button.");
      }
      button.click();
      target.focus();
    }, saveNameHandle);
    await expect(manager.result).toContainText("Renamed to Household workshop");
    await expect(focusDestination).toBeFocused();
    await manager.close();

    await expect(category).toBeFocused();
    await expect(category).toHaveValue(categoryId);
    await expect(category.getByRole("option", { name: "Household workshop", exact: true }))
      .toHaveAttribute("value", categoryId);
    await expect(remember).not.toBeChecked();
    await editor.getByRole("button", { name: "Split across categories" }).click();
    await expect(split.getByLabel("Allocation category 1")).toHaveValue("fuel");
    await expect(split.getByLabel("Allocation amount 1")).toHaveValue("-40");
    await expect(split.getByLabel("Allocation category 2")).toHaveValue(categoryId);
    await expect(split.getByLabel("Allocation amount 2")).toHaveValue("-32");
    await editor.getByRole("button", { name: "Use one category" }).click();

    await remember.focus();
    await expect(remember).toBeFocused();
    const unchanged = createLocalLedgerDatabase({ dbPath: databasePath });
    try {
      expect(unchanged.getTransactionById(transactionId)).toMatchObject({ categoryId: "groceries" });
      expect(unchanged.listCategories("sample-hh")
        .find((savedCategory) => savedCategory.id === categoryId)?.label).toBe("Household workshop");
    } finally {
      unchanged.close();
    }
  });

  test("remembers a category when the transaction already has that category", async ({
    appShell,
    databasePath,
    window,
  }) => {
    await waitForInitialCatalog(window);
    setRememberedCategory(databasePath, "fuel");
    const database = createLocalLedgerDatabase({ dbPath: databasePath });
    const transactionId = database.loadLedgerSnapshotData().transactions
      .find((transaction) => transaction.merchantRaw === "Kiwi")?.id;
    database.close();
    expect(transactionId).toBeDefined();

    await appShell.openWorkspace("Transactions");
    const row = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await row.getByRole("button", { name: "Edit category for Kiwi" }).click();
    const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
    const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
    await expect(category).toBeEnabled({ timeout: 15_000 });
    await expect(category).toHaveValue("groceries");
    await expect(editor.getByRole("checkbox", { name: "Remember for this merchant" })).toBeChecked();
    await editor.getByRole("button", { name: "Save category for Kiwi" }).click();

    await expect(window.getByRole("status", { name: "Category edit status" }))
      .toContainText("Remembered category saved for future matching transactions");
    const reopened = createLocalLedgerDatabase({ dbPath: databasePath });
    try {
      expect(reopened.getTransactionById(transactionId!)).toMatchObject({ categoryId: "groceries" });
      expect(reopened.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "KIWI", categoryId: "groceries" },
      ]);
    } finally {
      reopened.close();
    }
  });

  test("explains an already-matching rule without creating another correction", async ({
    appShell,
    databasePath,
    window,
  }) => {
    await waitForInitialCatalog(window);
    setRememberedCategory(databasePath, "groceries");
    const database = createLocalLedgerDatabase({ dbPath: databasePath });
    const transactionId = database.loadLedgerSnapshotData().transactions
      .find((transaction) => transaction.merchantRaw === "Kiwi")?.id;
    database.close();
    expect(transactionId).toBeDefined();

    await appShell.openWorkspace("Transactions");
    await window.getByRole("row", { name: /Ledger transaction Kiwi/ })
      .getByRole("button", { name: "Edit category for Kiwi" }).click();
    const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
    await editor.getByRole("button", { name: "Save category for Kiwi" }).click();

    await expect(window.getByRole("status", { name: "Category edit status" }))
      .toContainText("The remembered category already matched");
    const reopened = new DatabaseSync(databasePath);
    try {
      const history = reopened.prepare(
        "SELECT COUNT(*) AS edit_count FROM transaction_category_edit_provenance"
      ).get() as { edit_count: number } | undefined;
      expect(history?.edit_count).toBe(0);
    } finally {
      reopened.close();
    }
  });

  test("requires an explicit choice before switching away from a dirty category edit", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const kiwi = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    const rema = window.getByRole("row", { name: /Ledger transaction Rema 1000/ });
    const kiwiTrigger = kiwi.getByRole("button", { name: "Edit category for Kiwi" });

    await kiwiTrigger.click();
    const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
    await editor.getByRole("combobox", { name: "Category for Kiwi" }).selectOption("housing");
    await rema.getByRole("button", { name: "Edit category for Rema 1000" }).click();
    const prompt = window.getByRole("alert").filter({ hasText: "Unsaved category changes." });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "Keep editing" }).click();
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("combobox", { name: "Category for Kiwi" })).toBeFocused();

    await rema.getByRole("button", { name: "Edit category for Rema 1000" }).click();
    await prompt.getByRole("button", { name: "Discard and switch" }).click();
    await expect(window.getByRole("region", { name: "Edit category for Rema 1000" })).toBeVisible();
  });

  test("requires a decision before filters hide a dirty category edit", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const filters = window.getByRole("form", { name: "Ledger filters" });
    await new LedgerPage(window).openMoreFilters();
    const categoryFilter = filters.getByRole("combobox", { name: "Filter category" });
    const row = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await row.getByRole("button", { name: "Edit category for Kiwi" }).click();

    const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
    const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
    await category.selectOption("housing");
    await categoryFilter.selectOption("housing");

    const prompt = editor.getByRole("alert").filter({ hasText: "Unsaved category changes." });
    await expect(prompt).toBeVisible();
    await expect(row).toBeVisible();
    await expect(category).toHaveValue("housing");

    await prompt.getByRole("button", { name: "Keep editing" }).click();
    await expect(category).toBeFocused();
    await expect(categoryFilter).toHaveValue("");
    await expect(category).toHaveValue("housing");

    await categoryFilter.selectOption("housing");
    await editor.getByRole("button", { name: "Discard and apply" }).click();
    await expect(editor).toBeHidden();
    await expect(row).toBeHidden();
  });

  test("restores trigger focus on Escape without saving the draft", async ({ appShell, window }) => {
    await appShell.openWorkspace("Transactions");
    const row = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    const trigger = row.getByRole("button", { name: "Edit category for Kiwi" });
    await trigger.focus();
    await window.keyboard.press("Enter");
    const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
    await editor.getByRole("combobox", { name: "Category for Kiwi" }).selectOption("housing");
    await window.keyboard.press("Escape");

    await expect(editor).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(row).toContainText("Groceries & food");
  });

  test("announces a category edit when the saved row leaves the active filter", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const ledger = window.getByRole("region", { name: "Ledger", exact: true });
    const filters = ledger.getByRole("form", { name: "Ledger filters" });
    await new LedgerPage(window).openMoreFilters();
    await filters.getByRole("combobox", { name: "Filter category" }).selectOption("groceries");
    const row = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Edit category for Kiwi" }).click();
    const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
    await editor.getByRole("combobox", { name: "Category for Kiwi" }).selectOption("housing");
    await editor.getByRole("checkbox", { name: "Remember for this merchant" }).uncheck();
    await editor.getByRole("button", { name: "Save category for Kiwi" }).click();

    await expect(row).toBeHidden();
    await expect(ledger.getByRole("status", { name: "Category edit status" }))
      .toContainText("Category saved for this transaction only");
    await expect(ledger.getByRole("heading", { name: "Ledger" })).toBeFocused();
  });

  pagedCategoryTest("preserves filter, sort, and page when a category edit removes a row", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    const ledger = new LedgerPage(window);
    await ledger.openMoreFilters();
    await ledger.categoryInput.selectOption("groceries");
    await expect(ledger.resultStatus).toHaveText("54 ledger transactions");
    await ledger.sortByMerchant();
    const merchantHeader = ledger.table.getByRole("columnheader", { name: "Merchant" });
    await expect(merchantHeader).toHaveAttribute("aria-sort", "ascending");
    await ledger.goToNextPage();
    await expect(ledger.paginationStatus).toHaveText("Page 2 of 2");
    const row = ledger.transaction("Kiwi 50");
    await expect(row).toBeVisible();
    const editor = await ledger.openCategoryEditor("Kiwi 50");
    await editor.getByRole("combobox", { name: "Category for Kiwi 50" }).selectOption("housing");
    await editor.getByRole("checkbox", { name: "Remember for this merchant" }).uncheck();
    await editor.getByRole("button", { name: "Save category for Kiwi 50" }).click();

    await expect(row).toBeHidden();
    await expect(ledger.resultStatus).toHaveText("53 ledger transactions");
    await expect(ledger.categoryInput).toHaveValue("groceries");
    await expect(merchantHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(ledger.paginationStatus).toHaveText("Page 2 of 2");
    await expect(ledger.table.getByRole("row").nth(1)).toContainText("Kiwi 51");
    await expect(ledger.table.getByRole("row").nth(2)).toContainText("Kiwi 52");
    await expect(ledger.table.getByRole("row").nth(3)).toContainText("Kiwi 53");
    await expect(ledger.section.getByRole("status", { name: "Category edit status" }))
      .toContainText("Category saved for this transaction only");
    await expect(ledger.section.getByRole("heading", { name: "Ledger" })).toBeFocused();
  });

  test("keeps the focused category control reachable at native 200% zoom", async ({
    appShell,
    electronApp,
    window,
  }) => {
    await appShell.openWorkspace("Transactions");
    await electronApp.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow === undefined) throw new Error("Expected the isolated Electron window.");
      mainWindow.webContents.setZoomFactor(2);
    });
    const row = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
    await row.getByRole("button", { name: "Edit category for Kiwi" }).click();
    const category = window.getByRole("region", { name: "Edit category for Kiwi" })
      .getByRole("combobox", { name: "Category for Kiwi" });
    await category.focus();
    await expect(category).toBeFocused();
    await expect(category).toBeInViewport();
    expect(await window.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return false;
      const rect = active.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === active || active.contains(hit);
    })).toBe(true);
    expect(await window.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )).toBe(true);
  });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`remembers an unchanged category through native relaunch at ${viewport.width}x${viewport.height}`, async ({
      appShell,
      databasePath,
      electronApp,
      window,
    }) => {
      await waitForInitialCatalog(window);
      const database = new DatabaseSync(databasePath);
      database.prepare(
        "UPDATE transactions SET category_id = ? WHERE merchant_raw = ?"
      ).run("fuel", "Kiwi");
      database.prepare("DELETE FROM merchant_category_rules WHERE merchant_alias = ?").run("KIWI");
      database.close();
      const beforeSave = createLocalLedgerDatabase({ dbPath: databasePath });
      const transactionId = beforeSave.loadLedgerSnapshotData().transactions
        .find((transaction) => transaction.merchantRaw === "Kiwi")?.id;
      expect(beforeSave.listMerchantCategoryRules().some((rule) => rule.merchantAlias === "KIWI")).toBe(false);
      beforeSave.close();
      if (transactionId === undefined) throw new Error("Expected the seeded Kiwi transaction.");

      await window.setViewportSize(viewport);
      await appShell.openWorkspace("Transactions");
      const row = window.getByRole("row", { name: /Ledger transaction Kiwi/ });
      await expect(row).toContainText("Fuel");
      await expect(row.getByRole("button", { name: /Allocate categories|Edit category allocations/ }))
        .toHaveCount(0);
      const trigger = row.getByRole("button", { name: "Edit category for Kiwi" });
      await trigger.focus();
      await window.keyboard.press("Enter");
      const editor = window.getByRole("region", { name: "Edit category for Kiwi" });
      const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
      const remember = editor.getByRole("checkbox", { name: "Remember for this merchant" });
      const save = editor.getByRole("button", { name: "Save category for Kiwi" });
      await expect(category).toHaveValue("fuel");
      await expect(editor).toContainText("Matching merchant: KIWI");
      await expect(editor).toContainText("No category is currently remembered for this merchant.");
      await expect(editor).toContainText("For future matching transactions, use Fuel.");
      await expect(editor).toContainText("Existing history will not change.");
      await expect(editor.getByRole("region", { name: "Transaction category allocations for Kiwi" }))
        .toHaveCount(0);
      await expect(editor.getByRole("textbox")).toHaveCount(0);
      await expect(remember).toBeChecked();
      await expect(save).toBeEnabled();
      await category.focus();
      await window.keyboard.press("Tab");
      await window.keyboard.press("Tab");
      await window.keyboard.press("Tab");
      await expect(editor.getByRole("button", { name: "Split across categories" })).toBeFocused();
      await window.keyboard.press("Tab");
      await expect(save).toBeFocused();
      await window.keyboard.press("Enter");

      await expect(window.getByRole("status", { name: "Category edit status" }))
        .toContainText("Remembered category saved for future matching transactions");
      const savedFuel = createLocalLedgerDatabase({ dbPath: databasePath });
      try {
        expect(savedFuel.getTransactionById(transactionId)).toMatchObject({
          categoryId: "fuel",
          amountMinor: -7200,
          merchantRaw: "Kiwi",
        });
        expect(savedFuel.listMerchantCategoryRules()).toContainEqual({ merchantAlias: "KIWI", categoryId: "fuel" });
      } finally {
        savedFuel.close();
      }

      await row.getByRole("button", { name: "Edit category for Kiwi" }).click();
      const secondEditor = window.getByRole("region", { name: "Edit category for Kiwi" });
      await secondEditor.getByRole("combobox", { name: "Category for Kiwi" }).selectOption("groceries");
      await expect(secondEditor).toContainText("Currently remembered category: Fuel.");
      await expect(secondEditor)
        .toContainText("For future matching transactions, use Groceries & food.");
      await expect(secondEditor).toContainText("Existing history will not change.");
      await secondEditor.getByRole("button", { name: "Save category for Kiwi" }).click();
      await expect(row).toContainText("Groceries & food");
      await expect(window.getByRole("status", { name: "Category edit status" }))
        .toContainText("saved and remembered for future matching transactions");
      const savedGroceries = createLocalLedgerDatabase({ dbPath: databasePath });
      try {
        expect(savedGroceries.getTransactionById(transactionId)).toMatchObject({
          categoryId: "groceries",
          amountMinor: -7200,
          merchantRaw: "Kiwi",
        });
        expect(savedGroceries.listMerchantCategoryRules())
          .toContainEqual({ merchantAlias: "KIWI", categoryId: "groceries" });
      } finally {
        savedGroceries.close();
      }

      await electronApp.close();
      const restarted = await electron.launch({
        args: [
          "--lang=en-GB",
          `--user-data-dir=${join(dirname(databasePath), "electron-profile")}`,
          join(process.cwd(), "out", "main", "index.js"),
        ],
        env: {
          ...process.env,
          NODE_ENV: "test",
          BUDGET_TEST_LEDGER_SEED: "empty",
          BUDGET_DB_PATH: databasePath,
        },
      });
      try {
        const restartedWindow = await restarted.firstWindow();
        await restartedWindow.waitForLoadState("domcontentloaded");
        await restartedWindow.setViewportSize(viewport);
        await new AppShellPage(restartedWindow).openWorkspace("Transactions");
        const restartedRow = restartedWindow.getByRole("row", { name: /Ledger transaction Kiwi/ });
        await expect(restartedRow).toContainText("Groceries & food");
        await restartedRow.getByRole("button", { name: "Edit category for Kiwi" }).click();
        const reopenedEditor = restartedWindow.getByRole("region", { name: "Edit category for Kiwi" });
        await expect(reopenedEditor.getByRole("combobox", { name: "Category for Kiwi" }))
          .toHaveValue("groceries");
        await expect(reopenedEditor).toContainText("Currently remembered category: Groceries & food.");
        await expect(reopenedEditor.getByRole("checkbox", { name: "Remember for this merchant" }))
          .toBeChecked();
        await reopenedEditor.getByRole("button", { name: "Cancel category editing for Kiwi" }).click();
      } finally {
        await restarted.close();
      }
    });
  }
});
