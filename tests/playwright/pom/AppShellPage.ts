import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Page Object Model for the Budget Planner application shell.
 *
 * Encapsulates locators and assertions for the top-level window after startup.
 * Use this abstraction for all tests that assert on window boot and root render.
 */
export class AppShellPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Heading rendered by App.tsx at the root of the application. */
  get heading() {
    return this.page.getByRole("heading", { name: "Budget Planner", level: 1 });
  }

  /** Introductory paragraph rendered below the main heading. */
  get introText() {
    return this.page.getByText("Local-first budget planning for your household.");
  }

  /**
   * Waits for the application shell heading to be visible.
   * Confirms the renderer reached a non-blank loaded state.
   */
  async waitForShell(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }
}
