import type { Page } from "@playwright/test";
import { CsvImportPage } from "./CsvImportPage.js";
import { PdfImportPage } from "./PdfImportPage.js";

export class PendingTransactionsPage {
  private readonly page: Page;
  private readonly csvImport: CsvImportPage;
  private readonly pdfImport: PdfImportPage;

  constructor(page: Page) {
    this.page = page;
    this.csvImport = new CsvImportPage(page);
    this.pdfImport = new PdfImportPage(page);
  }

  async open(): Promise<void> {
    await this.page.getByRole("button", { name: "Activity", exact: true }).click();
    await this.page
      .getByRole("navigation", { name: "Activity views" })
      .getByRole("button", { name: "Pending", exact: true })
      .click();
  }

  async openWithKeyboard(): Promise<void> {
    const activityButton = this.page.getByRole("button", { name: "Activity", exact: true });
    await activityButton.focus();
    await activityButton.press("Enter");
    const pendingWorkspaceButton = this.page
      .getByRole("navigation", { name: "Activity views" })
      .getByRole("button", { name: "Pending", exact: true });
    await pendingWorkspaceButton.focus();
    await pendingWorkspaceButton.press("Enter");
  }

  async workspaceIsVisible(): Promise<boolean> {
    return this.page
      .getByRole("region", { name: "Pending transactions workspace", exact: true })
      .isVisible();
  }

  async workspaceText(): Promise<string> {
    return this.page
      .getByRole("region", { name: "Pending transactions workspace", exact: true })
      .innerText();
  }

  async pendingCount(): Promise<number> {
    return this.page
      .getByRole("region", { name: "Pending transactions workspace", exact: true })
      .getByRole("list", { name: "Pending transactions", exact: true })
      .getByRole("listitem")
      .count();
  }

  async pendingText(): Promise<string> {
    return this.page
      .getByRole("region", { name: "Pending transactions workspace", exact: true })
      .getByRole("list", { name: "Pending transactions", exact: true })
      .innerText();
  }

  async hasHorizontalOverflow(): Promise<boolean> {
    return this.page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
  }

  async pendingRowsOverlap(): Promise<boolean> {
    const pendingRows = this.page
      .getByRole("region", { name: "Pending transactions workspace", exact: true })
      .getByRole("list", { name: "Pending transactions", exact: true })
      .getByRole("listitem");
    return pendingRows.evaluateAll((rows) =>
      rows.some((row) => {
        const details = [
          row.querySelector(".pending-observation-primary"),
          row.querySelector(".pending-observation-status"),
          row.querySelector(".pending-observation-amount"),
          row.querySelector(".pending-observation-reference"),
        ].filter((element): element is Element => element !== null);
        const boxes = details.map((element) => element.getBoundingClientRect());
        return boxes.some((left, index) =>
          boxes.slice(index + 1).some((right) =>
            left.left < right.right &&
            left.right > right.left &&
            left.top < right.bottom &&
            left.bottom > right.top
          )
        );
      })
    );
  }

  async importCsvFile(filePath: string): Promise<void> {
    await this.csvImport.submitImport(filePath);
    await this.csvImport.importSection
      .getByRole("heading", { name: "Import complete", exact: true })
      .waitFor({ state: "visible" });
  }

  async importTextPdfFile(filePath: string): Promise<void> {
    await this.pdfImport.submitImport(filePath);
    await this.pdfImport.importSection
      .getByRole("heading", { name: "Import complete", exact: true })
      .waitFor({ state: "visible" });
  }
}
