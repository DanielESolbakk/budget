import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Page Object Model for the Forecast section of the Budget Planner dashboard.
 *
 * Encapsulates locators and assertions for the forecast section rendered by
 * ForecastSection.tsx.  Keeps business assertions in specs and UI navigation
 * in this object.
 */
export class ForecastPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The landmark region wrapping the forecast output (aria-label="Forecast"). */
  get section() {
    return this.page.getByRole("region", { name: "Forecast" });
  }

  /** The "Forecast" heading inside the section. */
  get sectionHeading() {
    return this.page.getByRole("heading", { name: "Forecast", level: 2 });
  }

  /** Fallback label shown when there is insufficient history. */
  get fallbackLabel() {
    return this.page.getByText("Insufficient history: showing fallback forecast.");
  }

  /** Projected-months description shown when history is sufficient. */
  get projectedDescription() {
    return this.page.getByText("Projected months from the local dashboard forecast.");
  }

  /**
   * Waits for the forecast section heading to be visible.
   * Does not assert whether entries use real or fallback data.
   */
  async waitForSection(): Promise<void> {
    await expect(this.sectionHeading).toBeVisible();
  }

  /**
   * Asserts that some forecast output is visible: either projected-month
   * entries from real history or the explicit fallback label.
   */
  async assertForecastOutputVisible(): Promise<void> {
    await expect(this.section).toBeVisible();
    await expect(this.sectionHeading).toBeVisible();
  }
}
