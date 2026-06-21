import { computeCategoryBreakdown } from "../domain/aggregation/computeCategoryBreakdown.js";
import { computeMonthlyTotals } from "../domain/aggregation/computeMonthlyTotals.js";
import { simpleForecast } from "../domain/forecast/simpleForecast.js";
import type {
  CategoryBreakdown,
  ForecastResult,
  MonthlyBreakdown,
  MonthlyTotal,
  Transaction,
} from "../domain/types.js";

export type { CategoryBreakdown, MonthlyBreakdown };
export { UNCATEGORIZED_LABEL } from "../domain/aggregation/computeCategoryBreakdown.js";

export interface DashboardInput {
  monthlyTotals: MonthlyTotal[];
  forecastPeriods?: number;
  /** YYYY-MM month to begin fallback entries from when history is empty. Defaults to current UTC month. */
  fallbackStartYearMonth?: string;
}

export interface DashboardData {
  monthlyTotals: MonthlyTotal[];
  forecast: ForecastResult;
}

export interface MonthlyDashboardSnapshot {
  selectedYearMonth: string;
  monthlyTotals: MonthlyBreakdown;
  categoryBreakdown: CategoryBreakdown;
}

export interface LoadingDashboardViewContract {
  state: "loading";
  selectedYearMonth: string;
}

export interface ReadyDashboardViewContract {
  state: "ready";
  snapshot: MonthlyDashboardSnapshot;
}

export interface EmptyDashboardViewContract {
  state: "empty";
  snapshot: MonthlyDashboardSnapshot;
}

export type DashboardViewContract =
  | LoadingDashboardViewContract
  | ReadyDashboardViewContract
  | EmptyDashboardViewContract;

export interface DashboardViewContractInput {
  transactions: Transaction[];
  selectedYearMonth: string;
  isLoading?: boolean;
}

/**
 * Builds the dashboard data contract, composing historical monthly totals with
 * a deterministic forecast.  Existing totals are passed through unchanged so
 * that adding forecast output cannot break existing totals or category flows.
 */
export function buildDashboardData(input: DashboardInput): DashboardData {
  const { monthlyTotals, forecastPeriods, fallbackStartYearMonth } = input;
  const forecast = simpleForecast(monthlyTotals, forecastPeriods, fallbackStartYearMonth);
  return { monthlyTotals, forecast };
}

/**
 * Returns deterministic income, expense, and net totals for a selected calendar month.
 * Only transactions whose bookedAtIso falls within the given YYYY-MM month are included.
 */
export function queryMonthlyTotals(
  transactions: Transaction[],
  yearMonth: string
): MonthlyBreakdown {
  return computeMonthlyTotals(transactions, yearMonth);
}

/**
 * Returns a deterministic category breakdown for a selected calendar month.
 * Entries are ordered by totalMinor descending; the uncategorized entry (if any) appears last.
 */
export function queryCategoryBreakdown(
  transactions: Transaction[],
  yearMonth: string
): CategoryBreakdown {
  return computeCategoryBreakdown(transactions, yearMonth);
}

export function queryMonthlyDashboardSnapshot(
  transactions: Transaction[],
  selectedYearMonth: string
): MonthlyDashboardSnapshot {
  return {
    selectedYearMonth,
    monthlyTotals: queryMonthlyTotals(transactions, selectedYearMonth),
    categoryBreakdown: queryCategoryBreakdown(transactions, selectedYearMonth),
  };
}

export function buildDashboardViewContract(input: DashboardViewContractInput): DashboardViewContract {
  const { transactions, selectedYearMonth, isLoading = false } = input;

  if (isLoading) {
    return { state: "loading", selectedYearMonth };
  }

  const snapshot = queryMonthlyDashboardSnapshot(transactions, selectedYearMonth);

  if (snapshot.categoryBreakdown.entries.length === 0) {
    return { state: "empty", snapshot };
  }

  return { state: "ready", snapshot };
}

export function refreshDashboardViewContractMonth(
  transactions: Transaction[],
  nextSelectedYearMonth: string
): DashboardViewContract {
  return buildDashboardViewContract({
    transactions,
    selectedYearMonth: nextSelectedYearMonth,
  });
}
