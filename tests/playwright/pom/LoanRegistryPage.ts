import type { Locator, Page } from "@playwright/test";

export interface LoanInput {
  label: string;
  principal: string;
  annualInterestRate: string;
  termYears: string;
  paymentAmount: string;
  paymentFrequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  currencyCode: string;
  propertyLabel?: string;
}

export interface LoanBalanceInput {
  effectiveDate: string;
  amount: string;
}

export class LoanRegistryPage {
  readonly section: Locator;
  readonly createForm: Locator;
  readonly addLoanButton: Locator;
  readonly labelInput: Locator;
  readonly principalInput: Locator;
  readonly annualInterestRateInput: Locator;
  readonly termYearsInput: Locator;
  readonly paymentAmountInput: Locator;
  readonly paymentFrequencySelect: Locator;
  readonly currencyCodeInput: Locator;
  readonly propertySelect: Locator;
  readonly createButton: Locator;

  constructor(page: Page) {
    this.section = page.getByRole("region", { name: "Loan registry", exact: true });
    this.createForm = this.section.getByRole("form", { name: "Add loan", exact: true });
    this.addLoanButton = this.section.getByRole("button", { name: "Add loan", exact: true });
    this.labelInput = this.createForm.getByLabel("Loan label", { exact: true });
    this.principalInput = this.createForm.getByLabel("Principal amount", { exact: true });
    this.annualInterestRateInput = this.createForm.getByLabel("Annual interest rate (%)", { exact: true });
    this.termYearsInput = this.createForm.getByLabel("Term (years)", { exact: true });
    this.paymentAmountInput = this.createForm.getByLabel("Regular payment amount", { exact: true });
    this.paymentFrequencySelect = this.createForm.getByRole("combobox", {
      name: "Payment frequency",
      exact: true,
    });
    this.currencyCodeInput = this.createForm.getByLabel("Currency code", { exact: true });
    this.propertySelect = this.createForm.getByRole("combobox", {
      name: "Property (optional)",
      exact: true,
    });
    this.createButton = this.createForm.getByRole("button", { name: "Save loan", exact: true });
  }

  get loanNavigation() {
    return this.section.getByRole("navigation", { name: "Loan records", exact: true });
  }

  get backToLoanListButton() {
    return this.section.getByRole("button", { name: "Back to loans", exact: true });
  }

  async selectLoan(label: string): Promise<void> {
    if (await this.loan(label).isVisible()) return;
    if (await this.backToLoanListButton.isVisible()) {
      await this.backToLoanListButton.click();
    }
    await this.loanNavigation
      .getByRole("button", { name: `Select loan ${label}`, exact: true })
      .click();
  }

  loan(label: string): Locator {
    return this.section.getByRole("region", { name: `Loan ${label}`, exact: true });
  }

  balanceForm(label: string): Locator {
    return this.loan(label).getByRole("form", { name: `Add balance for ${label}`, exact: true });
  }

  balanceDateInput(label: string): Locator {
    return this.balanceForm(label).getByLabel("Effective date", { exact: true });
  }

  balanceAmountInput(label: string): Locator {
    return this.balanceForm(label).getByLabel("Actual balance on this date", { exact: true });
  }

  balanceHistory(label: string): Locator {
    return this.loan(label).getByRole("table", { name: "Balance history", exact: true });
  }

  loanDetails(label: string): Locator {
    return this.loan(label).locator("details.loan-record-details");
  }

  async expandLoanDetails(label: string): Promise<void> {
    await this.selectLoan(label);
    const details = this.loanDetails(label);
    if (await details.getAttribute("open") === null) {
      await details.locator("summary").click();
    }
  }

  fieldError(field: string): Locator {
    return this.createForm.locator(`#loan-create-error-${field}`);
  }

  balanceHistoryGuidance(): Locator {
    return this.section.getByText(/Each entry stays in history/i);
  }

  async openCreateForm(): Promise<void> {
    if (!(await this.createForm.isVisible())) {
      await this.addLoanButton.click();
    }
  }

  balanceRow(label: string, effectiveDate: string): Locator {
    return this.balanceHistory(label)
      .getByRole("row")
      .filter({ hasText: effectiveDate });
  }

  async addLoan(input: LoanInput): Promise<void> {
    await this.openCreateForm();
    await this.labelInput.fill(input.label);
    await this.principalInput.fill(input.principal);
    await this.annualInterestRateInput.fill(input.annualInterestRate);
    await this.termYearsInput.fill(input.termYears);
    await this.paymentAmountInput.fill(input.paymentAmount);
    await this.paymentFrequencySelect.selectOption(input.paymentFrequency);
    await this.currencyCodeInput.fill(input.currencyCode);
    if (input.propertyLabel !== undefined) {
      await this.propertySelect.selectOption({ label: input.propertyLabel });
    }
    await this.createButton.click();
  }

  async addBalance(label: string, input: LoanBalanceInput): Promise<void> {
    await this.selectLoan(label);
    const form = this.balanceForm(label);
    await this.balanceDateInput(label).fill(input.effectiveDate);
    await this.balanceAmountInput(label).fill(input.amount);
    await form.getByRole("button", { name: "Add balance", exact: true }).click();
  }
}
