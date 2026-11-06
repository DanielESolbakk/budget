import { type Page } from "@playwright/test";

export class OnboardingPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get heading() {
    return this.page.getByRole("heading", { name: "Set up your household", level: 2 });
  }

  get householdNameInput() {
    return this.page.getByLabel("Household name");
  }

  get accountNameInput() {
    return this.page.getByLabel("Account name");
  }

  get currencyCodeInput() {
    return this.page.getByLabel("Currency code");
  }

  get createLedgerButton() {
    return this.page.getByRole("button", { name: "Create local ledger" });
  }

  async submit(householdName: string, accountName: string, currencyCode: string): Promise<void> {
    await this.householdNameInput.fill(householdName);
    await this.accountNameInput.fill(accountName);
    await this.currencyCodeInput.fill(currencyCode);
    await this.createLedgerButton.click();
  }
}
