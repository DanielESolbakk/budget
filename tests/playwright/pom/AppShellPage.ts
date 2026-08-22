import type { Page } from "@playwright/test";

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
}
