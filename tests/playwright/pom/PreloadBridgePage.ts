import type { Page } from "@playwright/test";

/** Shape returned by `window.budgetApi.dashboard.getData()` at runtime. */
interface DashboardDataShape {
  monthlyTotals: unknown;
  forecast: unknown;
}

/** Minimal ambient type for the preload bridge as exposed to the renderer. */
interface BudgetApiShape {
  dashboard: {
    getData: () => Promise<DashboardDataShape>;
  };
}

/**
 * Page Object Model for asserting on the preload bridge exposed at
 * `window.budgetApi` in the Electron renderer.
 *
 * Encapsulates all `page.evaluate` calls that inspect or invoke the IPC
 * contract, keeping bridge-specific logic out of test specs.
 */
export class PreloadBridgePage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Returns true when `window.budgetApi.dashboard.getData` is callable.
   * Tests whether the preload bridge wired the dashboard IPC method correctly.
   */
  async hasDashboardGetData(): Promise<boolean> {
    return this.page.evaluate(() => {
      const api = (window as unknown as { budgetApi?: unknown }).budgetApi;
      if (!api || typeof api !== "object") return false;
      const dashboard = (api as Record<string, unknown>)["dashboard"];
      return typeof (dashboard as Record<string, unknown>)?.["getData"] === "function";
    });
  }

  /**
   * Calls `window.budgetApi.dashboard.getData()` and returns which expected
   * contract fields are present on the resolved value.
   */
  async getDashboardContractFields(): Promise<{ hasMonthlyTotals: boolean; hasForecast: boolean }> {
    return this.page.evaluate(async () => {
      const api = (window as unknown as { budgetApi: BudgetApiShape }).budgetApi;
      const data = await api.dashboard.getData();
      return {
        hasMonthlyTotals: "monthlyTotals" in data,
        hasForecast: "forecast" in data,
      };
    });
  }
}
