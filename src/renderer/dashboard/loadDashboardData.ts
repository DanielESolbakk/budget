import type { DashboardData } from "../../shared/dashboard.js";
import type { BudgetApi } from "../preload.js";

export function loadDashboardData(api: BudgetApi): Promise<DashboardData> {
  return api.dashboard.getData();
}
