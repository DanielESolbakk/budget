import type { Page } from "@playwright/test";

export class LedgerPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get section() {
    return this.page.getByRole("region", { name: "Ledger", exact: true });
  }

  get filterForm() {
    return this.section.getByRole("form", { name: "Ledger filters" });
  }

  async openMoreFilters(): Promise<void> {
    if (await this.moreFiltersSummary.getAttribute("aria-expanded") !== "true") {
      await this.moreFiltersSummary.click();
    }
  }

  get moreFiltersSummary() {
    return this.filterForm.getByRole("button", { name: /^More filters/ });
  }

  get moreFiltersDisclosure() {
    return this.filterForm.locator("#ledger-advanced-filters");
  }

  get table() {
    return this.section.getByRole("table", { name: "Ledger transactions" });
  }

  get activeFilters() {
    return this.section.getByRole("list", { name: "Active ledger filters" });
  }

  get activeFiltersHeading() {
    return this.section.getByText("Active filters", { exact: true });
  }

  get amountFromInput() {
    return this.filterForm.getByRole("textbox", { name: "Minimum amount (NOK)" });
  }

  get amountToInput() {
    return this.filterForm.getByRole("textbox", { name: "Maximum amount (NOK)" });
  }

  get amountFormatHint() {
    return this.filterForm.getByText("Enter kroner, for example 100,50.", { exact: true });
  }

  get savedViewNameInput() {
    return this.section.getByRole("textbox", { name: "Saved view name" });
  }

  get saveViewButton() {
    return this.section.getByRole("button", { name: "Save current filters" });
  }

  get savedViews() {
    return this.section.getByRole("region", { name: "Saved ledger views" });
  }

  get savedViewsSummary() {
    return this.savedViews.getByText(/^Saved views \(/);
  }

  async openSavedViews(): Promise<void> {
    await this.savedViewsSummary.click();
  }

  get merchantInput() {
    return this.filterForm.getByRole("textbox", { name: "Filter merchant" });
  }

  get accountInput() {
    return this.filterForm.getByRole("combobox", { name: "Filter account" });
  }

  get fromDateInput() {
    return this.filterForm.getByRole("textbox", { name: "Filter from date" });
  }

  get toDateInput() {
    return this.filterForm.getByRole("textbox", { name: "Filter to date" });
  }

  get categoryInput() {
    return this.filterForm.getByRole("combobox", { name: "Filter category" });
  }

  get clearFiltersButton() {
    return this.filterForm.getByRole("button", { name: "Clear all filters" });
  }

  get amountRangeError() {
    return this.section.getByRole("alert", { name: "Amount range error" });
  }

  get applyButton() {
    return this.filterForm.getByRole("button", { name: "Apply ledger filters" });
  }

  get resultStatus() {
    return this.section.getByRole("status").filter({ hasText: "ledger transactions" }).first();
  }

  get reviewUncategorizedButton() {
    return this.section.getByRole("button", { name: /^Review uncategorized/ });
  }

  get reviewUncategorizedScope() {
    return this.section.getByText("Includes all transactions, regardless of ledger filters.", { exact: true });
  }

  get loadingStatus() {
    return this.section.getByRole("status").filter({ hasText: "Loading ledger transactions..." });
  }

  get updatingStatus() {
    return this.section.getByRole("status").filter({ hasText: "Updating ledger for selected filters..." });
  }

  get errorAlert() {
    return this.section.getByRole("alert");
  }

  get retryButton() {
    return this.section.getByRole("button", { name: "Retry ledger" });
  }

  transaction(merchantRaw: string) {
    return this.table.getByRole("row", { name: `Ledger transaction ${merchantRaw}` }).first();
  }

  transactionsFor(merchantRaw: string) {
    return this.table.getByRole("row", { name: `Ledger transaction ${merchantRaw}` });
  }

  async removeFilter(filterName: string): Promise<void> {
    await this.activeFilters.getByRole("button", { name: new RegExp(`Remove ${filterName} filter`, "i") }).click();
  }

  async sortByMerchant(): Promise<void> {
    await this.table.getByRole("button", { name: "Sort by merchant" }).click();
  }

  quickFilter(name: string) {
    return this.section.getByRole("button", { name: `Quick filter ${name}` });
  }

  async applySavedView(name: string): Promise<void> {
    await this.savedViewApplyButton(name).click();
  }

  savedViewApplyButton(name: string) {
    return this.savedViews.getByRole("button", { name: `Apply saved view ${name}` });
  }

  async deleteSavedView(name: string): Promise<void> {
    await this.savedViews.getByRole("button", { name: `Delete saved view ${name}` }).click();
  }

}
