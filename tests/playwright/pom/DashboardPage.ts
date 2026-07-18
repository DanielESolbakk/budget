import type { Page } from "@playwright/test";

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
    return this.monthlyTotalsSection.locator('[aria-label="Income"]');
  }

  /** The expenses definition value inside the monthly totals section. */
  get expenseValue() {
    return this.monthlyTotalsSection.locator('[aria-label="Expenses"]');
  }

  /** The net definition value inside the monthly totals section. */
  get netValue() {
    return this.monthlyTotalsSection.locator('[aria-label="Net"]');
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
}
