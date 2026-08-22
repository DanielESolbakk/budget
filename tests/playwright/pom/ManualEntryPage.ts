import { type Page } from "@playwright/test";

export interface ManualEntryValues {
  accountId: string;
  bookedAtIso: string;
  amountMinor: string;
  merchantRaw: string;
  categoryId: string;
}

export class ManualEntryPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get entrySection() {
    return this.page.getByRole("region", { name: "Manual Entry" });
  }

  get entryHeading() {
    return this.entrySection.getByRole("heading", { name: "Add transaction manually", level: 2 });
  }

  get accountInput() {
    return this.entrySection.getByLabel("Account");
  }

  get bookedDateInput() {
    return this.entrySection.getByLabel("Booked date");
  }

  get amountInput() {
    return this.entrySection.getByLabel("Amount (minor units)");
  }

  get merchantInput() {
    return this.entrySection.getByLabel("Description or merchant");
  }

  get categoryInput() {
    return this.entrySection.getByLabel("Manual category ID (optional)");
  }

  get submitButton() {
    return this.entrySection.getByRole("button", { name: "Add transaction" });
  }

  get successStatus() {
    return this.entrySection.getByRole("status");
  }

  get resultAlert() {
    return this.entrySection.getByRole("alert");
  }

  async submitEntry(values: ManualEntryValues): Promise<void> {
    await this.accountInput.selectOption(values.accountId);
    await this.bookedDateInput.fill(values.bookedAtIso);
    await this.amountInput.fill(values.amountMinor);
    await this.merchantInput.fill(values.merchantRaw);
    await this.categoryInput.fill(values.categoryId);
    await this.submitButton.click();
  }
}