import type { Page } from "@playwright/test";

/**
 * Page Object Model for the Forecast section of the Budget Planner dashboard.
 *
 * Encapsulates locators for the forecast section rendered by ForecastSection.tsx.
 * Assertions belong in specs — this object exposes locators only.
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
    return this.page.getByText("Not enough recorded months yet; showing a zero-value fallback estimate.");
  }

  /** Projected-months description shown when history is sufficient. */
  get projectedDescription() {
    return this.page.getByText("Estimated from the average of up to three recent monthly totals.");
  }
}
