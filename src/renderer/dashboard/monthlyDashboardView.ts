import {
  buildDashboardViewContract,
  type DashboardViewContract,
  type DashboardViewContractInput,
} from "../../app/dashboardApi.js";
import type { Transaction } from "../../domain/types.js";

export function renderMonthlyDashboardView(input: DashboardViewContractInput): DashboardViewContract {
  return buildDashboardViewContract(input);
}

export function switchMonthlyDashboardMonth(
  transactions: Transaction[],
  selectedYearMonth: string
): DashboardViewContract {
  return buildDashboardViewContract({ transactions, selectedYearMonth });
}
