import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Page Object Model for the monthly dashboard sections of the Budget Planner.
 *
 * Encapsulates locators for the monthly totals section, category breakdown
 * section, and month selector rendered by App.tsx + MonthlyTotalsSection +
 * CategoryBreakdownSection.
 *
 * Assertions belong in specs — this object exposes locators only.
 */
export class DashboardPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The landmark region wrapping monthly totals (aria-label="Monthly Totals"). */
  get monthlyTotalsSection() {
    return this.page.getByRole("region", { name: "Monthly Totals" });
  }

  /** The "Monthly Totals" heading inside the section. */
  get monthlyTotalsHeading() {
    return this.page.getByRole("heading", { name: "Monthly Totals", level: 2 });
  }

  /** The income definition value inside the monthly totals section. */
  get incomeValue() {
    return this.monthlyTotalsSection.getByLabel("Income", { exact: true });
  }

  /** The expenses definition value inside the monthly totals section. */
  get expenseValue() {
    return this.monthlyTotalsSection.getByLabel("Expenses", { exact: true });
  }

  /** The net definition value inside the monthly totals section. */
  get netValue() {
    return this.monthlyTotalsSection.getByLabel("Net", { exact: true });
  }

  /** The landmark region wrapping the category breakdown (aria-label="Category Breakdown"). */
  get categoryBreakdownSection() {
    return this.page.getByRole("region", { name: "Category Breakdown" });
  }

  /** The "Category Breakdown" heading inside the section. */
  get categoryBreakdownHeading() {
    return this.page.getByRole("heading", { name: "Category Breakdown", level: 2 });
  }

  /** All category entry list items inside the category breakdown section. */
  get categoryEntries() {
    return this.categoryBreakdownSection.getByRole("listitem");
  }

  /** The month selector combobox. */
  get monthSelector() {
    return this.page.getByRole("combobox", { name: "Select month" });
  }

  get monthFrameButtons() {
    return this.page.getByRole("button", { name: /^Select .+ for review$/ });
  }

  monthFrame(yearMonth: string): Locator {
    return this.monthFrameButtons.filter({ hasText: yearMonth });
  }

  monthlyTotal(label: "Income" | "Expenses" | "Net"): Locator {
    return this.monthlyTotalsSection.getByRole("group", { name: `${label} total` });
  }

  /** Select a different month option than the current one and return the selected month value. */
  async selectDifferentMonth(currentMonth: string): Promise<string> {
    const options = await this.monthSelector
      .getByRole("option")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    const candidates = options.filter((option) => option !== currentMonth);

    for (const candidate of candidates) {
      await this.monthSelector.selectOption(candidate);
      await expect(this.monthSelector).toHaveValue(candidate);

      try {
        await this.incomeValue.waitFor({ state: "visible", timeout: 1500 });
        await this.categoryEntries.first().waitFor({ state: "visible", timeout: 1500 });
        return candidate;
      } catch {
        // Candidate likely led to an empty/loading branch; try the next one.
      }
    }

    throw new Error("No alternate data-bearing month option found for month-switch scenario.");
  }
}
