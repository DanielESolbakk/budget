import { buildDashboardData, type DashboardData, type DashboardViewContract } from "../src/app/dashboardApi.js";
import type {
  DashboardDataGetter,
  DashboardTestOverrides,
  DashboardViewDataGetter,
} from "./dashboardProvider.js";

function isTestRuntime(): boolean {
  return process.env["NODE_ENV"] === "test";
}

function shouldUseForecastFallback(): boolean {
  return isTestRuntime() && process.env["BUDGET_TEST_FORECAST_FALLBACK"] === "1";
}

function shouldFailDashboardRefresh(): boolean {
  return isTestRuntime() && process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"] === "1";
}

function getDashboardViewDelayMs(yearMonth: string): number {
  if (!isTestRuntime() || process.env["BUDGET_TEST_SLOW_DASHBOARD_MONTH"] !== yearMonth) {
    return 0;
  }

  const delayMs = Number(process.env["BUDGET_TEST_DASHBOARD_VIEW_DELAY_MS"]);
  return Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
}

function getData(getDashboardData: DashboardDataGetter): DashboardData {
  return shouldUseForecastFallback()
    ? buildDashboardData({ monthlyTotals: [] })
    : getDashboardData();
}

async function getViewData(
  yearMonth: string,
  getDashboardViewData: DashboardViewDataGetter
): Promise<DashboardViewContract> {
  const delayMs = getDashboardViewDelayMs(yearMonth);
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (shouldFailDashboardRefresh()) {
    throw new Error("Synthetic dashboard refresh failure.");
  }

  return getDashboardViewData(yearMonth);
}

export function createTestDashboardOverrides(): DashboardTestOverrides {
  return { getData, getViewData };
}