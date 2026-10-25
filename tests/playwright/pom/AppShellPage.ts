import type { Page } from "@playwright/test";

export type WorkspaceName =
  | "Review"
  | "Activity"
  | "Accounts"
  | "Household"
  | "Transactions"
  | "Coverage"
  | "Pending"
  | "Import"
  | "Data safety"
  | "Settings";

/**
 * Page Object Model for the Budget Planner application shell.
 *
 * Encapsulates locators for the top-level window after startup.
 * Assertions belong in specs — this object exposes locators only.
 */
export class AppShellPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Heading rendered by App.tsx at the root of the application. */
  get heading() {
    return this.page.getByRole("banner").getByRole("heading", { level: 1 });
  }

  /** Top-level application banner rendered by the root shell. */
  get banner() {
    return this.page.getByRole("banner");
  }

  /** Product copy identifying the local household ledger. */
  get localLedgerLabel() {
    return this.page.getByText("Local household ledger", { exact: true });
  }

  /** Product copy identifying that the workflow stays on the device. */
  get onDeviceLabel() {
    return this.page.getByText("On device", { exact: true });
  }

  get primaryNavigation() {
    return this.page.getByRole("navigation", { name: "Primary" });
  }

  destination(name: WorkspaceName) {
    const parentName =
      name === "Transactions" || name === "Pending" || name === "Import"
        ? "Activity"
        : name === "Coverage"
          ? "Accounts"
          : name === "Data safety" || name === "Settings"
            ? "Household"
            : name;
    return this.primaryNavigation.getByRole("button", { name: parentName, exact: true });
  }

  workspace(name: WorkspaceName) {
    return this.page.getByRole("region", { name: `${name} workspace`, exact: true });
  }

  async openWorkspace(name: WorkspaceName): Promise<void> {
    await this.destination(name).click();
    if (name === "Transactions" || name === "Pending" || name === "Import") {
      await this.page
        .getByRole("navigation", { name: "Activity views" })
        .getByRole("button", { name, exact: true })
        .click();
    } else if (name === "Data safety") {
      await this.page
        .getByRole("navigation", { name: "Household tools" })
        .getByRole("button", { name, exact: true })
        .click();
    } else if (name === "Settings") {
      await this.page
        .getByRole("navigation", { name: "Household tools" })
        .getByRole("button", { name: "Exchange rates", exact: true })
        .click();
    }
  }

  async selectImportFormat(format: "CSV statement" | "Digital PDF" | "Manual transaction"): Promise<void> {
    if (format === "Manual transaction") {
      await this.page.getByRole("button", { name: "Enter transaction manually", exact: true }).click();
      return;
    }
    await this.page.getByRole("button", { name: "Choose statement file", exact: true }).click();
  }
}
