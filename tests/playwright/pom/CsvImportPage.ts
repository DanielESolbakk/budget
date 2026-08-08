import type { Page } from "@playwright/test";

/**
 * Page Object Model for the CSV Import section of the Budget Planner.
 *
 * Encapsulates locators for the CSV import landmark, file path input, import
 * button, and result feedback rendered by CsvImportSection.tsx.
 *
 * Assertions belong in specs — this object exposes locators only.
 */
export class CsvImportPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The landmark region wrapping the CSV import section (aria-label="CSV Import"). */
  get importSection() {
    return this.page.getByRole("region", { name: "CSV Import" });
  }

  /** The "Import CSV" heading inside the section. */
  get importHeading() {
    return this.page.getByRole("heading", { name: "Import CSV", level: 2 });
  }

  /** The file path text input. */
  get filePathInput() {
    return this.page.locator("#csv-file-path");
  }

  /** The Import CSV action button. */
  get importButton() {
    return this.page.getByRole("button", { name: "Import CSV" });
  }

  /** Status message shown on successful import (role="status"). */
  get successStatus() {
    return this.importSection.getByRole("status");
  }

  /** Alert shown on runtime import failure (role="alert"). */
  get errorAlert() {
    return this.importSection.getByRole("alert");
  }

  /** Fills the file path input and triggers the import action. */
  async submitImport(filePath: string): Promise<void> {
    await this.filePathInput.fill(filePath);
    await this.importButton.click();
  }
}
