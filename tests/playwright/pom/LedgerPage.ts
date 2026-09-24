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

  get merchantInput() {
    return this.filterForm.getByRole("textbox", { name: "Filter merchant" });
  }

  get accountInput() {
    return this.filterForm.getByRole("textbox", { name: "Filter account" });
  }

  get fromDateInput() {
    return this.filterForm.getByRole("textbox", { name: "Filter from date" });
  }

  get toDateInput() {
    return this.filterForm.getByRole("textbox", { name: "Filter to date" });
  }

  get amountInput() {
    return this.filterForm.getByRole("spinbutton", { name: "Filter amount" });
  }

  get categoryInput() {
    return this.filterForm.getByRole("textbox", { name: "Filter category" });
  }

  get applyButton() {
    return this.filterForm.getByRole("button", { name: "Apply ledger filters" });
  }

  get resultStatus() {
    return this.section.getByRole("status");
  }

  transaction(merchantRaw: string) {
    return this.section.getByRole("listitem", { name: `Ledger transaction ${merchantRaw}` }).first();
  }

  transactionsFor(merchantRaw: string) {
    return this.section.getByRole("listitem", { name: `Ledger transaction ${merchantRaw}` });
  }

  async apply(): Promise<void> {
    await this.applyButton.click();
  }
}
