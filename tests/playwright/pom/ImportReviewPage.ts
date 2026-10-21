import type { Page } from "@playwright/test";

export class ImportReviewPage {
  constructor(private readonly page: Page) {}

  get reviewQueue() {
    return this.page.getByRole("region", { name: "Import review queue", exact: true });
  }

  get reviewedHistoryDisclosure() {
    return this.reviewQueue.getByText(/^Reviewed rows \(\d+\)$/, { exact: false });
  }

  reviewRow(rowNumber: number) {
    return this.reviewQueue.getByRole("group", { name: `Import review row ${rowNumber}`, exact: true });
  }

  async chooseStatementFile(): Promise<void> {
    await this.page.getByRole("button", { name: "Import statement", exact: true }).click();
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
    await row.getByLabel("Transaction date", { exact: true }).fill(correction.date);
    await row.getByLabel("Amount", { exact: true }).fill(correction.amount);
    await row.getByLabel("Merchant", { exact: true }).fill(correction.merchant);
    await row.getByLabel("Account", { exact: true }).selectOption(correction.accountId);
    await row.getByLabel("Currency", { exact: true }).fill(correction.currency);
    await row.getByRole("button", { name: "Save corrected transaction", exact: true }).click();
  }

  async dismissRow(rowNumber: number, reason: string): Promise<void> {
    const row = this.reviewRow(rowNumber);
    await row.getByLabel("Reason for dismissal (required)", { exact: true }).fill(reason);
    await row.getByRole("button", { name: "Dismiss row", exact: true }).click();
  }
}
