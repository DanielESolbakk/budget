import { _electron as electron } from "@playwright/test";
import { test, expect } from "./fixtures/electron.js";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { CategoryManagementPage } from "./pom/CategoryManagementPage.js";
import { LedgerPage } from "./pom/LedgerPage.js";

function setRememberedCategory(databasePath: string, categoryId: string): void {
  const database = createLocalLedgerDatabase({ dbPath: databasePath });
  try {
    database.upsertMerchantCategoryRule({ merchantAlias: "KIWI", categoryId });
  } finally {
    database.close();
  }
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
    await expect(editor.getByRole("checkbox", { name: "Remember for this merchant" })).toBeChecked();
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
      await category.focus();
      await window.keyboard.press("Tab");
      await expect(remember).toBeFocused();
      await window.keyboard.press("Tab");
      await expect(manage).toBeFocused();
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
    await splitEditor.getByLabel("Allocation category 1").selectOption("groceries");
    await splitEditor.getByLabel("Allocation amount 1").fill("-40");
    await splitEditor.getByLabel("Allocation category 2").selectOption("housing");
    await splitEditor.getByLabel("Allocation amount 2").fill("-32");
    await editor.getByRole("button", { name: "Use one category" }).click();

    await expect(editor.getByRole("combobox", { name: "Category for Kiwi" })).toHaveValue("housing");
    await expect(remember).not.toBeChecked();
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

  test("saves a one-off correction without changing the remembered merchant category", async ({
    appShell,
    databasePath,
    window,
  }) => {
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
    setRememberedCategory(databasePath, "fuel");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TRIGGER transaction_category_edit_fault
      BEFORE UPDATE OF category_id ON transactions
      WHEN OLD.merchant_raw = 'Kiwi'
      BEGIN SELECT RAISE(ABORT, 'synthetic transaction category edit failure'); END;
    `);

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

      await expect(editor.getByRole("alert"))
        .toContainText("synthetic transaction category edit failure");
      await expect(category).toHaveValue("housing");
      await expect(remember).not.toBeChecked();
      await expect(row).toContainText("Groceries & food");

      database.exec("DROP TRIGGER transaction_category_edit_fault");
      await editor.getByRole("button", { name: "Save category for Kiwi" }).click();

      await expect(row).toContainText("Housing");
      await expect(editor).toBeHidden();
      await expect(window.getByRole("status", { name: "Category edit status" }))
        .toContainText("saved for this transaction only");
      expect(database.prepare(
        "SELECT category_id FROM transactions WHERE merchant_raw = 'Kiwi'"
      ).get()?.category_id).toBe("housing");
      expect(database.prepare(
        "SELECT category_id FROM merchant_category_rules WHERE merchant_alias = 'KIWI'"
      ).get()?.category_id).toBe("fuel");
    } finally {
      database.exec("DROP TRIGGER IF EXISTS transaction_category_edit_fault");
      database.close();
    }
  });

  test("keeps the selected category and split draft through a real category rename", async ({
    appShell,
    databasePath,
    window,
  }) => {
    const original = createLocalLedgerDatabase({ dbPath: databasePath });
    const transactionId = original.loadLedgerSnapshotData().transactions
      .find((transaction) => transaction.merchantRaw === "Kiwi")?.id;
    original.close();
    if (transactionId === undefined) throw new Error("Expected the seeded Kiwi transaction.");

    await appShell.openWorkspace("Transactions");
    const editor = await new LedgerPage(window).openCategoryEditor("Kiwi");
    const category = editor.getByRole("combobox", { name: "Category for Kiwi" });
    const remember = editor.getByRole("checkbox", { name: "Remember for this merchant" });

    await category.selectOption("housing");
    await remember.uncheck();
    await editor.getByRole("button", { name: "Split across categories" }).click();
    const split = editor.getByRole("region", { name: "Transaction category allocations for Kiwi" });
    await split.getByLabel("Allocation category 1").selectOption("fuel");
    await split.getByLabel("Allocation amount 1").fill("-40");
    await split.getByLabel("Allocation category 2").selectOption("housing");
    await split.getByLabel("Allocation amount 2").fill("-32");
    await editor.getByRole("button", { name: "Use one category" }).click();

    const manager = new CategoryManagementPage(window);
    await manager.openFrom("Manage categories for this transaction");
    await manager.rename("Housing", "Household housing");
    await expect(manager.result).toContainText("Renamed to Household housing");
    await expect(manager.newName).toBeFocused();
    await manager.close();

    await expect(category).toBeFocused();
    await expect(category).toHaveValue("housing");
    await expect(category.getByRole("option", { name: "Household housing", exact: true }))
      .toHaveAttribute("value", "housing");
    await expect(remember).not.toBeChecked();
    await editor.getByRole("button", { name: "Split across categories" }).click();
    await expect(split.getByLabel("Allocation category 1")).toHaveValue("fuel");
    await expect(split.getByLabel("Allocation amount 1")).toHaveValue("-40");
    await expect(split.getByLabel("Allocation category 2")).toHaveValue("housing");
    await expect(split.getByLabel("Allocation amount 2")).toHaveValue("-32");
    await editor.getByRole("button", { name: "Use one category" }).click();

    await remember.focus();
    await expect(remember).toBeFocused();
    const unchanged = createLocalLedgerDatabase({ dbPath: databasePath });
    try {
      expect(unchanged.getTransactionById(transactionId)).toMatchObject({ categoryId: "groceries" });
      expect(unchanged.listCategories("sample-hh")
        .find((savedCategory) => savedCategory.id === "housing")?.label).toBe("Household housing");
    } finally {
      unchanged.close();
    }
  });

  test("remembers a category when the transaction already has that category", async ({
    appShell,
    databasePath,
    window,
  }) => {
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
      await expect(editor).toContainText("Remember Fuel for future matching transactions.");
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
        .toContainText("Remember Groceries & food for future matching transactions.");
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
