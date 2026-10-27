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
    this.propertyLabelInput = this.section.getByLabel("Property label");
    this.addPropertyButton = this.section.getByRole("button", { name: "Add property", exact: true });
    this.errorMessage = this.section.getByRole("alert");
  }

  property(label: string): Locator {
    return this.section.getByRole("region", { name: `Property ${label}`, exact: true });
  }

  effectiveDateInput(label: string): Locator {
    return this.property(label).getByLabel("Effective date");
  }

  amountInput(label: string): Locator {
    return this.property(label).getByLabel("Amount");
  }

  currencyCodeInput(label: string): Locator {
    return this.property(label).getByLabel("Currency code");
  }

  addValuationButton(label: string): Locator {
    return this.property(label).getByRole("button", { name: "Add valuation", exact: true });
  }

  valuationHistory(label: string): Locator {
    return this.property(label).getByRole("table", { name: "Valuation history", exact: true });
  }

  valuationRow(label: string, effectiveDate: string): Locator {
    return this.valuationHistory(label).getByRole("row").filter({ hasText: effectiveDate });
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
