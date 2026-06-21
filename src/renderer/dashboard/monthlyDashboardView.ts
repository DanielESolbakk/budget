import {
  buildDashboardViewContract,
  type DashboardViewContract,
  type DashboardViewContractInput,
} from "../../app/dashboardApi.js";
import type { Transaction } from "../../domain/types.js";

export function renderMonthlyDashboardView(input: DashboardViewContractInput): DashboardViewContract {
  return buildDashboardViewContract(input);
}

function readSelectedYearMonth(view: DashboardViewContract): string {
  if (view.state === "loading") {
    return view.selectedYearMonth;
  }

  return view.snapshot.selectedYearMonth;
}

export function switchMonthlyDashboardMonth(
  currentView: DashboardViewContract,
  transactions: Transaction[],
  nextSelectedYearMonth: string
): DashboardViewContract {
  if (readSelectedYearMonth(currentView) === nextSelectedYearMonth) {
    return currentView;
  }

  return buildDashboardViewContract({ transactions, selectedYearMonth: nextSelectedYearMonth });
}
