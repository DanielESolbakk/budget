import type { DashboardData } from "../../app/dashboardApi.js";
import type { BudgetApi } from "../preload.js";

export function loadDashboardData(api: BudgetApi = window.budgetApi): Promise<DashboardData> {
  return api.dashboard.getData();
}
