import type { DashboardData } from "../../app/dashboardApi.js";
import type { BudgetApi } from "../preload.js";

export function loadDashboardData(api: BudgetApi): Promise<DashboardData> {
  return api.dashboard.getData();
}
