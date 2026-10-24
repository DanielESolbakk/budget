import type { Page } from "@playwright/test";

export class ImportReviewPage {
  constructor(private readonly page: Page) {}

  get reviewQueue() {
    return this.page.getByRole("region", { name: "Import review queue", exact: true });
  }

  get reviewedHistoryDisclosure() {
    return this.reviewQueue.getByText(/^Reviewed rows \(\d+\)$/, { exact: false });
  }

  async openReviewQueue(): Promise<void> {
    const navigationButton = this.page.getByRole("button", { name: "Import row review", exact: true });
    if (await navigationButton.getAttribute("aria-pressed") !== "true") {
      await navigationButton.click();
    }
  }

  async openUnresolvedRowsFromCompletion(): Promise<void> {
    await this.page.getByRole("button", { name: "Review unresolved rows", exact: true }).click();
  }

  reviewRow(rowNumber: number) {
    return this.reviewQueue.getByRole("group", { name: `Import review row ${rowNumber}`, exact: true });
  }

  async chooseStatementFile(): Promise<void> {
    await this.page.getByRole("button", { name: "Choose statement file", exact: true }).click();
  }

  async openCorrection(rowNumber: number): Promise<void> {
    const disclosure = this.reviewRow(rowNumber).getByText("Correct transaction", { exact: true });
    const isOpen = await disclosure.evaluate((element) =>
      element.parentElement instanceof HTMLDetailsElement && element.parentElement.open
    );
    if (!isOpen) await disclosure.click();
  }

  async openDismissal(rowNumber: number): Promise<void> {
    const disclosure = this.reviewRow(rowNumber).getByText("Dismiss this row", { exact: true });
    const isOpen = await disclosure.evaluate((element) =>
      element.parentElement instanceof HTMLDetailsElement && element.parentElement.open
    );
    if (!isOpen) await disclosure.click();
  }

  async correctRow(
    rowNumber: number,
    correction: {
      date: string;
      amount: string;
      merchant: string;
      accountId: string;
      currency: string;
    }
  ): Promise<void> {
    const row = this.reviewRow(rowNumber);
    await this.openCorrection(rowNumber);
    await row.getByLabel("Transaction date", { exact: true }).fill(correction.date);
    await row.getByLabel("Amount", { exact: true }).fill(correction.amount);
    await row.getByLabel("Merchant", { exact: true }).fill(correction.merchant);
    await row.getByLabel("Account", { exact: true }).selectOption(correction.accountId);
    await row.getByLabel("Currency", { exact: true }).fill(correction.currency);
    await row.getByRole("button", { name: "Save corrected transaction", exact: true }).click();
  }

  async dismissRow(rowNumber: number, reason: string): Promise<void> {
    const row = this.reviewRow(rowNumber);
    await this.openDismissal(rowNumber);
    await row.getByLabel("Reason for dismissal (required)", { exact: true }).fill(reason);
    await row.getByRole("button", { name: "Dismiss row", exact: true }).click();
  }
}
