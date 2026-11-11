/**
 * Playwright runtime smoke tests for the monthly dashboard renderer.
 *
 * These tests launch the built Electron app and verify:
 *   - Monthly totals section renders with income, expense, and net values visible (AC-3 / #23)
 *   - Category breakdown section renders with at least one category row visible (AC-3 / #23)
 *   - Month-switch interaction updates selected month and refreshes at least one
 *     displayed totals or category value (AC-4 / #23)
 *
 * Framework boundary:
 *   Vitest   -- unit, integration, and Vitest e2e smoke tests (tests/e2e/)
 *   Playwright -- Electron runtime flow validation (this file)
 *
 * Prerequisites: `npm run test:e2e:playwright` runs `npm run build` automatically via the
 * pretest script. To run manually first: `npm run build && npm run test:e2e:playwright`.
 */

import { test, expect } from "./fixtures/electron.js";
import { AppShellPage } from "./pom/AppShellPage.js";

const MOBILE_SCREENSHOT_DIFF_RATIO = process.platform === "linux" ? 0.03 : 0.01;

test.describe("Dashboard renderer smoke", () => {
  test.beforeEach(async ({ dashboard, window }) => {
    await window.clock.setFixedTime(new Date("2026-06-15T12:00:00"));
    await dashboard.selectMonth("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
    await expect(dashboard.monthSelector).toHaveValue("2026-05");
    await dashboard.monthlyTotalsSection.getByText("Change period", { exact: true }).click();
  });

  test("Scenario 3: month-switch control updates selected month and refreshes at least one value", async ({ dashboard }) => {
    // AC-4: changing the selected month refreshes totals and categories.
    // Wait for initial data to render before capturing baseline.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
    await expect(dashboard.categoryBreakdownHeading).toBeVisible();
    await expect(dashboard.categoryEntries.first()).toBeVisible();

    // Capture baseline state.
    const beforeMonth = await dashboard.monthSelector.inputValue();
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";
    const beforeCategoryText = (await dashboard.categoryEntries.first().textContent()) ?? "";

    // Switch to a different month option dynamically to avoid fixture-coupled hardcoding.
    const targetMonth = await dashboard.selectDifferentMonth(beforeMonth);

    // Assert selected month label updated immediately.
    await expect(dashboard.monthSelector).toHaveValue(targetMonth);

    // Assert totals and category rows refresh after month switch.
    // Uses a web-first assertion so Playwright waits for the re-render.
    await expect(dashboard.incomeValue).toBeVisible();
    await expect(dashboard.categoryEntries.first()).toBeVisible();
    await expect(dashboard.incomeValue).not.toHaveText(beforeIncomeText);
    await expect(dashboard.categoryEntries.first()).not.toHaveText(beforeCategoryText);

    // Assert both sections remain visible after the switch.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
  });

  test("Scenario 4: each monthly total keeps its label paired with its value", async ({ dashboard }) => {
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.monthlyTotalsHeading).toBeVisible();
    await expect(dashboard.incomeValue).toBeVisible();
    await expect(dashboard.expenseValue).toBeVisible();
    await expect(dashboard.netValue).toBeVisible();
    await expect(dashboard.monthlyTotal("Income")).toContainText("Income");
    await expect(dashboard.monthlyTotal("Income").getByLabel("Income", { exact: true })).toBeVisible();
    await expect(dashboard.monthlyTotal("Expenses")).toContainText("Expenses");
    await expect(dashboard.monthlyTotal("Expenses").getByLabel("Expenses", { exact: true })).toBeVisible();
    await expect(dashboard.monthlyTotal("Monthly net")).toContainText("Monthly net");
    await expect(dashboard.monthlyTotal("Monthly net").getByLabel("Monthly net", { exact: true })).toBeVisible();
  });

  test("primary navigation explains workspace contents and identifies the active view", async ({
    window,
  }) => {
    const appShell = new AppShellPage(window);
    const activity = appShell.destination("Transactions");

    await expect(activity).toHaveAttribute("aria-describedby", "activity-workspace-description");
    await expect(window.locator("#activity-workspace-description")).toHaveText(
      "Transactions, pending items, and imports"
    );

    await appShell.openWorkspace("Import");
    await expect(activity).toHaveAttribute("aria-current", "page");
    await expect(
      window.getByRole("navigation", { name: "Activity views" }).getByRole("button", {
        name: "Import",
        exact: true,
      })
    ).toHaveAttribute("aria-current", "page");
  });

  test("healthy monthly checks avoid unnecessary category and budget actions", async ({ dashboard }) => {
    await expect(dashboard.monthlyAttention).toContainText("No category reviews or over-target categories this month.");
    await expect(dashboard.monthlyAttention.getByRole("button", { name: "Set a category target" })).toHaveCount(0);
    await expect(dashboard.monthlyAttention).toContainText("No statement periods recorded");
  });

  test("review action explains that it opens transactions across all months", async ({ window, appShell }) => {
    await window.getByRole("button", { name: "Review all transactions", exact: true }).click();
    await expect(appShell.workspace("Transactions")).toBeVisible();
  });

  test("independent forecast is available through keyboard-operated planning disclosure", async ({ window }) => {
    const forecast = window.getByRole("region", { name: "Forecast", exact: true });
    await expect(forecast).toBeHidden();
    const planning = window.getByRole("group", { name: "Planning tools" });
    const summary = planning.locator("summary").first();
    await summary.focus();
    await summary.press("Enter");
    await expect(forecast).toBeVisible();
    await expect(forecast).toContainText("does not follow the review month selector");
  });

  test("budget maintenance opens on demand without obscuring comparison", async ({ window, dashboard }) => {
    await expect(dashboard.targetVsActualSection).toBeVisible();
    await expect(dashboard.categoryTargetEntrySection).toBeHidden();
    const summary = window.getByText("Manage category targets", { exact: true });
    await summary.focus();
    await summary.press("Enter");
    await expect(dashboard.categoryTargetEntrySection).toBeVisible();
    await dashboard.categoryTargetEntrySection.getByRole("button", { name: "Add target", exact: true }).click();
    await expect(window.getByRole("combobox", { name: "Category", exact: true })).toBeFocused();
    await expect(dashboard.monthSelector).toBeDisabled();
    await summary.click();
    await expect(dashboard.categoryTargetEntrySection).toBeVisible();
    await expect(dashboard.monthSelector).toBeDisabled();
  });

  test("monthly net is distinct from spendable cash and links to both planning tools", async ({
    dashboard,
    window,
  }) => {
    await expect(dashboard.monthlyTotal("Monthly net")).toBeVisible();
    await expect(dashboard.monthlyTotalsSection).toContainText(/monthly net is this month's income minus expenses/i);
    await expect(dashboard.monthlyTotalsSection).toContainText(/not spendable cash until your next income/i);

    const planningLinks = window.getByRole("navigation", { name: "Cash planning" });
    const spendableLink = planningLinks.getByRole("link", {
      name: "Estimate spendable cash",
      exact: true,
    });
    await expect(spendableLink).toHaveAttribute("href", "#spendable-cash");
    await expect(planningLinks.getByRole("link", {
      name: "Compare cashflow scenarios",
      exact: true,
    })).toHaveAttribute("href", "#cashflow-scenarios");

    const planningDisclosure = window.getByRole("group", { name: "Planning tools" });
    await expect(planningDisclosure).not.toHaveAttribute("open", "");
    await expect(dashboard.spendableCashSection).toBeHidden();
    await spendableLink.click();
    await expect(window).toHaveURL(/#spendable-cash$/);
    await expect(planningDisclosure).toHaveAttribute("open", "");
    await expect(dashboard.spendableCashSection).toBeInViewport();
  });

  test("category target entry repeats the selected month beside its form", async ({ window }) => {
    await window.getByText("Manage category targets", { exact: true }).click();
    const targetSection = window.getByRole("region", { name: "Category Target Entry" });
    await expect(targetSection.getByText("Targets for mai 2026", { exact: true })).toBeVisible();
  });

  test("target management leads directly to keyboard-operable target setup", async ({ window, categoryTarget }) => {
    const setup = window.getByText("Manage category targets", { exact: true });
    await setup.click();
    await setup.focus();
    await setup.press("Enter");
    await expect(categoryTarget.addTargetButton).toBeVisible();
    await categoryTarget.addTargetButton.focus();
    await categoryTarget.addTargetButton.press("Enter");
    await expect(categoryTarget.categorySelect).toBeFocused();
  });

  test("cash-planning inputs explain system date and decimal formats", async ({ window }) => {
    await window.getByText("Plan ahead", { exact: true }).click();
    const spendableForm = window.getByRole("form", { name: "Spendable cash estimate inputs" });
    const nextIncomeDate = spendableForm.getByLabel("Next income date");
    const reserve = spendableForm.getByLabel("Reserve (NOK)");
    await expect(nextIncomeDate).toHaveAttribute("lang", "nb-NO");
    await expect(reserve).toHaveAttribute("lang", "nb-NO");
    await expect(spendableForm).toContainText(
      /date field follows your system order; enter amounts using the decimal separator shown \(1 234,50 or 1234\.50\).*norwegian nok formatting/i
    );

    const scenarioForm = window.getByRole("form", { name: "Scenario assumption inputs" });
    await expect(scenarioForm.getByLabel("Scenario amount")).toHaveAttribute("lang", "nb-NO");
    await expect(scenarioForm.getByLabel("Scenario start date")).toHaveAttribute("lang", "nb-NO");
    await expect(scenarioForm).toContainText(
      /date field follows your system order; enter amounts using the decimal separator shown \(1 234,50 or 1234\.50\).*norwegian nok formatting/i
    );
  });

  test("commitment dates explain their different schedule roles and disclose the optional end date", async ({
    window,
  }) => {
    await window.getByText("Plan ahead", { exact: true }).click();
    const form = window.getByRole("form", { name: "Recurring commitment form" });
    const scheduleDates = form.getByRole("group", { name: "Schedule dates" });
    await expect(scheduleDates).toContainText(
      /date the first bill is expected.*it can differ from when the commitment becomes active.*date field follows your system order/i
    );
    await expect(scheduleDates.getByLabel("First due date")).toHaveAttribute("lang", "nb-NO");
    await expect(scheduleDates.getByLabel("Active from")).toHaveAttribute("lang", "nb-NO");

    const endDateDisclosure = form.getByText("Set an end date (optional)", { exact: true });
    const activeUntil = form.getByLabel("Active until (optional)");
    await expect(endDateDisclosure).toBeVisible();
    await expect(activeUntil).toBeHidden();
    await endDateDisclosure.click();
    await expect(activeUntil).toBeVisible();
  });

  test("editing a commitment with an end date opens that optional field", async ({ window }) => {
    await window.getByText("Plan ahead", { exact: true }).click();
    const form = window.getByRole("form", { name: "Recurring commitment form" });
    await form.getByLabel("Commitment description").fill("Synthetic end-dated commitment");
    await form.getByLabel("Commitment amount or estimate").fill("129,00");
    await form.getByText("Set an end date (optional)", { exact: true }).click();
    await form.getByLabel("Active until (optional)").fill("2099-12-31");
    await form.getByRole("button", { name: "Save as suggestion" }).click();

    const commitment = window.getByRole("group", {
      name: "Commitment Synthetic end-dated commitment",
    });
    await expect(commitment).toContainText("Suggested");
    await commitment.getByRole("button", { name: "Edit commitment" }).click();

    const activeUntil = form.getByLabel("Active until (optional)");
    await expect(activeUntil).toBeVisible();
    await expect(activeUntil).toHaveValue("2099-12-31");
  });

  test("cashflow baseline detail is available on demand", async ({ dashboard, window }) => {
    await window.getByText("Plan ahead", { exact: true }).click();
    const baselineExplanation = dashboard.cashflowScenarioSection.getByText(
      "How the baseline is calculated",
      { exact: true }
    );
    const detail = dashboard.cashflowScenarioSection.getByText(
      /confirmed commitments with future occurrences are included in both paths/i
    );
    await expect(baselineExplanation).toBeVisible();
    await expect(detail).toBeHidden();
    await baselineExplanation.click();
    await expect(detail).toBeVisible();
  });

  test("cash planning grid follows DOM order at desktop and intermediate widths", async ({
    dashboard,
    electronApp,
    window,
  }) => {
    const visuallyPrecedes = (
      first: { x: number; y: number },
      second: { x: number; y: number }
    ): boolean => first.y < second.y || (Math.abs(first.y - second.y) < 1 && first.x < second.x);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    const categoryAtDesktop = await dashboard.categoryBreakdownSection.boundingBox();
    const targetAtDesktop = await dashboard.targetVsActualSection.boundingBox();
    expect(categoryAtDesktop).not.toBeNull();
    expect(targetAtDesktop).not.toBeNull();
    expect(visuallyPrecedes(categoryAtDesktop!, targetAtDesktop!)).toBe(true);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(934, 768);
    });
    await window.getByText("Manage category targets", { exact: true }).click();
    await window.getByText("Plan ahead", { exact: true }).click();
    const targetEntryAtIntermediate = await dashboard.categoryTargetEntrySection.boundingBox();
    const forecastAtIntermediate = await window.getByRole("region", { name: "Forecast" }).boundingBox();
    expect(targetEntryAtIntermediate).not.toBeNull();
    expect(forecastAtIntermediate).not.toBeNull();
    expect(visuallyPrecedes(targetEntryAtIntermediate!, forecastAtIntermediate!)).toBe(true);
  });

  test("dashboard section headings remain distinct from their nested headings", async ({
    dashboard,
    electronApp,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(934, 768);
    });

    const categoryHeading = dashboard.categoryBreakdownHeading;
    const spendingHeading = dashboard.categoryBreakdownSection.getByRole("heading", {
      name: "Spending by category",
      exact: true,
    });
    const categoryHeadingSize = await categoryHeading.evaluate((element) =>
      Number.parseFloat(window.getComputedStyle(element).fontSize)
    );
    const spendingHeadingSize = await spendingHeading.evaluate((element) =>
      Number.parseFloat(window.getComputedStyle(element).fontSize)
    );

    expect(categoryHeadingSize).toBeGreaterThanOrEqual(spendingHeadingSize * 1.25);
  });

  test("category breakdown uses registered category display names", async ({ dashboard, window }) => {
    await expect(dashboard.categoryBreakdownSection).toContainText("Salary / wages");
    await expect(dashboard.categoryBreakdownSection).toContainText("Groceries & food");
    await expect(dashboard.categoryBreakdownSection).not.toContainText("salary");
    await expect(dashboard.targetVsActualSection).toContainText("Salary / wages");
    await window.getByText("Manage category targets", { exact: true }).click();
    await expect(dashboard.categoryTargetEntrySection).toContainText("Groceries & food");
    await expect(dashboard.targetVsActualSection).toContainText("Groceries & food");
  });

  test("category breakdown separates spending from money-in categories", async ({ dashboard }) => {
    await expect(dashboard.inflowCategories).toContainText("Salary / wages");
    await expect(dashboard.spendingCategories).toContainText("Groceries & food");
    await expect(dashboard.spendingCategories).not.toContainText("Salary / wages");
  });

  test("Scenario 5: monthly attention status and totals fit the review viewport", async ({
    dashboard,
    electronApp,
    window,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });

    await expect(dashboard.monthlyAttention).toContainText("No category reviews or over-target categories this month.");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();

    const totalsPrecedeAttention = await dashboard.monthlyTotalsSection.evaluate((totals) => {
      const attention = document.querySelector('[aria-label="Monthly attention"]');
      return attention !== null &&
        (totals.compareDocumentPosition(attention) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(totalsPrecedeAttention).toBe(true);

    const attentionBottom = await dashboard.monthlyAttention.evaluate((element) =>
      element.getBoundingClientRect().bottom
    );
    const totalsBottom = await dashboard.monthlyTotalsSection.evaluate((element) =>
      element.getBoundingClientRect().bottom
    );
    const viewportHeight = await window.evaluate(() => document.documentElement.clientHeight);

    expect(attentionBottom).toBeLessThanOrEqual(viewportHeight);
    expect(totalsBottom).toBeLessThanOrEqual(viewportHeight);
  });

  test("startup-size review keeps long totals and attention actions within their columns", async ({
    dashboard,
    electronApp,
    window,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 800);
    });
    await dashboard.selectMonth("2026-04");
    await expect(dashboard.overTargetLink).toHaveText("Review 1 category over target");
    await expect(dashboard.reviewQueueAction).toBeVisible();

    const longNokTotal = await window.evaluate(() => new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: "NOK",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(12_345_678_901.23));
    await dashboard.incomeValue.evaluate((element, value) => { element.textContent = value; }, longNokTotal);
    await dashboard.expenseValue.evaluate((element, value) => { element.textContent = value; }, longNokTotal);
    await dashboard.netValue.evaluate((element, value) => { element.textContent = value; }, longNokTotal);

    const overflowingTotalLabels = await dashboard.monthlyTotalsSection.locator(".monthly-total dd").evaluateAll((values) =>
      values
        .filter((value) => value.scrollWidth > value.clientWidth + 1)
        .map((value) => value.getAttribute("aria-label"))
    );
    const overflowingAttentionItems = await dashboard.monthlyAttention.locator(".monthly-attention-item").evaluateAll((items) =>
      items
        .filter((item) => item.scrollWidth > item.clientWidth + 1)
        .map((item) => item.textContent?.trim() ?? "")
    );

    expect(overflowingTotalLabels).toEqual([]);
    expect(overflowingAttentionItems).toEqual([]);
  });

  test("compact Target vs Actual keeps labelled amounts in view and preserves column headers", async ({
    dashboard,
    electronApp,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    const headers = dashboard.targetVsActualSection.getByRole("columnheader");
    await expect(headers).toHaveCount(4);
    for (const header of await headers.all()) {
      await expect(header).toHaveAttribute("scope", "col");
    }

    const scrollState = await dashboard.targetVsActualSection.evaluate((section) => ({
      clientWidth: section.clientWidth,
      scrollWidth: section.scrollWidth,
      scrollbarHeight: getComputedStyle(section, "::-webkit-scrollbar").height,
    }));
    expect(scrollState.scrollWidth).toBeLessThanOrEqual(scrollState.clientWidth);
    expect(scrollState.scrollbarHeight).toBe("10px");
    const sectionBounds = await dashboard.targetVsActualSection.boundingBox();
    if (sectionBounds === null) throw new Error("The monthly comparison must be visible.");
    const rows = dashboard.targetVsActualSection.locator("tbody tr");
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) {
      await expect(row.locator("td")).toHaveCount(4);
      for (const label of ["Category", "Target", "Actual", "Over/under target"]) {
        const cell = row.locator(`td[data-label="${label}"]`);
        await expect(cell).toBeVisible();
        const bounds = await cell.boundingBox();
        if (bounds === null) throw new Error(`${label} must be visible.`);
        expect(bounds.x).toBeGreaterThanOrEqual(sectionBounds.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(sectionBounds.x + sectionBounds.width);
      }
    }
  });

  test("Scenario 6: target overruns link to their monthly details", async ({ dashboard }) => {
    await dashboard.selectMonth("2026-04");

    await expect(dashboard.overTargetLink).toHaveText("Review 1 category over target");
    await expect(dashboard.overTargetLink).toHaveAttribute("href", "#target-vs-actual");
  });

  test("Regression: failed month changes preserve review data and explain retry", async ({
    dashboard,
    electronApp,
  }) => {
    const originalIncome = await dashboard.incomeValue.textContent();
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"] = "1";
    });

    await dashboard.selectMonth("2026-04");

    await expect(dashboard.monthChangeError).toContainText(
      "Your current review remains visible. Select a month again to retry."
    );
    await expect(dashboard.monthSelector).toHaveValue("2026-05");
    await expect(dashboard.incomeValue).toHaveText(originalIncome ?? "");

    await electronApp.evaluate(() => {
      delete process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"];
    });
    await dashboard.selectMonth("2026-04");
    await expect(dashboard.monthSelector).toHaveValue("2026-04");
    await expect(dashboard.incomeValue).toContainText("510");
  });

  test("reporting period navigation stays disabled while the selected report updates", async ({ dashboard, electronApp, window }) => {
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_SLOW_DASHBOARD_MONTH"] = "2026-04";
      process.env["BUDGET_TEST_DASHBOARD_VIEW_DELAY_MS"] = "250";
    });

    await dashboard.openPeriodControls();
    await dashboard.monthSelector.fill("2026-04");
    const updatingStatus = window.getByRole("status").filter({ hasText: "Updating reporting period..." });
    await expect(updatingStatus).toBeVisible();
    await expect(dashboard.monthSelector).toBeDisabled();

    await expect(updatingStatus).toBeHidden();
    await expect(dashboard.monthSelector).toBeEnabled();
    await expect(dashboard.monthSelector).toHaveValue("2026-04");
    await expect(dashboard.incomeValue).toContainText("510");

    await dashboard.selectMonth("2026-05");
    await expect(dashboard.monthSelector).toHaveValue("2026-05", { timeout: 10_000 });
    await expect(dashboard.incomeValue).toContainText("540");
  });

  test("@visual Visual: desktop dashboard preserves the monthly review layout", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1100);
    });
    await expect(window.getByRole("region", { name: "Account coverage status" }))
      .toContainText("No statement periods recorded");

    await expect(window).toHaveScreenshot("dashboard-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  });

  test("compact review action buttons meet 44px touch targets", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    await expect(window.getByRole("button").first()).toBeVisible();
    const undersizedButtons = await window.getByRole("button").evaluateAll((buttons) =>
      buttons
        .map((button) => ({
          label: button.textContent?.trim() ?? "",
          height: button.getBoundingClientRect().height,
        }))
        .filter((button) => button.height < 44)
    );

    expect(undersizedButtons).toEqual([]);
  });

  test("compact target-versus-actual rows keep the delta visible", async ({ window }) => {
    await window.setViewportSize({ width: 390, height: 844 });
    const targetVsActual = window.getByRole("region", { name: "Target vs Actual" });
    const delta = targetVsActual.locator('td[data-label="Over/under target"]').first();
    await expect(delta).toBeVisible();

    const deltaBounds = await delta.boundingBox();
    if (deltaBounds === null) {
      throw new Error("A compact target-versus-actual delta must remain measurable.");
    }
    expect(deltaBounds.x + deltaBounds.width).toBeLessThanOrEqual(390);
  });

  test("compact review presents category spending before budget details", async ({ dashboard, electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    await expect(dashboard.spendingCategories).toBeVisible();
    const attentionBounds = await dashboard.monthlyAttention.boundingBox();
    const categoryBounds = await dashboard.spendingCategories.boundingBox();
    const targetVsActualBounds = await dashboard.targetVsActualSection.boundingBox();
    const targetBounds = await window.getByText("Manage category targets", { exact: true }).boundingBox();
    if (
      attentionBounds === null ||
      categoryBounds === null ||
      targetVsActualBounds === null ||
      targetBounds === null
    ) {
      throw new Error("Monthly checks, category spending and budget details must be measurable.");
    }

    expect(attentionBounds.y).toBeLessThan(categoryBounds.y);
    expect(categoryBounds.y).toBeLessThan(targetVsActualBounds.y);
    expect(categoryBounds.y).toBeLessThan(targetBounds.y);
  });

  test("narrow review keeps spending and budget sections full width without horizontal overflow", async ({
    window,
    electronApp,
  }) => {
    for (const width of [820, 390]) {
      await electronApp.evaluate(({ BrowserWindow }, contentWidth) => {
        const browserWindow = BrowserWindow.getAllWindows()[0];
        if (browserWindow === undefined) throw new Error("The monthly review window must exist.");
        browserWindow.setContentSize(contentWidth, 1100);
      }, width);
      await expect.poll(() => window.evaluate(() => innerWidth)).toBe(width);

      const spending = window.getByRole("region", { name: "Category Breakdown", exact: true });
      const budget = window.getByRole("region", { name: "Target vs Actual", exact: true });
      await expect(spending).toBeVisible();
      await expect(budget).toBeVisible();
      const gridBounds = await window.locator(".review-grid").boundingBox();
      if (gridBounds === null) throw new Error("The monthly review must be measurable.");

      for (const section of [spending, budget]) {
        const bounds = await section.boundingBox();
        if (bounds === null) throw new Error("Monthly sections must be measurable.");
        expect(Math.abs(bounds.width - gridBounds.width)).toBeLessThanOrEqual(1);
        await expect.poll(() => section.evaluate((element) =>
          element.scrollWidth <= element.clientWidth + 1
        )).toBe(true);
      }
      const spendingBounds = await spending.boundingBox();
      const budgetBounds = await budget.boundingBox();
      if (spendingBounds === null || budgetBounds === null) {
        throw new Error("Spending and budget sections must be measurable.");
      }
      expect(budgetBounds.y).toBeGreaterThanOrEqual(spendingBounds.y + spendingBounds.height);
      await expect.poll(() => window.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )).toBe(true);
    }
  });

  test("monthly review signals follow a single attention reading path", async ({ window }) => {
    await window.setViewportSize({ width: 1440, height: 1100 });
    const attentionItems = window.locator(".monthly-attention-content > .monthly-attention-item");
    await expect(attentionItems).toHaveCount(2);
    const rowPositions = await attentionItems.evaluateAll((items) =>
      [...new Set(items.map((item) => Math.round(item.getBoundingClientRect().top)))]
    );
    expect(rowPositions).toHaveLength(2);
  });

  test("@visual Visual: compact dashboard preserves primary workspace navigation", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });
    await expect(window.getByRole("region", { name: "Account coverage status" }))
      .toContainText("No statement periods recorded");

    const documentWidth = await window.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = await window.evaluate(() => document.documentElement.clientWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewportWidth);

    await expect(window).toHaveScreenshot("dashboard-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: MOBILE_SCREENSHOT_DIFF_RATIO,
    });
  });

  test("compact shell keeps the household descriptor readable", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    const descriptor = window.getByText("Local household ledger", { exact: true });
    await expect(descriptor).toBeVisible();
    const fontSize = await descriptor.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    );
    expect(fontSize).toBeGreaterThanOrEqual(12);
  });

  test("minimum compact navigation stays within the viewport", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(320, 844);
    });

    const dimensions = await window.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
    const navigationBounds = await window.getByRole("navigation", { name: "Primary" }).boundingBox();
    if (navigationBounds === null) {
      throw new Error("Primary navigation must remain measurable at compact widths.");
    }
    expect(navigationBounds.x + navigationBounds.width).toBeLessThanOrEqual(dimensions.viewportWidth);
  });

  test("compact desktop header keeps import controls inside the viewport", async ({ window, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(681, 900);
    });

    const viewportWidth = await window.evaluate(() => document.documentElement.clientWidth);
    const documentWidth = await window.evaluate(() => document.documentElement.scrollWidth);
    const importAction = await window.getByRole("button", { name: "Import statement" }).boundingBox();
    if (importAction === null) {
      throw new Error("The statement import action must remain measurable at compact desktop widths.");
    }

    expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
    expect(importAction.x + importAction.width).toBeLessThanOrEqual(viewportWidth);
  });
});
