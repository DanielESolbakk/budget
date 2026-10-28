import type { Locator, Page } from "@playwright/test";

export interface PropertyValuationInput {
  effectiveDate: string;
  amount: string;
  currencyCode: string;
}

export class PropertyRegistryPage {
  readonly section: Locator;
  readonly propertyLabelInput: Locator;
  readonly addPropertyButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.section = page.getByRole("region", { name: "Property registry", exact: true });
    const propertyForm = this.section.getByRole("form", { name: "Add property", exact: true });
    this.propertyLabelInput = propertyForm.getByLabel("Property label", { exact: true });
    this.addPropertyButton = propertyForm.getByRole("button", { name: "Add property", exact: true });
    this.errorMessage = this.section.getByRole("alert");
  }

  property(label: string): Locator {
    return this.section.getByRole("region", { name: `Property ${label}`, exact: true });
  }

  propertyError(label: string): Locator {
    return this.property(label).getByRole("alert");
  }

  effectiveDateInput(label: string): Locator {
    return this.property(label)
      .getByRole("form", { name: `Add valuation for ${label}`, exact: true })
      .getByLabel("Effective date", { exact: true });
  }

  amountInput(label: string): Locator {
    return this.property(label)
      .getByRole("form", { name: `Add valuation for ${label}`, exact: true })
      .getByLabel("Amount", { exact: true });
  }

  currencyCodeInput(label: string): Locator {
    return this.property(label)
      .getByRole("form", { name: `Add valuation for ${label}`, exact: true })
      .getByLabel("Currency code", { exact: true });
  }

  addValuationButton(label: string): Locator {
    return this.property(label)
      .getByRole("form", { name: `Add valuation for ${label}`, exact: true })
      .getByRole("button", { name: "Add valuation", exact: true });
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
    const property = this.property(label);
    await property.getByText("Change property label", { exact: true }).click({ timeout: 5000 });
    const form = property.getByRole("form", { name: "Change property label", exact: true });
    await form.getByLabel("New property label").fill(newLabel);
    await form.getByRole("button", { name: "Save property label", exact: true }).click();
  }

  async addProperty(label: string): Promise<void> {
    await this.propertyLabelInput.fill(label);
    await this.addPropertyButton.click();
  }

  async addValuation(label: string, input: PropertyValuationInput): Promise<void> {
    await this.effectiveDateInput(label).fill(input.effectiveDate);
    await this.amountInput(label).fill(input.amount);
    await this.currencyCodeInput(label).fill(input.currencyCode);
    await this.addValuationButton(label).click();
  }
}
