import type { Locator, Page } from "@playwright/test";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Page Object Model for the dashboard target-vs-actual section.
 *
 * Assertions belong in specs — this object exposes locators only.
 */
export class DashboardTargetPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get section() {
    return this.page.getByRole("region", { name: "Target vs Actual" });
  }

  get heading() {
    return this.page.getByRole("heading", { name: "Target vs Actual", level: 2 });
  }

  get table() {
    return this.section.getByRole("table");
  }

  get targetColumn() {
    return this.table.getByRole("columnheader", { name: "Target" });
  }

  get actualColumn() {
    return this.table.getByRole("columnheader", { name: "Actual" });
  }

  get deltaColumn() {
    return this.table.getByRole("columnheader", { name: "Delta" });
  }

  categoryRow(category: string): Locator {
    return this.table.getByRole("row").filter({ hasText: new RegExp(`^${escapeRegExp(category)}`) });
  }

  categoryCell(category: string): Locator {
    return this.categoryRow(category).getByRole("cell", { name: category, exact: true });
  }

  targetCell(category: string): Locator {
    return this.categoryRow(category).getByRole("cell").nth(1);
  }

  actualCell(category: string): Locator {
    return this.categoryRow(category).getByRole("cell").nth(2);
  }

  deltaCell(category: string): Locator {
    return this.categoryRow(category).getByRole("cell").nth(3);
  }

  noTargetIndicators(category: string): Locator {
    return this.categoryRow(category).getByRole("cell", { name: "No target", exact: true });
  }
}
