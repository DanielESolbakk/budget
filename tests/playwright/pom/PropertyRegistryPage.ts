import type { Locator, Page } from "@playwright/test";

export interface PropertyValuationInput {
  effectiveDate: string;
  amount: string;
  currencyCode: string;
}

export class PropertyRegistryPage {
  readonly section: Locator;
  readonly propertyCreateForm: Locator;
  readonly propertyLabelInput: Locator;
  readonly addPropertyAction: Locator;
  readonly addPropertyButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.section = page.getByRole("region", { name: "Property registry", exact: true });
    this.propertyCreateForm = this.section.getByRole("form", { name: "Add property", exact: true });
    this.propertyLabelInput = this.propertyCreateForm.getByLabel("Property label", { exact: true });
    this.addPropertyAction = this.section.getByRole("button", { name: "Add property", exact: true });
    this.addPropertyButton = this.propertyCreateForm
      .getByRole("button", { name: "Save property", exact: true });
    this.errorMessage = this.section.getByRole("alert");
  }

  property(label: string): Locator {
    return this.section.getByRole("region", { name: `Property ${label}`, exact: true });
  }

  get propertyNavigation() {
    return this.section.getByRole("navigation", { name: "Property records", exact: true });
  }

  get backToPropertyListButton() {
    return this.section.getByRole("button", { name: "Back to properties", exact: true });
  }

  async selectProperty(label: string): Promise<void> {
    if (await this.property(label).isVisible()) return;
    if (await this.backToPropertyListButton.isVisible()) {
      await this.backToPropertyListButton.click();
    }
    await this.propertyNavigation
      .getByRole("button", { name: `Select property ${label}`, exact: true })
      .click();
  }

  propertyError(label: string): Locator {
    return this.property(label).getByRole("alert");
  }

  valuationForm(label: string): Locator {
    return this.property(label)
      .getByRole("form", { name: `Add valuation for ${label}`, exact: true });
  }

  effectiveDateInput(label: string): Locator {
    return this.valuationForm(label).getByLabel("Effective date", { exact: true });
  }

  amountInput(label: string): Locator {
    return this.valuationForm(label).getByLabel("Amount", { exact: true });
  }

  currencyCodeInput(label: string): Locator {
    return this.valuationForm(label).getByLabel("Currency code", { exact: true });
  }

  addValuationButton(label: string): Locator {
    return this.valuationForm(label).getByRole("button", { name: "Save value", exact: true });
  }

  valuationHistory(label: string): Locator {
    return this.property(label).getByRole("table", { name: "Valuation history", exact: true });
  }

  valuationHistoryViewport(label: string): Locator {
    return this.property(label).locator(".property-history-table-wrap");
  }

  valuationRow(label: string, effectiveDate: string, occurrence = 0): Locator {
    return this.valuationHistory(label)
      .getByRole("row")
      .filter({ hasText: effectiveDate })
      .nth(occurrence);
  }

  valuationValueCell(label: string, effectiveDate: string, occurrence = 0): Locator {
    return this.valuationRow(label, effectiveDate, occurrence).getByRole("cell").nth(1);
  }

  correctionToggle(label: string, effectiveDate: string, occurrence = 0): Locator {
    return this.valuationRow(label, effectiveDate, occurrence)
      .getByText("Correct or void", { exact: true });
  }

  correctionForm(label: string, effectiveDate: string, occurrence = 0): Locator {
    return this.valuationRow(label, effectiveDate, occurrence)
      .getByRole("form", { name: "Supersede valuation", exact: true });
  }

  voidValuationButton(label: string, effectiveDate: string, occurrence = 0): Locator {
    return this.valuationRow(label, effectiveDate, occurrence)
      .getByRole("button", { name: "Void valuation", exact: true });
  }

  async changePropertyLabel(label: string, newLabel: string): Promise<void> {
    await this.selectProperty(label);
    const property = this.property(label);
    await property.getByText("Change property label", { exact: true }).click({ timeout: 5000 });
    const form = property.getByRole("form", { name: "Change property label", exact: true });
    await form.getByLabel("New property label").fill(newLabel);
    await form.getByRole("button", { name: "Save property label", exact: true }).click();
  }

  async addProperty(label: string): Promise<void> {
    await this.openCreateForm();
    await this.propertyLabelInput.fill(label);
    await this.addPropertyButton.click();
  }

  async openCreateForm(): Promise<void> {
    if (!(await this.propertyCreateForm.isVisible())) {
      await this.addPropertyAction.click();
    }
  }

  async openValuationForm(label: string): Promise<void> {
    await this.selectProperty(label);
    const form = this.valuationForm(label);
    if (!(await form.isVisible())) {
      await this.property(label).getByRole("button", { name: "Record value", exact: true }).click();
    }
  }

  async addValuation(label: string, input: PropertyValuationInput): Promise<void> {
    await this.openValuationForm(label);
    await this.effectiveDateInput(label).fill(input.effectiveDate);
    await this.amountInput(label).fill(input.amount);
    await this.currencyCodeInput(label).fill(input.currencyCode);
    await this.addValuationButton(label).click();
  }
}
