import { test, expect } from "./fixtures/electron.js";

test.describe("Ledger search and filter workflow", () => {
  test("quick filters automatically update the count and ledger rows", async ({ ledger }) => {
    await expect(ledger.table.getByRole("row")).toHaveCount(5);
    await ledger.quickFilter("Income").click();

    await expect(ledger.updatingStatus).toBeVisible();
    await expect(ledger.table.getByRole("row")).toHaveCount(3);
    await expect(ledger.resultStatus).toHaveText("2 ledger transactions");
    await expect(ledger.applyButton).toHaveCount(0);
    await expect(ledger.quickFilter("Income")).toHaveAttribute("aria-pressed", "true");

    await ledger.quickFilter("Income").click();
    await expect(ledger.table.getByRole("row")).toHaveCount(5);

    for (const filterName of ["Uncategorized", "Expenses", "This month", "Large transactions"]) {
      await ledger.quickFilter(filterName).click();
      await expect(ledger.quickFilter(filterName)).toHaveAttribute("aria-pressed", "true");
      await ledger.quickFilter(filterName).click();
      await expect(ledger.quickFilter(filterName)).toHaveAttribute("aria-pressed", "false");
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

  test("saves, reapplies after renderer reload, and deletes a local view", async ({ appShell, ledger, window }) => {
    await expect(ledger.savedViewsSummary).toHaveText("Saved views (0)");
    await expect(ledger.savedViewNameInput).not.toBeVisible();
    await ledger.openSavedViews();
    await expect(ledger.savedViewNameInput).toBeVisible();

    await ledger.quickFilter("Income").click();
    await expect(ledger.table.getByRole("row")).toHaveCount(3);
    await ledger.savedViewNameInput.fill("Income transactions");
    await expect(ledger.saveViewButton).toBeEnabled();
    await ledger.saveViewButton.click();
    await expect(ledger.savedViewsSummary).toHaveText("Saved views (1)");
    await ledger.openSavedViews();
    await expect(ledger.savedViews).toContainText("Income transactions");

    await window.reload();
  await appShell.openWorkspace("Transactions");
    await expect(ledger.savedViewsSummary).toHaveText("Saved views (1)");
    await ledger.openSavedViews();
    await expect(ledger.savedViews).toContainText("Income transactions");
    await ledger.applySavedView("Income transactions");
    await expect(ledger.table.getByRole("row")).toHaveCount(3);

    await ledger.deleteSavedView("Income transactions");
    await expect(ledger.savedViewApplyButton("Income transactions")).toHaveCount(0);
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
  });

  test("shows ledger rows in a readable sortable table", async ({ ledger }) => {
    await expect(ledger.table).toBeVisible();
    await expect(ledger.table.getByRole("columnheader")).toHaveCount(5);
    await expect(ledger.transaction("Rema 1000")).toContainText("Brukskonto");
    await expect(ledger.transaction("Rema 1000")).toContainText("kr");

    await ledger.sortByMerchant();
    await expect(ledger.table.getByRole("columnheader", { name: "Merchant" }))
      .toHaveAttribute("aria-sort", "ascending");
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

      await expect(ledger.moreFiltersSummary).toContainText("3 active");
      await expect(ledger.moreFiltersSummary).toContainText("Account");
      await expect(ledger.moreFiltersSummary).toContainText("Amount range");
    await ledger.moreFiltersSummary.click();
    await expect(ledger.amountFromInput).not.toBeVisible();
      await expect(ledger.moreFiltersSummary).toContainText("3 active");
      await expect(ledger.moreFiltersSummary).toContainText("Account");
      await expect(ledger.moreFiltersSummary).toContainText("Amount range");
    await expect(ledger.transaction("Rema 1000")).toBeVisible();
    await expect(ledger.transactionsFor("Lønn AS")).toHaveCount(0);

    await ledger.merchantInput.fill("missing merchant");
    await expect(ledger.resultStatus).toHaveText("0 ledger transactions");
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
      await expect(page).toHaveScreenshot("ledger-filters-expanded-compact.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.015,
      });
    });
});