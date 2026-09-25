import { type Page } from "@playwright/test";

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
    return this.page.getByRole("region", { name: "CSV Import", exact: true });
  }

  /** The "Import CSV" heading inside the section. */
  get importHeading() {
    return this.page.getByRole("heading", { name: "Import CSV", level: 2 });
  }

  /** The file path text input. */
  get filePathInput() {
    return this.page.getByRole("textbox", { name: "CSV file path" });
  }

  /** The Import CSV action button. */
  get importButton() {
    return this.page.getByRole("button", { name: "Preview CSV" });
  }

  get confirmImportButton() {
    return this.page.getByRole("button", { name: "Confirm CSV import" });
  }

  get previewRegion() {
    return this.importSection.getByRole("region", { name: "CSV import preview" });
  }

  mappingSelect(label: string) {
    return this.previewRegion.getByRole("combobox", { name: `Map ${label}` });
  }

  /** Status message shown on successful import (role="status"). */
  get successStatus() {
    return this.importSection.getByRole("status");
  }

  /** Alert shown on runtime import failure (role="alert"). */
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
