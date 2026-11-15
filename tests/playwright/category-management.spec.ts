import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { _electron as electron } from "@playwright/test";
import { test as base, expect } from "./fixtures/electron.js";
import { CategoryManagementPage } from "./pom/CategoryManagementPage.js";
import { ManualEntryPage } from "./pom/ManualEntryPage.js";
import { LedgerPage } from "./pom/LedgerPage.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { ReviewQueuePage } from "./pom/ReviewQueuePage.js";
import { CategoryTargetPage } from "./pom/CategoryTargetPage.js";
import { DashboardPage } from "./pom/DashboardPage.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { RecoveryPage } from "./pom/RecoveryPage.js";

const test = base.extend<{
  categoryManagement: CategoryManagementPage;
  categoryScenario: "create" | "rename" | "large";
}>({
  categoryScenario: ["create", { option: true }],
  databasePath: async ({ databasePath, categoryScenario }, use) => {
    const categoryId = "category-car-existing";
    const ledger = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: { id: "sample-hh", name: "Synthetic household", createdAtIso: "2026-01-01T00:00:00Z" },
        accounts: [{ id: "sample-acc", householdId: "sample-hh", name: "Brukskonto", currencyCode: "NOK" }],
        ...(categoryScenario === "rename" ? { categories: [{
          id: categoryId, householdId: "sample-hh", label: "Car repairs",
          createdAtIso: "2026-05-01T00:00:00Z", updatedAtIso: "2026-05-01T00:00:00Z",
        }] } : {}),
        ...(categoryScenario === "large" ? { categories: Array.from({ length: 50 }, (_, index) => ({
          id: `category-large-${index}`, householdId: "sample-hh",
          label: `Synthetic category ${String(index).padStart(2, "0")} with a long household label`,
          createdAtIso: "2026-05-01T00:00:00Z", updatedAtIso: "2026-05-01T00:00:00Z",
        })) } : {}),
        transactions: [{
          id: "tx-workshop", householdId: "sample-hh", accountId: "sample-acc",
          bookedAtIso: "2026-05-23", amountMinor: -12000, currencyCode: "NOK", merchantRaw: "Verksted Solglimt",
          ...(categoryScenario === "rename" ? { categoryId } : { categorization: {
            status: "unmatched", confidence: 0, confidenceLevel: "low", requiresReview: true, matchingRules: [],
          } }),
        }, {
          id: "tx-grocery", householdId: "sample-hh", accountId: "sample-acc",
          bookedAtIso: "2026-05-23", amountMinor: -7200, currencyCode: "NOK", merchantRaw: "Kiwi",
          categoryId: "groceries",
        }],
        importJobs: [],
        monthlyCategoryTargets: [{ yearMonth: "2026-05", categoryId: "groceries", targetMinor: 20000 }],
      },
    });
    ledger.close();
    await use(databasePath);
  },
  categoryManagement: async ({ window }, use) => { await use(new CategoryManagementPage(window)); },
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`Activity category management ${viewport.width}x${viewport.height}`, () => {
    test.beforeEach(async ({ window, appShell }) => {
      await window.setViewportSize(viewport);
      await appShell.openWorkspace("Transactions");
    });

    test.describe("contextual category management", () => {
      test.use({ categoryScenario: "large" });
      test("keeps a manual entry draft when creating a category beside its picker", async ({
        window, appShell, categoryManagement, databasePath,
      }) => {
        await appShell.openWorkspace("Import");
        await appShell.selectImportFormat("Manual transaction");
        const manual = new ManualEntryPage(window);
        await manual.accountInput.selectOption("sample-acc");
        await manual.bookedDateInput.fill("2026-05-24");
        await manual.amountInput.fill("-25.50");
        await manual.merchantInput.fill("Verksted Nordlys");
        await manual.categoryInput.selectOption("groceries");
        await expect(manual.entrySection.getByRole("button", { name: "Manage categories for manual entry" })).toBeVisible();
        await categoryManagement.openFrom("Manage categories for manual entry");
        await categoryManagement.create("Car repairs");
        await expect(categoryManagement.result).toContainText("Created Car repairs");
        await categoryManagement.close();
        await expect(manual.categoryInput).toBeFocused();
        await expect(manual.accountInput).toHaveValue("sample-acc");
        await expect(manual.bookedDateInput).toHaveValue("2026-05-24");
        await expect(manual.amountInput).toHaveValue("-25.50");
        await expect(manual.merchantInput).toHaveValue("Verksted Nordlys");
        await expect(manual.categoryInput).toHaveValue("groceries");
        await manual.categoryInput.selectOption({ label: "Car repairs" });
        const categoryId = await manual.categoryInput.inputValue();
        const before = createLocalLedgerDatabase({ dbPath: databasePath });
        try {
          expect(before.loadLedgerSnapshotData().transactions).toHaveLength(2);
        } finally { before.close(); }
        await manual.submitButton.click();
        await expect(manual.successStatus).toContainText("Verksted Nordlys");
        const saved = createLocalLedgerDatabase({ dbPath: databasePath });
        try {
          expect(saved.loadLedgerSnapshotData().transactions.find((item) => item.merchantRaw === "Verksted Nordlys"))
            .toMatchObject({ accountId: "sample-acc", bookedAtIso: "2026-05-24",
              amountMinor: -2550, categoryId });
        } finally { saved.close(); }
      });

      test("keeps an edited target amount and month when renaming beside its picker", async ({
        window, appShell, categoryManagement, databasePath,
      }) => {
        await appShell.openWorkspace("Review");
        await new DashboardPage(window).selectMonth("2026-05");
        await window.getByText("Manage category targets", { exact: true }).click();
        const targets = new CategoryTargetPage(window);
        await targets.editTargetButton("groceries").click();
        await targets.targetAmountInput.fill("345.67");
        await expect(targets.section.getByRole("button", { name: "Manage categories for budget targets" })).toBeVisible();
        await categoryManagement.openFrom("Manage categories for budget targets");
        await categoryManagement.rename("Groceries & food", "Household food");
        await expect(categoryManagement.result).toContainText("Renamed to Household food");
        await categoryManagement.close();
        await expect(targets.targetAmountInput).toBeFocused();
        await expect(targets.categorySelect).toHaveValue("groceries");
        await expect(targets.categorySelect).toBeDisabled();
        await expect(targets.targetAmountInput).toHaveValue("345.67");
        await expect(targets.section).toContainText("Household food");
        const before = createLocalLedgerDatabase({ dbPath: databasePath });
        try {
          expect(before.loadLedgerSnapshotData().monthlyCategoryTargets)
            .toEqual([{ yearMonth: "2026-05", categoryId: "groceries", targetMinor: 20000 }]);
        } finally { before.close(); }
        await targets.saveButton.click();
        await expect(targets.savedConfirmation).toBeVisible();
        const saved = createLocalLedgerDatabase({ dbPath: databasePath });
        try {
          expect(saved.loadLedgerSnapshotData().monthlyCategoryTargets)
            .toEqual([{ yearMonth: "2026-05", categoryId: "groceries", targetMinor: 34567 }]);
        } finally { saved.close(); }
      });

      for (const context of ["review", "allocations"] as const) {
        test(`keeps an unsaved ${context} choice through ${
          context === "review" ? "cancellation and category saves" : "category management cancellation"
        }`, async ({
          window, categoryManagement, databasePath,
        }) => {
          const review = new ReviewQueuePage(window);
          const workshop = new LedgerPage(window).transaction("Verksted Solglimt");
          if (context === "allocations") {
            await workshop.getByRole("button", { name: "Edit category allocations for Verksted Solglimt" }).click();
          }
          const region = context === "review" ? review.reviewItem("Verksted Solglimt")
            : window.getByRole("region", { name: "Transaction category allocations for Verksted Solglimt" });
          const picker = context === "review" ? review.categorySelect("Verksted Solglimt")
            : region.getByLabel("Allocation category 1");
          if (context === "review") {
            await expect.poll(async () => {
              const guidance = await region.getByRole("paragraph").first().boundingBox();
              const category = await picker.boundingBox();
              if (guidance === null || category === null) throw new Error("Expected the category choice and its guidance.");
              return guidance.width + 1 >= category.width;
            }, { message: "Future-learning guidance must span the category choice instead of collapsing beside it." })
              .toBe(true);
          }
          await picker.selectOption("fees");
          if (context === "allocations") await region.getByLabel("Allocation amount 1").fill("-100.50");
          const openerName = context === "review" ? "Manage categories for Verksted Solglimt"
            : "Manage categories for allocation 1";
          const originalLedger = createLocalLedgerDatabase({ dbPath: databasePath });
          const original = originalLedger.loadLedgerSnapshotData();
          originalLedger.close();
          await expect(region.getByRole("button", { name: openerName, exact: true })).toBeVisible();
          await categoryManagement.openFrom(openerName);
          await categoryManagement.newName.fill("Unsaved household category");
          await categoryManagement.close();
          await expect(picker).toBeFocused();
          await expect(picker).toHaveValue("fees");
          if (context === "allocations") await expect(region.getByLabel("Allocation amount 1")).toHaveValue("-100.50");
          if (context === "review") {
            await categoryManagement.openFrom(openerName);
            await categoryManagement.create("Review repairs");
            await expect(categoryManagement.result).toContainText("Created Review repairs");
            await categoryManagement.close();
            await expect(picker).toBeFocused();
            await expect(picker).toHaveValue("fees");
            await expect(picker.getByRole("option", { name: "Review repairs", exact: true })).toHaveCount(1);
            await categoryManagement.openFrom(openerName);
            await categoryManagement.rename("Fees", "Household fees");
            await expect(categoryManagement.result).toContainText("Renamed to Household fees");
            await categoryManagement.close();
            await expect(picker).toBeFocused();
            await expect(picker).toHaveValue("fees");
            await expect(picker.getByRole("option", { name: "Household fees", exact: true }))
              .toHaveAttribute("value", "fees");
          }
          const unchanged = createLocalLedgerDatabase({ dbPath: databasePath });
          try {
            const snapshot = unchanged.loadLedgerSnapshotData();
            expect(snapshot.transactions).toEqual(original.transactions);
            expect(snapshot.merchantCategoryRules).toEqual(original.merchantCategoryRules);
            expect(snapshot.transactions.find((item) => item.id === "tx-workshop"))
              .toMatchObject({ amountMinor: -12000 });
            expect(snapshot.transactions.find((item) => item.id === "tx-workshop")?.categoryId).toBeUndefined();
            expect(snapshot.categories?.some((category) => category.label === "Unsaved household category")).toBe(false);
          } finally { unchanged.close(); }
        });
      }
    });

    for (const focusDestination of ["origin", "amount"] as const) {
      test(`${focusDestination === "origin" ? "returns to an allocation draft" : "preserves moved amount focus"
      } after dismissing a committed category with a failed refresh`, async ({
        window, categoryManagement, databasePath,
      }) => {
        const workshop = new LedgerPage(window).transaction("Verksted Solglimt");
        await workshop.getByRole("button", { name: "Edit category allocations for Verksted Solglimt" }).click();
        const allocations = window.getByRole("region", { name: "Transaction category allocations for Verksted Solglimt" });
        const picker = allocations.getByLabel("Allocation category 1");
        const amountInput = allocations.getByLabel("Allocation amount 1");
        await picker.selectOption("fees");
        await amountInput.fill("-100.50");
        const originalLedger = createLocalLedgerDatabase({ dbPath: databasePath });
        const originalTransactions = originalLedger.loadLedgerSnapshotData().transactions;
        originalLedger.close();
        const database = new DatabaseSync(databasePath);
        try {
          database.exec(`
            CREATE TRIGGER category_allocation_refresh_fault AFTER INSERT ON categories
            WHEN NEW.label = 'Household repairs'
            BEGIN UPDATE categories SET created_at_iso = 'invalid' WHERE id = NEW.id; END;
          `);
          await categoryManagement.openFrom("Manage categories for allocation 1");
          await categoryManagement.create("Household repairs");
          await expect(categoryManagement.error).toContainText("The category was saved");
          await expect(picker).toBeDisabled();
          if (focusDestination === "amount") {
            await categoryManagement.close();
            await expect(window.getByRole("alert").filter({ hasText: "Categories could not be loaded" })).toBeVisible();
            await expect(picker).toBeDisabled();
            await amountInput.focus();
            await expect(amountInput).toBeFocused();
          }
          database.exec(`
            DROP TRIGGER category_allocation_refresh_fault;
            UPDATE categories SET created_at_iso = '2026-05-01T00:00:00Z' WHERE label = 'Household repairs';
          `);
          if (focusDestination === "origin") {
            await categoryManagement.close();
          } else {
            const amountHandle = await amountInput.elementHandle();
            try {
              // Keep retry and focus movement in one browser task, before real IPC can resolve.
              await window.getByRole("button", { name: "Retry categories", exact: true }).evaluate((button, amount) => {
                if (!(button instanceof HTMLButtonElement) || !(amount instanceof HTMLInputElement)) {
                  throw new Error("Expected the category retry button and allocation amount field.");
                }
                button.focus();
                button.click();
                amount.focus();
              }, amountHandle);
            } finally { await amountHandle?.dispose(); }
          }
          await expect(picker).toBeEnabled();
          await expect(focusDestination === "origin" ? picker : amountInput).toBeFocused();
          await expect(picker).toHaveValue("fees");
          await expect(amountInput).toHaveValue("-100.50");
          const unchangedLedger = createLocalLedgerDatabase({ dbPath: databasePath });
          try {
            expect(unchangedLedger.loadLedgerSnapshotData().transactions).toEqual(originalTransactions);
            expect(unchangedLedger.listCategories("sample-hh").filter((category) => category.label === "Household repairs"))
              .toHaveLength(1);
          } finally { unchangedLedger.close(); }
        } finally { database.close(); }
      });
    }

    test("reads optional category help without submitting or losing a draft", async ({
      categoryManagement, databasePath,
    }) => {
      await categoryManagement.open();
      await categoryManagement.newName.fill("Household repairs");
      const help = categoryManagement.dialog.getByRole("group", { name: "How categories work", exact: true });
      await expect(help).toBeVisible();
      await expect(categoryManagement.newName).toHaveAccessibleDescription(/unique/i);
      const summary = help.getByText("How categories work", { exact: true });
      const explanation = help.getByRole("paragraph", { includeHidden: true }).first();
      await expect(explanation).toBeHidden();
      await summary.press("Enter");
      await expect(explanation).toBeVisible();
      await expect(categoryManagement.newName).toHaveValue("Household repairs");
      await summary.press("Enter");
      await expect(explanation).toBeHidden();
      await expect(categoryManagement.result).toBeEmpty();
      const unchanged = createLocalLedgerDatabase({ dbPath: databasePath });
      try {
        expect(unchanged.loadLedgerSnapshotData().categories?.some((category) => category.label === "Household repairs"))
          .toBe(false);
      } finally { unchanged.close(); }
      await categoryManagement.newName.press("Enter");
      await expect(categoryManagement.result).toContainText("Created Household repairs");
      await expect(categoryManagement.newName).toHaveValue("");
    });

    test("creates and renames a category that remains selectable after relaunch", async ({
      window, appShell, categoryManagement, databasePath, electronApp,
    }, testInfo) => {
      await categoryManagement.open();
      await expect(categoryManagement.newName).toBeFocused();
      await categoryManagement.create("  Car   repairs  ");
      await expect(categoryManagement.result).toContainText("Created Car repairs");
      await categoryManagement.close();
      const review = new ReviewQueuePage(window);
      await review.categorySelect("Verksted Solglimt").selectOption({ label: "Car repairs" });
      await review.saveButton("Verksted Solglimt").click();
      await expect(review.reviewItem("Verksted Solglimt")).toHaveCount(0);
      const ledger = new LedgerPage(window);
      const workshop = ledger.transaction("Verksted Solglimt");
      await expect(workshop).toContainText("Car repairs");
      await workshop.getByRole("button", { name: "Edit category allocations for Verksted Solglimt" }).click();
      const allocations = window.getByRole("region", { name: "Transaction category allocations for Verksted Solglimt" });
      await allocations.getByLabel("Allocation category 1").selectOption({ label: "Car repairs" });
      await allocations.getByLabel("Allocation amount 1").fill("-100.00");
      await allocations.getByLabel("Allocation category 2").selectOption({ label: "Fees" });
      await allocations.getByLabel("Allocation amount 2").fill("-20.00");
      await allocations.getByRole("button", { name: "Save allocations for Verksted Solglimt" }).click();
      await expect(workshop).toContainText("Car repairs");
      await expect(workshop).toContainText("Fees");
      await appShell.openWorkspace("Review");
      await new DashboardPage(window).selectMonth("2026-05");
      await window.getByText("Manage category targets", { exact: true }).click();
      const targets = new CategoryTargetPage(window);
      await targets.addTargetButton.click();
      await targets.categorySelect.selectOption({ label: "Car repairs" });
      await targets.targetAmountInput.fill("500");
      await targets.saveButton.click();
      await expect(targets.savedConfirmation).toBeVisible();
      await expect(targets.savedTargetsList.getByRole("listitem").filter({ hasText: "Car repairs" })).toHaveCount(1);
      await appShell.openWorkspace("Transactions");
      await categoryManagement.open();
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
      await expect(workshop).toContainText("Vehicle care");
      await ledger.openMoreFilters();
      await ledger.categoryInput.selectOption(categoryId);
      await expect(ledger.categoryInput).toHaveValue(categoryId);
      await appShell.openWorkspace("Import");
      await appShell.selectImportFormat("Manual transaction");
      const manualEntry = new ManualEntryPage(window);
      await manualEntry.categoryInput.selectOption(categoryId);
      await expect(manualEntry.categoryInput.getByRole("option", { name: "Vehicle care", exact: true }))
        .toHaveAttribute("value", categoryId);
      await manualEntry.submitEntry({
        accountId: "sample-acc", bookedAtIso: "2026-05-24", amountNok: "-25",
        merchantRaw: "Manual workshop", categoryId,
      });
      await expect(manualEntry.successStatus).toContainText("Added Manual workshop to your ledger.");
      const saved = createLocalLedgerDatabase({ dbPath: databasePath });
      let savedState: ReturnType<typeof saved.loadLedgerSnapshotData>;
      try {
        savedState = saved.loadLedgerSnapshotData();
        expect(saved.getTransactionById("tx-workshop")).toMatchObject({
          amountMinor: -12000, categoryAllocations: [
            { categoryId, amountMinor: -10000 }, { categoryId: "fees", amountMinor: -2000 },
          ],
        });
        expect(savedState.transactions.find(({ merchantRaw }) => merchantRaw === "Manual workshop"))
          .toMatchObject({ categoryId, amountMinor: -2500 });
      } finally {
        saved.close();
      }
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
        await restartedCategories.close();
        await expect(new LedgerPage(restartedWindow).transaction("Verksted Solglimt")).toContainText("Vehicle care");
        await expect(new LedgerPage(restartedWindow).transaction("Manual workshop")).toContainText("Vehicle care");
        const restartedLedger = createLocalLedgerDatabase({ dbPath: databasePath });
        try {
          expect(restartedLedger.loadLedgerSnapshotData()).toEqual(savedState);
        } finally {
          restartedLedger.close();
        }
      } finally {
        await restartedApp.close();
      }
    });

    test("retains a rejected duplicate draft and returns focus on Escape", async ({ categoryManagement }) => {
      await categoryManagement.open();
      await categoryManagement.create("   ");
      await expect(categoryManagement.error).toContainText("Enter a category name");
      await expect(categoryManagement.newName).toHaveValue("   ");
      await expect(categoryManagement.newName).toBeFocused();
      await expect(categoryManagement.newName).toHaveAttribute("aria-invalid", "true");
      await expect(categoryManagement.newName).toHaveAttribute("aria-describedby", /(?:^|\s)category-management-error(?:\s|$)/);
      await categoryManagement.create("  HEALTH  ");
      await expect(categoryManagement.error).toContainText("already exists");
      await expect(categoryManagement.error).toContainText("Choose a different name");
      await expect(categoryManagement.error).not.toContainText("remote method");
      await expect(categoryManagement.newName).toHaveValue("  HEALTH  ");
      await expect(categoryManagement.newName).toBeFocused();
      await expect(categoryManagement.category("Health")).toHaveCount(1);
      await categoryManagement.create("Car repairs");
      await expect(categoryManagement.result).toContainText("Created Car repairs");
      await categoryManagement.newName.press("Escape");
      await expect(categoryManagement.dialog).not.toBeVisible();
      await expect(categoryManagement.opener).toBeFocused();
    });

    test.describe("large category catalog", () => {
      test.use({ categoryScenario: "large" });
      test("searches names without creating categories or losing rename drafts and retains the query after saves", async ({
        categoryManagement,
      }) => {
        await categoryManagement.open();
        await categoryManagement.newName.fill("Unsaved household category");
        await expect(categoryManagement.searchInput).toBeVisible();
        await categoryManagement.searchInput.fill("  SYNTHETIC   category 49  ");
        await categoryManagement.searchInput.press("Enter");
        const list = categoryManagement.dialog.getByRole("list", { name: "Household categories" });
        await expect(list.getByRole("listitem")).toHaveCount(1);
        await expect(categoryManagement.newName).toHaveValue("Unsaved household category");
        await expect(categoryManagement.result).toBeEmpty();
        const name = "Synthetic category 49 with a long household label";
        await categoryManagement.dialog.getByRole("button", { name: `Rename ${name}`, exact: true }).click();
        const rename = categoryManagement.dialog.getByRole("textbox", { name: "Category name", exact: true });
        await rename.fill("Uncommitted rename");
        await expect(categoryManagement.searchInput).toBeDisabled();
        await categoryManagement.dialog.getByRole("button", { name: "Cancel rename", exact: true }).click();
        await expect(categoryManagement.searchInput).toHaveValue("  SYNTHETIC   category 49  ");
        await expect(categoryManagement.category(name)).toHaveCount(1);
        await categoryManagement.rename(name, "Revised household label");
        await expect(categoryManagement.result).toContainText("Renamed to Revised household label");
        await expect(categoryManagement.searchInput).toHaveValue("  SYNTHETIC   category 49  ");
        await expect(list.getByRole("listitem")).toHaveCount(0);
        await expect(categoryManagement.dialog).toContainText("No categories match your search");
        await categoryManagement.create("Car repairs");
        await expect(categoryManagement.result).toContainText("Created Car repairs");
        await expect(categoryManagement.searchInput).toHaveValue("  SYNTHETIC   category 49  ");
        await categoryManagement.dialog.getByRole("button", { name: "Clear search", exact: true }).click();
        await expect(categoryManagement.searchInput).toBeFocused();
        await expect(list.getByRole("listitem")).toHaveCount(65);
        await expect(categoryManagement.category("Revised household label")).toHaveCount(1);
        await expect(categoryManagement.category("Car repairs")).toHaveCount(1);
      });
      test("keeps Close reachable after scrolling the catalog at compact size or desktop zoom", async ({
        categoryManagement, electronApp, window,
      }, testInfo) => {
        if (viewport.width === 1280) {
          await electronApp.evaluate(({ BrowserWindow }) => {
            const mainWindow = BrowserWindow.getAllWindows()[0];
            if (mainWindow === undefined) throw new Error("Expected the isolated Electron window.");
            mainWindow.webContents.setZoomFactor(2);
          });
        }
        await categoryManagement.open();
        const lastName = "Synthetic category 49 with a long household label";
        await categoryManagement.category(lastName).scrollIntoViewIfNeeded();
        await expect(categoryManagement.dialog.getByRole("button", { name: `Rename ${lastName}`, exact: true }))
          .toBeInViewport({ ratio: 1 });
        await expect(categoryManagement.dialog.getByRole("button", { name: "Close category management", exact: true }))
          .toBeInViewport({ ratio: 1 });
        await window.screenshot({ path: testInfo.outputPath(`category-scroll-${viewport.width}.png`) });
        await categoryManagement.close();
        await expect(categoryManagement.opener).toBeFocused();
      });
    });

    test.describe("independently assigned category", () => {
      test.use({ categoryScenario: "rename" });
      test("renames an existing assigned category without changing its transaction after relaunch", async ({
        window, categoryManagement, databasePath, electronApp,
      }) => {
        const before = createLocalLedgerDatabase({ dbPath: databasePath });
        const original = before.loadLedgerSnapshotData();
        before.close();
        await expect(new LedgerPage(window).transaction("Verksted Solglimt")).toContainText("Car repairs");
        await categoryManagement.open();
        await categoryManagement.rename("Car repairs", "  HEALTH  ");
        const renameName = categoryManagement.dialog.getByRole("textbox", { name: "Category name", exact: true });
        await expect(categoryManagement.error).toContainText("Choose a different name");
        await expect(categoryManagement.error).not.toContainText("remote method");
        await expect(renameName).toHaveValue("  HEALTH  ");
        await expect(renameName).toBeFocused();
        await expect(renameName).toHaveAttribute("aria-invalid", "true");
        await expect(renameName).toHaveAttribute("aria-describedby", /(?:^|\s)category-management-error(?:\s|$)/);
        const rejected = createLocalLedgerDatabase({ dbPath: databasePath });
        try {
          expect(rejected.loadLedgerSnapshotData()).toEqual(original);
        } finally {
          rejected.close();
        }
        await renameName.fill("Vehicle repairs");
        await renameName.press("Enter");
        await expect(categoryManagement.result).toContainText("Renamed to Vehicle repairs");
        await expect(categoryManagement.newName).toBeFocused();
        await categoryManagement.close();
        await expect(new LedgerPage(window).transaction("Verksted Solglimt")).toContainText("Vehicle repairs");
        await electronApp.close();
        const restarted = await electron.launch({
          args: ["--lang=en-GB", `--user-data-dir=${join(dirname(databasePath), "electron-profile")}`,
            join(process.cwd(), "out", "main", "index.js")],
          env: { ...process.env, NODE_ENV: "test", BUDGET_TEST_LEDGER_SEED: "empty", BUDGET_DB_PATH: databasePath },
        });
        try {
          const page = await restarted.firstWindow();
          await page.setViewportSize(viewport);
          await new AppShellPage(page).openWorkspace("Transactions");
          const ledger = new LedgerPage(page);
          await expect(ledger.transaction("Verksted Solglimt")).toContainText("Vehicle repairs");
          await ledger.openMoreFilters();
          await expect(ledger.categoryInput.getByRole("option", { name: "Vehicle repairs", exact: true }))
            .toHaveAttribute("value", "category-car-existing");
          const reopened = createLocalLedgerDatabase({ dbPath: databasePath });
          try {
            const current = reopened.loadLedgerSnapshotData();
            expect(current.transactions).toEqual(original.transactions);
            expect(current.monthlyCategoryTargets).toEqual(original.monthlyCategoryTargets);
            expect(current.categories?.find(({ id }) => id === "category-car-existing")).toMatchObject({
              label: "Vehicle repairs", createdAtIso: "2026-05-01T00:00:00Z",
            });
          } finally {
            reopened.close();
          }
        } finally {
          await restarted.close();
        }
      });

      test("refreshes the sorted ledger when a committed rename is dismissed before recovery", async ({
        window, categoryManagement, databasePath,
      }) => {
        const ledger = new LedgerPage(window);
        await ledger.table.getByRole("button", { name: "Sort by category", exact: true }).click();
        const rows = ledger.table.getByRole("row", { name: /^Ledger transaction/ });
        await expect(rows).toHaveText([/Verksted Solglimt/, /Kiwi/]);
        const database = new DatabaseSync(databasePath);
        try {
          database.exec(`
            CREATE TRIGGER category_close_refresh_fault AFTER UPDATE OF label ON categories
            WHEN NEW.label = 'ZZ Vehicle'
            BEGIN UPDATE categories SET created_at_iso = 'invalid' WHERE id = NEW.id; END;
          `);
          await categoryManagement.open();
          await categoryManagement.rename("Car repairs", "ZZ Vehicle");
          await expect(categoryManagement.error).toContainText("The category was saved");
          database.exec(`
            DROP TRIGGER category_close_refresh_fault;
            UPDATE categories SET created_at_iso = '2026-05-01T00:00:00Z' WHERE id = 'category-car-existing';
          `);
          await categoryManagement.newName.press("Escape");
          await expect(categoryManagement.dialog).toBeHidden();
          await expect(categoryManagement.opener).toBeEnabled();
          await expect(rows).toHaveText([/Kiwi/, /Verksted Solglimt/]);
          await expect(ledger.transaction("Verksted Solglimt")).toContainText("ZZ Vehicle");
        } finally {
          database.close();
        }
      });
    });

    test("recovers loading and write failures without saving a cancelled keyboard draft", async ({
      window, appShell, categoryManagement, databasePath,
    }) => {
      const database = new DatabaseSync(databasePath);
      try {
        database.exec("UPDATE categories SET created_at_iso = 'invalid' WHERE id = 'health'");
        await window.reload();
        await appShell.openWorkspace("Transactions");
        const catalogError = window.getByRole("alert").filter({ hasText: "Categories could not be loaded" });
        await expect(catalogError).toBeVisible();
        await expect(categoryManagement.opener).toBeDisabled();
        await catalogError.getByRole("button", { name: "Retry categories", exact: true }).click();
        await expect(catalogError).toBeVisible();
        database.exec("UPDATE categories SET created_at_iso = '2026-01-01T00:00:00Z' WHERE id = 'health'");
        await catalogError.getByRole("button", { name: "Retry categories", exact: true }).click();
        await expect(catalogError).toHaveCount(0);
        await categoryManagement.opener.focus();
        await categoryManagement.opener.press("Enter");
        await expect(categoryManagement.newName).toBeFocused();
        await categoryManagement.newName.fill("Cancelled category");
        await categoryManagement.newName.press("Escape");
        await expect(categoryManagement.dialog).toBeHidden();
        await expect(categoryManagement.opener).toBeFocused();
        expect(database.prepare("SELECT COUNT(*) AS count FROM categories WHERE label = ?")
          .get("Cancelled category")?.count).toBe(0);
        database.exec(`
          CREATE TRIGGER category_save_fault BEFORE INSERT ON categories
          WHEN NEW.label = 'Car repairs'
          BEGIN SELECT RAISE(ABORT, 'synthetic category save failure'); END;
        `);
        await categoryManagement.open();
        await categoryManagement.newName.fill("Car repairs");
        await categoryManagement.newName.press("Enter");
        await expect(categoryManagement.error).toContainText("synthetic category save failure");
        await expect(categoryManagement.newName).toHaveValue("Car repairs");
        await expect(categoryManagement.result).toBeEmpty();
        expect(database.prepare("SELECT COUNT(*) AS count FROM categories WHERE label = ?").get("Car repairs")?.count)
          .toBe(0);
        database.exec("DROP TRIGGER category_save_fault");
        await categoryManagement.newName.press("Enter");
        await expect(categoryManagement.result).toContainText("Created Car repairs");
        await expect(categoryManagement.newName).toHaveValue("");
        await expect(categoryManagement.error).toHaveCount(0);
      } finally {
        database.close();
      }
    });

    test.describe("portable category correction history", () => {
      test.use({ backupOutputDialogBehavior: "selected" });
      test("restores category evidence and safely undoes only unchanged imported transactions", async ({
        window, appShell, categoryManagement, databasePath, csvImport,
      }) => {
        const csvPath = join(dirname(databasePath), "synthetic-history.csv");
        const header = "Utf\u00f8rt dato;Bokf\u00f8rt dato;Rentedato;Beskrivelse;Type;Undertype;Fra konto;Avsender;Til konto;Mottakernavn;Bel\u00f8p inn;Bel\u00f8p ut;Valuta;Status;Melding/KID/Fakt.nr";
        const rows = [["Mekonomen Stavanger", "-101.00"], ["Verksted Nordlys", "-202.00"]].map(([merchant, amount], index) => [
          "25.05.2026", "25.05.2026", "25.05.2026", merchant, "Varekj\u00f8p", "Debetkort", "SYNTHETIC-001",
          "", "", "", "0.00", amount, "NOK", "Bokf\u00f8rt", `SYNTHETIC-REF-${index + 1}`,
        ].join(";"));
        writeFileSync(csvPath, [header, ...rows].join("\n"), "utf8");
        await appShell.openWorkspace("Import");
        await csvImport.submitImport(csvPath);
        await expect(csvImport.successStatus).toContainText("2 transactions");
        await appShell.openWorkspace("Transactions");
        await categoryManagement.open();
        await categoryManagement.create("Car repairs");
        await expect(categoryManagement.result).toContainText("Created Car repairs");
        await categoryManagement.close();
        const review = new ReviewQueuePage(window);
        await review.categorySelect("Mekonomen Stavanger").selectOption({ label: "Car repairs" });
        await review.saveButton("Mekonomen Stavanger").click();
        await expect(review.reviewItem("Mekonomen Stavanger")).toHaveCount(0);
        const originalDatabase = createLocalLedgerDatabase({ dbPath: databasePath });
        const original = originalDatabase.loadLedgerSnapshotData();
        originalDatabase.close();
        expect(original.recoveryHistory?.merchantCorrections).toHaveLength(1);
        const untouched = original.transactions.find(({ merchantRaw }) => merchantRaw === "Verksted Nordlys");
        if (untouched === undefined) throw new Error("Expected the unchanged synthetic import transaction.");
        await appShell.openWorkspace("Data safety");
        const recovery = new RecoveryPage(window);
        await recovery.backupBrowseButton.click();
        await recovery.backupCreateButton.click();
        await expect(recovery.backupSuccess).toBeVisible();
        const backupPath = join(dirname(databasePath), "dialog-selected-backup.json");
        await appShell.openWorkspace("Transactions");
        await categoryManagement.open();
        await categoryManagement.rename("Car repairs", "Temporary name");
        await expect(categoryManagement.result).toContainText("Renamed to Temporary name");
        await categoryManagement.close();
        await appShell.openWorkspace("Data safety");
        await recovery.restorePathInput.fill(backupPath);
        await recovery.reviewSnapshotButton.click();
        await expect(recovery.snapshotReviewSuccess).toBeVisible();
        window.once("dialog", async (dialog) => { await dialog.accept(); });
        await recovery.restoreButton.click();
        await expect(recovery.restoreSuccess).toBeVisible();
        const restoredDatabase = createLocalLedgerDatabase({ dbPath: databasePath });
        try {
          expect(restoredDatabase.loadLedgerSnapshotData().recoveryHistory).toEqual(original.recoveryHistory);
        } finally {
          restoredDatabase.close();
        }
        await appShell.openWorkspace("Transactions");
        await expect(new LedgerPage(window).transaction("Mekonomen Stavanger")).toContainText("Car repairs");
        await appShell.openWorkspace("Import");
        await window.getByRole("button", { name: "Import history", exact: true }).click();
        const history = window.getByRole("region", { name: "Import history", exact: true });
        const importRow = history.getByRole("row").filter({ hasText: "synthetic-history.csv" });
        await importRow.getByRole("button", { name: /Undo import/ }).click();
        await history.getByRole("group", { name: "Undo import confirmation" })
          .getByRole("button", { name: "Confirm undo", exact: true }).click();
        await expect(history.getByRole("status", { name: "Import undo result" }))
          .toContainText("1 imported item removed");
        const afterDatabase = createLocalLedgerDatabase({ dbPath: databasePath });
        try {
          expect(afterDatabase.loadLedgerSnapshotData().transactions)
            .toEqual(original.transactions.filter(({ id }) => id !== untouched.id));
          expect(afterDatabase.listMerchantCorrectionProvenance()).toHaveLength(1);
          expect(afterDatabase.listMerchantCategoryRules()).toEqual(original.merchantCategoryRules);
        } finally {
          afterDatabase.close();
        }
      });
    });

    for (const mode of ["create", "rename"] as const) {
      test(`recovers a committed ${mode} after repeated catalog failures without replaying the write`, async ({
        categoryManagement, databasePath,
      }) => {
        const database = new DatabaseSync(databasePath);
        try {
          database.exec(`
            CREATE TABLE category_save_observations (operation TEXT NOT NULL);
            CREATE TRIGGER category_refresh_fault
            AFTER ${mode === "create" ? "INSERT" : "UPDATE OF label"} ON categories
            WHEN NEW.label = 'Vehicle repairs'
            BEGIN
              INSERT INTO category_save_observations VALUES ('${mode}');
              UPDATE categories SET created_at_iso = 'invalid' WHERE id = NEW.id;
            END;
          `);
          await categoryManagement.open();
          if (mode === "create") await categoryManagement.create("Vehicle repairs");
          else await categoryManagement.rename("Groceries & food", "Vehicle repairs");
          await expect(categoryManagement.error).toContainText("The category was saved");
          const retry = categoryManagement.dialog.getByRole("button", { name: "Retry categories", exact: true });
          await retry.click();
          await expect(categoryManagement.error).toContainText("The category was saved");
          await expect(retry).toBeEnabled();
          await expect(categoryManagement.dialog.getByRole("button", { name: "Create category", exact: true }))
            .toBeDisabled();
          if (mode === "create") await categoryManagement.newName.fill("Next category draft");
          database.exec(`
            DROP TRIGGER category_refresh_fault;
            UPDATE categories SET created_at_iso = updated_at_iso WHERE label = 'Vehicle repairs';
          `);
          await retry.click();
          await expect(categoryManagement.error).toHaveCount(0);
          await expect(categoryManagement.result).toContainText(
            mode === "create" ? "Created Vehicle repairs" : "Renamed to Vehicle repairs",
          );
          await expect(categoryManagement.category("Vehicle repairs")).toHaveCount(1);
          await expect(categoryManagement.newName).toBeFocused();
          if (mode === "create") await expect(categoryManagement.newName).toHaveValue("Next category draft");
          else await expect(categoryManagement.dialog.getByRole("textbox", { name: "Category name", exact: true }))
            .toHaveCount(0);
          expect(database.prepare("SELECT COUNT(*) AS count FROM category_save_observations").get()?.count).toBe(1);
          expect(database.prepare("SELECT COUNT(*) AS count FROM categories WHERE label = ?")
            .get("Vehicle repairs")?.count).toBe(1);
        } finally {
          database.close();
        }
      });
    }
  });
}
