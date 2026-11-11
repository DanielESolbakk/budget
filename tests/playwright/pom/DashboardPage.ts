import { type Locator, type Page } from "@playwright/test";

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
    return this.monthlyTotalsSection.getByLabel("Monthly net", { exact: true });
  }

  /** The landmark region wrapping the category breakdown (aria-label="Category Breakdown"). */
  get categoryBreakdownSection() {
    return this.page.getByRole("region", { name: "Category Breakdown" });
  }

  get targetVsActualSection() {
    return this.page.getByRole("region", { name: "Target vs Actual" });
  }

  /** The "Category Breakdown" heading inside the section. */
  get categoryBreakdownHeading() {
    return this.page.getByRole("heading", { name: "Category Breakdown", level: 2 });
  }

  get inflowCategories() {
    return this.categoryBreakdownSection.getByRole("group", { name: "Money in by category" });
  }

  get spendingCategories() {
    return this.categoryBreakdownSection.getByRole("group", { name: "Spending by category" });
  }

  /** All category entry list items inside the category breakdown section. */
  get categoryEntries() {
    return this.categoryBreakdownSection.getByRole("listitem");
  }

  get monthlyComparison() {
    return this.monthlyTotalsSection.getByRole("group", { name: "Monthly comparison" });
  }

  get spendableCashSection() {
    return this.page.getByRole("region", { name: "Spendable cash until income" });
  }

  get cashflowScenarioSection() {
    return this.page.getByRole("region", { name: "Cashflow scenarios" });
  }

  get categoryTargetEntrySection() {
    return this.page.getByRole("region", { name: "Category Target Entry" });
  }

  /** The native month input. */
  get monthSelector() {
    return this.page.getByLabel("Select month", { exact: true });
  }

  async openPeriodControls(): Promise<void> {
    if (!await this.monthSelector.isVisible()) {
      await this.monthlyTotalsSection.getByText("Change period", { exact: true }).click();
    }
  }

  async selectMonth(yearMonth: string): Promise<void> {
    await this.openPeriodControls();
    await this.monthSelector.fill(yearMonth);
    await this.page.getByRole("region", { name: "Review workspace" })
      .and(this.page.locator('[aria-busy="false"]'))
      .waitFor({ state: "visible" });
  }

  get zeroActivityStatus() {
    return this.page.getByRole("status", { name: "Monthly activity" });
  }

  get monthlyAttention() {
    return this.page.getByRole("complementary", { name: "Monthly attention" });
  }

  get reviewQueueAction() {
    return this.monthlyAttention.getByRole("button", { name: "Review categories" });
  }

  get overTargetLink() {
    return this.monthlyAttention.getByRole("link", { name: /over target/ });
  }

  get monthChangeError() {
    return this.page.getByRole("alert").filter({ hasText: "Unable to change month." });
  }

  monthlyTotal(label: "Income" | "Expenses" | "Monthly net"): Locator {
    return this.monthlyTotalsSection.getByRole("group", { name: `${label} total` });
  }

  /** Select the preceding calendar month and return its value. */
  async selectDifferentMonth(currentMonth: string): Promise<string> {
    const date = new Date(`${currentMonth}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 1);
    const previousMonth = date.toISOString().slice(0, 7);
    await this.selectMonth(previousMonth);
    return previousMonth;
  }
}
