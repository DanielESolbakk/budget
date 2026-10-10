import { _electron as electron } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { LedgerPage } from "./pom/LedgerPage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

test.describe("Ledger search and filter workflow", () => {
  test("@performance keeps the Electron ledger responsive with 10,001 rows while sorting and paging", async ({
    databasePath,
  }) => {
    test.setTimeout(60_000);
    const householdId = "household-ledger-scale";
    const accountId = "account-ledger-scale";
    const transactions = Array.from({ length: 10_001 }, (_, index) => ({
      id: `scale-${String(index).padStart(5, "0")}`,
      householdId,
      accountId,
      bookedAtIso: `2026-05-${String((index % 28) + 1).padStart(2, "0")}T08:00:00Z`,
      amountMinor: index % 2 === 0 ? 125 : -125,
      merchantRaw: `Merchant ${String(index).padStart(5, "0")}`,
      categoryId: "groceries",
    }));
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: { id: householdId, name: "Synthetic Household", createdAtIso: "2026-01-01T00:00:00Z" },
        accounts: [{ id: accountId, householdId, name: "Synthetic account", currencyCode: "NOK" }],
        transactions,
        importJobs: [],
        monthlyCategoryTargets: [],
        merchantCategoryRules: [],
      },
    });
    database.close();

    const app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test", BUDGET_DB_PATH: databasePath },
    });

    try {
      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      const appShell = new AppShellPage(window);
      const ledger = new LedgerPage(window);
      await appShell.openWorkspace("Transactions");

      await expect(ledger.resultStatus).toHaveText("10001 ledger transactions");
      await expect(ledger.table.getByRole("row")).toHaveCount(51);

      const sortStartedAt = Date.now();
      await ledger.sortByMerchant();
      await expect(ledger.table.getByRole("columnheader", { name: "Merchant" }))
        .toHaveAttribute("aria-sort", "ascending");
      await expect(ledger.table.getByRole("row").nth(1)).toContainText("Merchant 00000");
      expect(Date.now() - sortStartedAt).toBeLessThan(5_000);

      const pageChangeStartedAt = Date.now();
      await ledger.goToNextPage();
      await expect(ledger.paginationStatus).toHaveText("Page 2 of 201");
      await expect(ledger.table.getByRole("row").nth(1)).toContainText("Merchant 00050");
      expect(Date.now() - pageChangeStartedAt).toBeLessThan(5_000);
      await expect(ledger.table.getByRole("row")).toHaveCount(51);
    } finally {
      await app.close();
    }
  });

  test("quick filters return matching rows and compose with each other", async ({ databasePath }) => {
    const householdId = "household-quick-filters";
    const accountId = "account-quick-filters";
    const now = new Date();
    const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 15, 12).toISOString();
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth(), 0, 12).toISOString();
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: { id: householdId, name: "Quick Filter Household", createdAtIso: "2026-01-01T00:00:00Z" },
        accounts: [{ id: accountId, householdId, name: "Everyday account", currencyCode: "NOK" }],
        transactions: [
          { id: "current-large-income", householdId, accountId, bookedAtIso: currentMonthDate, amountMinor: 1_000_000, merchantRaw: "Current large income", categoryId: "salary" },
          { id: "current-large-expense", householdId, accountId, bookedAtIso: currentMonthDate, amountMinor: -1_000_000, merchantRaw: "Current large expense", categoryId: "groceries" },
          { id: "current-uncategorized-expense", householdId, accountId, bookedAtIso: currentMonthDate, amountMinor: -2_500, merchantRaw: "Current uncategorized expense" },
          { id: "current-small-expense", householdId, accountId, bookedAtIso: currentMonthDate, amountMinor: -999_999, merchantRaw: "Current small expense", categoryId: "housing" },
          { id: "previous-income", householdId, accountId, bookedAtIso: previousMonthDate, amountMinor: 50_000, merchantRaw: "Previous income", categoryId: "salary" },
          { id: "previous-uncategorized-income", householdId, accountId, bookedAtIso: previousMonthDate, amountMinor: 2_500, merchantRaw: "Previous uncategorized income" },
        ],
        importJobs: [],
        monthlyCategoryTargets: [],
        merchantCategoryRules: [],
      },
    });
    database.close();

    const app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test", BUDGET_DB_PATH: databasePath },
    });

    try {
      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      const appShell = new AppShellPage(window);
      const ledger = new LedgerPage(window);
      await appShell.openWorkspace("Transactions");
      await expect(ledger.resultStatus).toHaveText("6 ledger transactions");

      await ledger.quickFilter("Income").click();
      await expect(ledger.resultStatus).toHaveText("3 ledger transactions");
      await expect(ledger.transaction("Current large income")).toBeVisible();
      await expect(ledger.transaction("Current large expense")).not.toBeVisible();
      await expect(ledger.quickFilter("Income")).toHaveAttribute("aria-pressed", "true");
      await expect(ledger.applyButton).toHaveCount(0);
      await ledger.quickFilter("Income").click();
      await expect(ledger.resultStatus).toHaveText("6 ledger transactions");

      await ledger.quickFilter("Expenses").click();
      await expect(ledger.resultStatus).toHaveText("3 ledger transactions");
      await expect(ledger.transaction("Current large expense")).toBeVisible();
      await expect(ledger.transaction("Current large income")).not.toBeVisible();
      await ledger.quickFilter("Expenses").click();
      await expect(ledger.resultStatus).toHaveText("6 ledger transactions");

      await ledger.quickFilter("Uncategorized").click();
      await expect(ledger.resultStatus).toHaveText("2 ledger transactions");
      await expect(ledger.transaction("Current uncategorized expense")).toBeVisible();
      await expect(ledger.transaction("Previous uncategorized income")).toBeVisible();
      await expect(ledger.transaction("Current small expense")).not.toBeVisible();
      await ledger.quickFilter("Uncategorized").click();
      await expect(ledger.resultStatus).toHaveText("6 ledger transactions");

      await ledger.quickFilter("This month").click();
      await expect(ledger.resultStatus).toHaveText("4 ledger transactions");
      await expect(ledger.transaction("Current large income")).toBeVisible();
      await expect(ledger.transaction("Previous income")).not.toBeVisible();
      await ledger.quickFilter("Uncategorized").click();
      await expect(ledger.resultStatus).toHaveText("1 ledger transactions");
      await expect(ledger.transaction("Current uncategorized expense")).toBeVisible();
      await ledger.quickFilter("Uncategorized").click();
      await expect(ledger.resultStatus).toHaveText("4 ledger transactions");
      await ledger.quickFilter("This month").click();
      await expect(ledger.resultStatus).toHaveText("6 ledger transactions");

      await ledger.quickFilter("Large transactions").click();
      await expect(ledger.resultStatus).toHaveText("2 ledger transactions");
      await expect(ledger.transaction("Current large income")).toBeVisible();
      await expect(ledger.transaction("Current large expense")).toBeVisible();
      await expect(ledger.transaction("Current small expense")).not.toBeVisible();
      await ledger.quickFilter("Expenses").click();
      await expect(ledger.resultStatus).toHaveText("1 ledger transactions");
      await expect(ledger.transaction("Current large expense")).toBeVisible();
      await expect(ledger.transaction("Current large income")).not.toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("places advanced filters beside the quick filters", async ({ ledger }) => {
    await expect(
      ledger.section.locator(".ledger-quick-filters").getByText(/^More filters/),
    ).toBeVisible();
  });

  test("filters by an inclusive NOK amount range", async ({ ledger }) => {
    await ledger.openMoreFilters();
    await ledger.amountFromInput.fill("-85,00");
    await ledger.amountToInput.fill("-85,00");

    await expect(ledger.transactionsFor("Rema 1000")).toHaveCount(1);
    await expect(ledger.transactionsFor("Kiwi")).toHaveCount(0);
    await expect(ledger.resultStatus).toHaveText("1 ledger transactions");
  });

  test("explains NOK format and retains active advanced filter identities when collapsed", async ({ ledger }) => {
    await expect(ledger.activeFiltersHeading).not.toBeVisible();
    await ledger.openMoreFilters();
    await expect(ledger.amountFormatHint).toBeVisible();
    await ledger.accountInput.selectOption("sample-acc");
    await ledger.amountFromInput.fill("100");

    await expect(ledger.moreFiltersSummary).toContainText("2 active");
    await expect(ledger.moreFiltersSummary).toContainText("Account");
    await expect(ledger.moreFiltersSummary).toContainText("Amount range");

    await ledger.moreFiltersSummary.click();
    await expect(ledger.amountFromInput).not.toBeVisible();
    await expect(ledger.moreFiltersSummary).toContainText("Account");
    await expect(ledger.moreFiltersSummary).toContainText("Amount range");
  });

  test("counts the two amount bounds as one active range filter", async ({ ledger }) => {
    await ledger.openMoreFilters();
    await ledger.accountInput.selectOption("sample-acc");
    await ledger.amountFromInput.fill("100");
    await ledger.amountToInput.fill("200");

    await expect(ledger.moreFiltersSummary).toContainText("2 active");
    await expect(ledger.moreFiltersSummary).toContainText("Account");
    await expect(ledger.moreFiltersSummary).toContainText("Amount range");
  });

  test("saves, reapplies after an Electron restart, and deletes a local view", async ({ databasePath }) => {
    const launchElectron = () => electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test", BUDGET_DB_PATH: databasePath },
    });
    let app = await launchElectron();

    try {
      let window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      const appShell = new AppShellPage(window);
      await appShell.openWorkspace("Transactions");
      const ledger = new LedgerPage(window);

      await expect(ledger.savedViewsSummary).toHaveText("Saved views (0)");
      await ledger.openSavedViews();
      await ledger.quickFilter("Income").click();
      await expect(ledger.table.getByRole("row")).toHaveCount(3);
      await ledger.savedViewNameInput.fill("Income transactions");
      await expect(ledger.saveViewButton).toBeEnabled();
      await ledger.saveViewButton.click();
      await expect(ledger.savedViewsSummary).toHaveText("Saved views (1)");
      await expect(ledger.savedViews).toContainText("Income transactions");

      await app.close();
      app = await launchElectron();
      window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      const restartedAppShell = new AppShellPage(window);
      await restartedAppShell.openWorkspace("Transactions");
      const restartedLedger = new LedgerPage(window);

      await expect(restartedLedger.savedViewsSummary).toHaveText("Saved views (1)");
      await restartedLedger.openSavedViews();
      await expect(restartedLedger.savedViews).toContainText("Income transactions");
      await restartedLedger.applySavedView("Income transactions");
      await expect(restartedLedger.table.getByRole("row")).toHaveCount(3);
      await restartedLedger.deleteSavedView("Income transactions");
      await expect(restartedLedger.savedViewApplyButton("Income transactions")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("returns a bounded ledger page with the full filtered count", async ({ window: page }) => {
    const result = await page.evaluate(() =>
      window.budgetApi.ledger.list({ page: 1, pageSize: 2 })
    );

    expect(result).toMatchObject({
      transactions: expect.any(Array),
      totalCount: 4,
      page: 1,
      pageSize: 2,
    });
    expect(result.transactions).toHaveLength(2);
  });

  test("account and category sorts follow displayed labels and expose direction", async ({ databasePath }) => {
    const householdId = "household-ledger-label-sorts";
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: { id: householdId, name: "Label Sort Household", createdAtIso: "2026-01-01T00:00:00Z" },
        accounts: [
          { id: "account-z", householdId, name: "Alpha account", currencyCode: "NOK" },
          { id: "account-a", householdId, name: "Zulu account", currencyCode: "NOK" },
        ],
        transactions: [
          { id: "transaction-z", householdId, accountId: "account-z", bookedAtIso: "2026-05-23T08:00:00Z", amountMinor: -1200, merchantRaw: "ZZZ category", categoryId: "ZZZ" },
          { id: "transaction-a", householdId, accountId: "account-a", bookedAtIso: "2026-05-23T08:00:00Z", amountMinor: -1300, merchantRaw: "Housing payment", categoryId: "housing" },
        ],
        importJobs: [],
        monthlyCategoryTargets: [],
        merchantCategoryRules: [],
      },
    });
    database.close();

    const app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test", BUDGET_DB_PATH: databasePath },
    });

    try {
      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      const appShell = new AppShellPage(window);
      const ledger = new LedgerPage(window);
      await appShell.openWorkspace("Transactions");
      await expect(ledger.resultStatus).toHaveText("2 ledger transactions");

      const accountHeader = ledger.table.getByRole("columnheader", { name: "Account" });
      await ledger.table.getByRole("button", { name: "Sort by account" }).click();
      await expect(accountHeader).toHaveAttribute("aria-sort", "ascending");
      await expect(ledger.table.getByRole("row").nth(1)).toContainText("Alpha account");
      await expect(ledger.table.getByRole("row").nth(1)).toContainText("ZZZ category");
      await ledger.table.getByRole("button", { name: "Sort by account" }).click();
      await expect(accountHeader).toHaveAttribute("aria-sort", "descending");
      await expect(ledger.table.getByRole("row").nth(1)).toContainText("Zulu account");

      const categoryHeader = ledger.table.getByRole("columnheader", { name: "Category" });
      await ledger.table.getByRole("button", { name: "Sort by category" }).click();
      await expect(categoryHeader).toHaveAttribute("aria-sort", "ascending");
      await expect(ledger.table.getByRole("row").nth(1)).toContainText("Housing payment");
      await ledger.table.getByRole("button", { name: "Sort by category" }).click();
      await expect(categoryHeader).toHaveAttribute("aria-sort", "descending");
      await expect(ledger.table.getByRole("row").nth(1)).toContainText("ZZZ category");
    } finally {
      await app.close();
    }
  });

  test("shows ledger rows in a readable sortable table", async ({ ledger }) => {
    await expect(ledger.table).toBeVisible();
    await expect(ledger.table.getByRole("columnheader")).toHaveCount(5);
    await expect(ledger.transaction("Rema 1000")).toContainText("Brukskonto");
    await expect(ledger.transaction("Rema 1000")).toContainText("kr");

    const dateHeader = ledger.table.getByRole("columnheader", { name: "Date" });
    await expect(dateHeader).toHaveAttribute("aria-sort", "descending");
    await expect(dateHeader).toContainText("DESC");

    await ledger.sortByMerchant();
    const merchantHeader = ledger.table.getByRole("columnheader", { name: "Merchant" });
    await expect(merchantHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(merchantHeader).toContainText("ASC");

    await ledger.sortByMerchant();
    await expect(merchantHeader).toHaveAttribute("aria-sort", "descending");
    await expect(merchantHeader).toContainText("DESC");
  });

  test("shows applied filters as removable actions", async ({ ledger }) => {
    await ledger.merchantInput.fill("Kiwi");

    await expect(ledger.activeFilters).toContainText("Merchant: Kiwi");
    await ledger.removeFilter("merchant");
    await expect(ledger.transaction("Rema 1000")).toBeVisible();
    await expect(ledger.activeFilters).toHaveCount(0);
  });

  test("clear all removes quick filters and refreshes the ledger", async ({ ledger }) => {
    await expect(ledger.clearFiltersButton).toHaveCount(0);
    await ledger.quickFilter("Income").click();
    await expect(ledger.clearFiltersButton).toBeVisible();
    await expect(ledger.table.getByRole("row")).toHaveCount(3);
    await expect(ledger.activeFilters).toContainText("Type: Income");

    await ledger.clearFiltersButton.click();
    await expect(ledger.clearFiltersButton).toHaveCount(0);
    await expect(ledger.activeFilters).toHaveCount(0);
    await expect(ledger.quickFilter("Income")).toHaveAttribute("aria-pressed", "false");
    await expect(ledger.table.getByRole("row")).toHaveCount(5);
  });

  test("rejects malformed and reversed NOK amount ranges", async ({ ledger }) => {
    await ledger.openMoreFilters();
    await ledger.amountFromInput.fill("1.005");
    await expect(ledger.amountRangeError).toContainText("Enter valid NOK amounts with no more than two decimal places.");
    await expect(ledger.amountFromInput).toHaveAttribute("aria-invalid", "true");
    await expect(ledger.amountFromInput).toHaveAttribute("aria-describedby", "ledger-amount-range-error");
    await expect(ledger.table.getByRole("row")).toHaveCount(5);

    await ledger.amountFromInput.fill("100");
    await ledger.amountToInput.fill("50");
    await expect(ledger.amountRangeError).toContainText("Minimum amount must not exceed maximum amount.");
    await expect(ledger.amountToInput).toHaveAttribute("aria-invalid", "true");
  });

  test("shows a loading state before the initial ledger query completes", async ({
    appShell,
    electronApp,
    ledger,
    window,
  }) => {
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_LEDGER_LIST_DELAY_MS"] = "800";
    });
    await window.reload();
    await appShell.openWorkspace("Transactions");

    await expect(ledger.loadingStatus).toBeVisible();
    await expect(ledger.transaction("Kiwi")).toBeVisible();
    await expect(ledger.loadingStatus).not.toBeVisible();
  });

  test("keeps saving disabled until debounced filter results match", async ({
    electronApp,
    ledger,
    window,
  }) => {
    await ledger.openSavedViews();
    await ledger.savedViewNameInput.fill("Pending filter");
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_LEDGER_LIST_DELAY_MS"] = "220";
    });

    await ledger.sortByMerchant();
    await expect(ledger.updatingStatus).toBeVisible();

    const enabledBeforeMatchingResults = window.evaluate(() => new Promise<boolean>((resolve) => {
      const section = document.querySelector<HTMLElement>('section[aria-label="Ledger"]')!;
      const merchantInput = section.querySelector<HTMLInputElement>('input[aria-label="Filter merchant"]')!;
      const saveButton = section.querySelector<HTMLButtonElement>('.ledger-save-view-form button')!;
      let filterEntered = false;
      let pendingWasObserved = false;
      let enabledBeforeMatch = false;

      const hasMatchingEmptyResult = (): boolean => {
        const resultSummary = section.querySelector(".ledger-result-summary")?.textContent?.trim();
        const emptyState = section.querySelector(".empty-state")?.textContent ?? "";
        const isUpdating = Array.from(section.querySelectorAll('[role="status"]'))
          .some((status) => status.textContent?.includes("Updating ledger for selected filters..."));
        return resultSummary === "0 ledger transactions" &&
          emptyState.includes("No transactions match these filters.") &&
          !isUpdating;
      };

      const finish = (result: boolean): void => {
        observer.disconnect();
        merchantInput.removeEventListener("input", handleInput);
        resolve(result);
      };
      const check = (): void => {
        if (!filterEntered) return;
        if (saveButton.disabled) pendingWasObserved = true;
        else if (pendingWasObserved && !hasMatchingEmptyResult()) enabledBeforeMatch = true;
        if (hasMatchingEmptyResult()) finish(enabledBeforeMatch);
      };
      const handleInput = (): void => {
        filterEntered = merchantInput.value === "no matching merchant";
        check();
      };

      const observer = new MutationObserver(check);
      observer.observe(section, {
        attributes: true,
        attributeFilter: ["disabled"],
        childList: true,
        characterData: true,
        subtree: true,
      });
      merchantInput.addEventListener("input", handleInput);
    }));

    await ledger.merchantInput.fill("no matching merchant");
    await expect(ledger.saveViewButton).toBeDisabled();
    expect(await enabledBeforeMatchingResults).toBe(false);
  });

  test("preserves prior rows and offers retry after a filtered ledger query fails", async ({
    electronApp,
    ledger,
  }) => {
    await expect(ledger.transaction("Kiwi")).toBeVisible();
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_LEDGER_LIST_FAILURE"] = "1";
    });

    await ledger.merchantInput.fill("Rema 1000");

    await expect(ledger.errorAlert).toContainText("Synthetic ledger list failure.");
    await expect(ledger.transaction("Kiwi")).toBeVisible();
    await expect(ledger.retryButton).toBeVisible();

    await electronApp.evaluate(() => {
      delete process.env["BUDGET_TEST_LEDGER_LIST_FAILURE"];
    });
    await ledger.retryButton.click();

    await expect(ledger.transaction("Rema 1000")).toBeVisible();
    await expect(ledger.transaction("Kiwi")).not.toBeVisible();
  });

  test("filters transactions by merchant and category", async ({ ledger }) => {
    await expect(ledger.section).toBeVisible();
    await expect(ledger.transaction("Kiwi")).toBeVisible();

    await ledger.merchantInput.fill("Kiwi");
    await expect(ledger.transaction("Kiwi")).toBeVisible();
    await expect(ledger.transactionsFor("Lønn AS")).toHaveCount(0);

    await ledger.merchantInput.fill("");
    await ledger.openMoreFilters();
    await ledger.categoryInput.selectOption("salary");
    await expect(ledger.transaction("Lønn AS")).toBeVisible();
    await expect(ledger.transactionsFor("Kiwi")).toHaveCount(0);
  });

  test("filters transactions by account, date range, and amount", async ({ ledger }) => {
    await ledger.openMoreFilters();
    await ledger.accountInput.selectOption("sample-acc");
    await ledger.fromDateInput.fill("2026-05-01");
    await ledger.toDateInput.fill("2026-05-31");
    await ledger.amountFromInput.fill("-85.00");
    await ledger.amountToInput.fill("-85.00");

      await expect(ledger.moreFiltersSummary).toContainText("2 active");
      await expect(ledger.moreFiltersSummary).toContainText("Account");
      await expect(ledger.moreFiltersSummary).toContainText("Amount range");
    await ledger.moreFiltersSummary.click();
    await expect(ledger.amountFromInput).not.toBeVisible();
      await expect(ledger.moreFiltersSummary).toContainText("2 active");
      await expect(ledger.moreFiltersSummary).toContainText("Account");
      await expect(ledger.moreFiltersSummary).toContainText("Amount range");
    await expect(ledger.transaction("Rema 1000")).toBeVisible();
    await expect(ledger.transactionsFor("Lønn AS")).toHaveCount(0);

    await ledger.merchantInput.fill("missing merchant");
    await expect(ledger.resultStatus).toHaveText("0 ledger transactions");
    await ledger.openMoreFilters();
    await expect(ledger.accountInput).toContainText("Brukskonto");
  });

  test("@visual Visual: desktop transaction filters preserve ledger hierarchy", async ({ window, electronApp, ledger }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1100);
    });
    await expect(ledger.table).toBeVisible();
    await expect(window).toHaveScreenshot("ledger-filters-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  });

  test("@visual Visual: compact transaction filters avoid page overflow", async ({ window: page, electronApp, ledger }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });
      await expect(ledger.table).toBeVisible();

      const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      compactBreakpoint: window.matchMedia("(max-width: 680px)").matches,
      innerWidth: window.innerWidth,
      appFrameColumns: getComputedStyle(document.querySelector(".app-frame")!).gridTemplateColumns,
    }));
    expect(dimensions.compactBreakpoint).toBe(true);
    expect(dimensions.appFrameColumns.trim().split(/\s+/)).toHaveLength(1);
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
      await expect(page).toHaveScreenshot("ledger-filters-compact.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.015,
    });
  });

  test("keyboard horizontal scrolling can reach the final compact ledger column", async ({ window, electronApp, ledger }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });
    await expect(ledger.table).toBeVisible();

    const tableScroller = window.getByRole("region", { name: "Ledger transactions" });
    await expect(tableScroller).toBeVisible();
    await expect(tableScroller).toHaveAttribute("tabindex", "0");
    await tableScroller.focus();
    await expect(tableScroller).toBeFocused();
    for (let keypress = 0; keypress < 20; keypress += 1) {
      await window.keyboard.press("ArrowRight");
    }
    await expect.poll(() => tableScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    const lastColumnBounds = await ledger.table.getByRole("columnheader", { name: "Account" }).evaluate((header) => {
      const scroller = header.closest<HTMLElement>(".ledger-table-scroll");
      if (scroller === null) throw new Error("Ledger table is missing its scroll container.");
      const headerBounds = header.getBoundingClientRect();
      const scrollerBounds = scroller.getBoundingClientRect();
      return {
        headerLeft: headerBounds.left,
        headerRight: headerBounds.right,
        scrollerLeft: scrollerBounds.left,
        scrollerRight: scrollerBounds.right,
      };
    });
    expect(lastColumnBounds.headerLeft).toBeGreaterThanOrEqual(lastColumnBounds.scrollerLeft - 1);
    expect(lastColumnBounds.headerRight).toBeLessThanOrEqual(lastColumnBounds.scrollerRight + 1);
  });

    test("@visual Visual: advanced filters remain subordinate on desktop", async ({ window, electronApp, ledger }) => {
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1100);
      });
      await ledger.openMoreFilters();
      await expect(ledger.amountFromInput).toBeVisible();
      const advancedLayout = await window.locator(".ledger-secondary-filters").evaluate((element) => ({
        columns: getComputedStyle(element).gridTemplateColumns,
        children: Array.from(element.children).map((child) => {
          const rect = child.getBoundingClientRect();
          return { className: child.className, x: rect.x, y: rect.y, width: rect.width };
        }),
      }));
      expect(advancedLayout.columns.trim().split(/\s+/)).toHaveLength(2);
      expect(advancedLayout.children[0]!.y).toBe(advancedLayout.children[1]!.y);
      expect(advancedLayout.children[1]!.x).toBeGreaterThan(advancedLayout.children[0]!.x);
      expect(advancedLayout.children[2]!.y).toBeGreaterThan(advancedLayout.children[1]!.y);
      expect(advancedLayout.children[2]!.x).toBe(advancedLayout.children[0]!.x);
      expect(advancedLayout.children.at(-1)?.width).toBeGreaterThan(advancedLayout.children[0]!.width);
      await expect(window).toHaveScreenshot("ledger-filters-expanded-desktop.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
    });

    test("@visual Visual: advanced filters stack cleanly on compact screens", async ({ window: page, electronApp, ledger }) => {
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
      });
      await ledger.openMoreFilters();
      await expect(ledger.amountFromInput).toBeVisible();

      const dimensions = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(page).toHaveScreenshot("ledger-filters-expanded-compact.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.015,
      });
    });
});