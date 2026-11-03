import type { Locator, Page } from "@playwright/test";

export interface RecurringCommitmentFormData {
  description: string;
  currencyCode: string;
  amount: string;
  isVariable: boolean;
  cadence: "monthly" | "annual";
  firstDueDateIso: string;
  activeFromIso: string;
  activeUntilIso?: string;
}

export class RecurringCommitmentsPage {
  readonly section: Locator;
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.section = page.getByRole("region", {
      name: "Recurring commitments",
      exact: true,
    });
  }

  private commitment(description: string): Locator {
    return this.section.getByRole("group", {
      name: `Commitment ${description}`,
      exact: true,
    });
  }

  private occurrence(description: string, dueDateIso: string): Locator {
    return this.section.getByRole("group", {
      name: `Occurrence ${description} due ${dueDateIso}`,
      exact: true,
    });
  }

  async refresh(): Promise<void> {
    await this.section.getByRole("button", { name: "Refresh commitments" }).click();
  }

  async createSuggestion(input: RecurringCommitmentFormData): Promise<void> {
    const form = this.section.getByRole("form", {
      name: "Recurring commitment form",
      exact: true,
    });
    await form.getByLabel("Commitment description").fill(input.description);
    await form.getByLabel("Commitment currency").fill(input.currencyCode);
    await form.getByLabel("Commitment amount or estimate").fill(input.amount);
    if (input.isVariable) {
      await form.getByLabel("Variable amount").check();
    }
    await form.getByLabel("Recurring cadence").selectOption(input.cadence);
    await form.getByLabel("First due date").fill(input.firstDueDateIso);
    await form.getByLabel("Active from").fill(input.activeFromIso);
    if (input.activeUntilIso !== undefined) {
      await form.getByLabel("Active until").fill(input.activeUntilIso);
    }
    await form.getByRole("button", { name: "Save as suggestion" }).click();
  }

  async confirmWithKeyboard(description: string): Promise<void> {
    const button = this.commitment(description)
      .getByRole("button", { name: "Confirm commitment", exact: true });
    await button.focus();
    await this.page.keyboard.press("Enter");
  }

  async confirm(description: string): Promise<void> {
    await this.commitment(description)
      .getByRole("button", { name: "Confirm commitment", exact: true })
      .click();
  }

  async editDescription(description: string, updatedDescription: string): Promise<void> {
    await this.commitment(description)
      .getByRole("button", { name: "Edit commitment", exact: true })
      .click();
    const form = this.section.getByRole("form", {
      name: "Recurring commitment form",
      exact: true,
    });
    await form.getByLabel("Commitment description").fill(updatedDescription);
    await form.getByRole("button", { name: "Save commitment changes" }).click();
  }

  async pauseWithKeyboard(description: string): Promise<void> {
    const button = this.commitment(description)
      .getByRole("button", { name: "Pause commitment", exact: true });
    await button.focus();
    await this.page.keyboard.press("Enter");
  }

  async resumeWithKeyboard(description: string): Promise<void> {
    const button = this.commitment(description)
      .getByRole("button", { name: "Resume commitment", exact: true });
    await button.focus();
    await this.page.keyboard.press("Enter");
  }

  async endWithKeyboard(description: string): Promise<void> {
    const button = this.commitment(description)
      .getByRole("button", { name: "End commitment", exact: true });
    await button.focus();
    await this.page.keyboard.press("Enter");
  }

  async keepCommitment(description: string): Promise<void> {
    await this.endConfirmation(description)
      .getByRole("button", { name: "Keep commitment", exact: true })
      .click();
  }

  async confirmEndCommitment(description: string): Promise<void> {
    await this.endConfirmation(description)
      .getByRole("button", { name: "End commitment", exact: true })
      .click();
  }

  async linkPayment(
    description: string,
    dueDateIso: string,
    searchText: string,
    paymentId: string
  ): Promise<void> {
    const occurrence = this.occurrence(description, dueDateIso);
    await occurrence.getByLabel(`Search local payments for ${dueDateIso}`).fill(searchText);
    await occurrence.getByLabel(`Payment for ${dueDateIso}`).selectOption(paymentId);
    await occurrence.getByRole("button", { name: "Link payment", exact: true }).click();
  }

  async confirmPriceChange(description: string): Promise<void> {
    const button = this.section.getByRole("region", {
      name: `Price change review ${description}`,
      exact: true,
    }).getByRole("button", { name: "Confirm new amount", exact: true });
    await button.focus();
    await this.page.keyboard.press("Enter");
  }

  private endConfirmation(description: string): Locator {
    return this.page.getByRole("alertdialog", {
      name: `End ${description}?`,
      exact: true,
    });
  }
}
