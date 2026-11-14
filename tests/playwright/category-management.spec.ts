import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { _electron as electron } from "@playwright/test";
import { test as base, expect } from "./fixtures/electron.js";
import { CategoryManagementPage } from "./pom/CategoryManagementPage.js";
import { ManualEntryPage } from "./pom/ManualEntryPage.js";
import { LedgerPage } from "./pom/LedgerPage.js";
import { AppShellPage } from "./pom/AppShellPage.js";

const test = base.extend<{ categoryManagement: CategoryManagementPage }>({
  categoryManagement: async ({ window }, use) => { await use(new CategoryManagementPage(window)); },
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`Activity category management ${viewport.width}x${viewport.height}`, () => {
    test.beforeEach(async ({ window, appShell }) => {
      await window.setViewportSize(viewport);
      await appShell.openWorkspace("Transactions");
    });

    test("creates and renames a category that remains selectable after relaunch", async ({
      window, appShell, categoryManagement, databasePath, electronApp,
    }, testInfo) => {
      await categoryManagement.open();
      await expect(categoryManagement.newName).toBeFocused();
      await categoryManagement.create("  Car   repairs  ");
      await expect(categoryManagement.result).toContainText("Created Car repairs");
      await categoryManagement.rename("Car repairs", "Vehicle care");
      await expect(categoryManagement.result).toContainText("Renamed to Vehicle care");
      await expect(categoryManagement.category("Vehicle care")).toHaveCount(1);
      await expect(categoryManagement.newName).toBeFocused();
      await window.screenshot({ path: testInfo.outputPath(`category-dialog-${viewport.width}.png`) });
      await categoryManagement.close();
      await expect(categoryManagement.opener).toBeFocused();

      const database = new DatabaseSync(databasePath);
      let categoryId: string;
      try {
        const row = database.prepare("SELECT id FROM categories WHERE label = ?").get("Vehicle care");
        expect(typeof row?.id).toBe("string");
        if (typeof row?.id !== "string") throw new Error("Expected saved category identity.");
        categoryId = row.id;
      } finally {
        database.close();
      }
      const ledger = new LedgerPage(window);
      await ledger.openMoreFilters();
      await ledger.categoryInput.selectOption(categoryId);
      await expect(ledger.categoryInput).toHaveValue(categoryId);
      await appShell.openWorkspace("Import");
      await appShell.selectImportFormat("Manual transaction");
      const manualEntry = new ManualEntryPage(window);
      await manualEntry.categoryInput.selectOption(categoryId);
      await expect(manualEntry.categoryInput.getByRole("option", { name: "Vehicle care", exact: true }))
        .toHaveAttribute("value", categoryId);
      await electronApp.close();
      const restartedApp = await electron.launch({
        args: ["--lang=en-GB", `--user-data-dir=${join(dirname(databasePath), "electron-profile")}`,
          join(process.cwd(), "out", "main", "index.js")],
        env: { ...process.env, NODE_ENV: "test", BUDGET_TEST_LEDGER_SEED: "empty", BUDGET_DB_PATH: databasePath },
      });
      try {
        const restartedWindow = await restartedApp.firstWindow();
        await restartedWindow.waitForLoadState("domcontentloaded");
        await restartedWindow.setViewportSize(viewport);
        await new AppShellPage(restartedWindow).openWorkspace("Transactions");
        const restartedCategories = new CategoryManagementPage(restartedWindow);
        await restartedCategories.open();
        await expect(restartedCategories.category("Vehicle care")).toHaveCount(1);
        await expect(restartedCategories.dialog.getByRole("button", { name: "Rename Car repairs", exact: true }))
          .toHaveCount(0);
      } finally {
        await restartedApp.close();
      }
    });

    test("retains a rejected duplicate draft and returns focus on Escape", async ({ categoryManagement }) => {
      await categoryManagement.open();
      await categoryManagement.create("  groceries   & FOOD  ");
      await expect(categoryManagement.error).toContainText("already exists");
      await expect(categoryManagement.newName).toHaveValue("  groceries   & FOOD  ");
      await categoryManagement.create("Household repairs");
      await expect(categoryManagement.result).toContainText("Created Household repairs");
      await categoryManagement.newName.press("Escape");
      await expect(categoryManagement.dialog).not.toBeVisible();
      await expect(categoryManagement.opener).toBeFocused();
    });
  });
}
