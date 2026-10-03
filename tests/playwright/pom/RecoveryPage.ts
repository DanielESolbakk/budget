import type { Page } from "@playwright/test";

export class RecoveryPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get backupSection() {
    return this.page.getByRole("region", { name: "Backup" });
  }

  get backupPathInput() {
    return this.backupSection.getByLabel("Destination path");
  }

  get backupBrowseButton() {
    return this.backupSection.getByRole("button", { name: "Choose destination", exact: true });
  }

  get backupCreateButton() {
    return this.backupSection.getByRole("button", { name: "Create backup", exact: true });
  }

  get backupSuccess() {
    return this.backupSection.getByRole("status").filter({ hasText: "Backup saved to" });
  }

  get backupCancelled() {
    return this.backupSection.getByRole("status").filter({
      hasText: "No destination selected. Backup was not created.",
    });
  }

  get backupCreatedTime() {
    return this.backupSuccess.locator("time");
  }

  get exportSection() {
    return this.page.getByRole("region", { name: "Export" });
  }

  get exportPathInput() {
    return this.exportSection.getByLabel("Destination path");
  }

  get browseButton() {
    return this.exportSection.getByRole("button", { name: "Choose destination", exact: true });
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

  get chooseSnapshotButton() {
    return this.restoreSection.getByRole("button", { name: "Choose snapshot", exact: true });
  }

  get reviewSnapshotButton() {
    return this.restoreSection.getByRole("button", { name: "Review snapshot", exact: true });
  }

  get restoreButton() {
    return this.restoreSection.getByRole("button", { name: "Restore snapshot" });
  }

  get snapshotDetails() {
    return this.restoreSection.getByRole("group", { name: "Snapshot details" });
  }

  get snapshotReviewSuccess() {
    return this.restoreSection.getByRole("status").filter({ hasText: "Snapshot verified." });
  }

  get recentSnapshots() {
    return this.restoreSection.getByRole("group", { name: "Recent snapshots" });
  }

  get recentSnapshotsSummary() {
    return this.restoreSection.getByText(/^Recent snapshots/);
  }

  get catalogError() {
    return this.recentSnapshots.getByRole("alert");
  }

  get retryCatalogButton() {
    return this.recentSnapshots.getByRole("button", { name: "Retry catalog", exact: true });
  }

  get refreshCatalogButton() {
    return this.recentSnapshots.getByRole("button", { name: "Refresh snapshots", exact: true });
  }

  snapshotCatalogEntry(snapshotPath: string) {
    return this.recentSnapshots.getByRole("listitem").filter({ hasText: snapshotPath });
  }

  reviewCatalogSnapshotButton(snapshotPath: string) {
    return this.snapshotCatalogEntry(snapshotPath).getByRole("button", {
      name: "Review for restore",
      exact: true,
    });
  }

  get restoreSuccess() {
    return this.restoreSection.getByRole("status").filter({ hasText: "Restore complete." });
  }

  get undoRestoreButton() {
    return this.restoreSection.getByRole("button", { name: "Undo restore", exact: true });
  }

  get retryUndoButton() {
    return this.restoreSection.getByRole("button", { name: "Retry undo", exact: true });
  }

  get restoreUndoSuccess() {
    return this.restoreSection.getByRole("status").filter({ hasText: "Restore undone." });
  }

  get restoreCancelled() {
    return this.restoreSection.getByRole("status").filter({ hasText: "Restore cancelled." });
  }

  get restoreError() {
    return this.restoreSection.getByRole("alert");
  }
}
