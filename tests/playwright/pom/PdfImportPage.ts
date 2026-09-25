import { type Page } from "@playwright/test";

/**
 * Page Object Model for the PDF Import section of the Budget Planner.
 *
 * Encapsulates locators for the PDF import landmark, file path input, import
 * button, and result feedback rendered by PdfImportSection.tsx.
 *
 * Assertions belong in specs — this object exposes locators only.
 */
export class PdfImportPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The landmark region wrapping the PDF import section (aria-label="PDF Import"). */
  get importSection() {
    return this.page.getByRole("region", { name: "PDF Import", exact: true });
  }

  /** The "Import PDF Statement" heading inside the section. */
  get importHeading() {
    return this.page.getByRole("heading", { name: "Import PDF Statement", level: 2 });
  }

  /** The file path text input. */
  get filePathInput() {
    return this.page.getByRole("textbox", { name: "PDF statement path" });
  }

  /** The Import PDF action button. */
  get importButton() {
    return this.page.getByRole("button", { name: "Preview PDF" });
  }

  get confirmImportButton() {
    return this.page.getByRole("button", { name: "Confirm PDF import" });
  }

  get previewRegion() {
    return this.importSection.getByRole("region", { name: "PDF import preview" });
  }

  /** Status message shown on successful import (role="status"). */
  get successStatus() {
    return this.importSection.getByRole("status");
  }

  get pendingStatus() {
    return this.importSection.getByRole("status").filter({ hasText: "Checking the file..." });
  }

  /** Alert shown on runtime import failure or validation failure (role="alert"). */
  get errorAlert() {
    return this.importSection.getByRole("alert").first();
  }

  /** Fills the file path input and triggers the import action. */
  async submitImport(filePath: string): Promise<void> {
    await this.filePathInput.fill(filePath);
    await this.importButton.click();
    await Promise.race([
      this.previewRegion.waitFor({ state: "visible" }),
      this.errorAlert.waitFor({ state: "visible" }),
    ]);
    if (await this.previewRegion.isVisible() && await this.confirmImportButton.isEnabled()) {
      await this.confirmImportButton.click();
    }
  }
}
