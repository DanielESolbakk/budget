import type { Page } from "@playwright/test";

export class RecoveryPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get exportSection() {
    return this.page.getByRole("region", { name: "Export" });
  }

  get exportPathInput() {
    return this.exportSection.getByLabel("CSV output path");
  }

  get exportButton() {
    return this.exportSection.getByRole("button", { name: "Export CSV", exact: true });
  }

  get exportSuccess() {
    return this.exportSection.getByRole("status").filter({ hasText: "Export saved to" });
  }

  get exportCancelled() {
    return this.exportSection.getByRole("status").filter({ hasText: "Export cancelled." });
  }

  get exportError() {
    return this.exportSection.getByRole("alert");
  }

  get restoreSection() {
    return this.page.getByRole("region", { name: "Restore Snapshot" });
  }

  get restorePathInput() {
    return this.restoreSection.getByLabel("Snapshot file path");
  }

  get restoreButton() {
    return this.restoreSection.getByRole("button", { name: "Restore snapshot" });
  }

  get restoreSuccess() {
    return this.restoreSection.getByRole("status").filter({ hasText: "Restore complete." });
  }

  get restoreCancelled() {
    return this.restoreSection.getByRole("status").filter({ hasText: "Restore cancelled." });
  }

  get restoreError() {
    return this.restoreSection.getByRole("alert");
  }
}
