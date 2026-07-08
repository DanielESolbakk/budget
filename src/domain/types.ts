export interface Household {
  id: string;
  name: string;
  createdAtIso: string;
}

export interface Account {
  id: string;
  householdId: string;
  name: string;
  currencyCode: "NOK";
}

export interface Transaction {
  id: string;
  householdId: string;
  accountId: string;
  bookedAtIso: string;
  amountMinor: number;
  merchantRaw: string;
  merchantAlias?: string;
  categoryId?: string;
  importJobId?: string;
}

export interface ImportJob {
  id: string;
  householdId: string;
  sourceType: "csv" | "pdf" | "manual";
  sourceName: string;
  startedAtIso: string;
  finishedAtIso?: string;
}

export interface MonthlyTotal {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  totalMinor: number;
}

export interface MonthlyBreakdown {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  /** Sum of all positive transaction amounts for the month, in minor units. */
  incomeMinor: number;
  /** Sum of absolute values of all negative transaction amounts for the month, in minor units. */
  expenseMinor: number;
  /** Net result: incomeMinor minus expenseMinor. */
  netMinor: number;
}

export interface CategoryBreakdownEntry {
  /** Category identifier, or null for uncategorized transactions. */
  categoryId: string | null;
  /** Human-readable label. "Uncategorized" when categoryId is null. */
  label: string;
  /** Sum of absolute transaction amounts for this category, in minor units. */
  totalMinor: number;
  /** Number of transactions in this category. */
  transactionCount: number;
}

export interface CategoryBreakdown {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  /**
   * Entries ordered by totalMinor descending, ties broken by categoryId ascending.
   * The uncategorized entry (categoryId: null) always appears last.
   */
  entries: CategoryBreakdownEntry[];
}

export type ForecastMethod = "moving-average-3m" | "fallback-zero";

export interface ForecastEntry {
  /** Calendar month in YYYY-MM format, e.g. "2026-06". */
  yearMonth: string;
  projectedMinor: number;
  method: ForecastMethod;
}

export interface ForecastResult {
  entries: ForecastEntry[];
  usedFallback: boolean;
}

/**
 * Normalized input boundary consumed by the forecast engine.
 *
 * All fields are fully resolved – no optional values – so the forecast engine
 * receives an unambiguous instruction set regardless of upstream sparsity.
 *
 * Insufficient-history representation:
 *   - When `history` is empty, the adapter still resolves `fallbackStartYearMonth`
 *     to a concrete YYYY-MM string, enabling the forecast engine to generate
 *     explicit fallback-zero entries without any additional defaulting logic.
 */
export interface ForecastInput {
  /** Historical monthly totals in ascending chronological order (earliest month first). */
  history: MonthlyTotal[];
  /** Number of future months to project. */
  periods: number;
  /**
   * Concrete YYYY-MM month from which fallback entries begin when `history` is empty.
   * Always resolved by the adapter layer; never left implicit.
   */
  fallbackStartYearMonth: string;
}

/**
 * Read-model contract for a deterministic month-series combining historical
 * actuals with a near-term forecast.
 *
 * Ordering invariants:
 *   - `monthlyTotals` elements are in ascending yearMonth order (earliest month first).
 *   - `forecast.entries` are in ascending yearMonth order, each strictly after
 *     the last element of `monthlyTotals` when actuals are present.
 *
 * Insufficient-history representation:
 *   - When `monthlyTotals` is empty, `forecast.usedFallback` is true and every
 *     entry uses method "fallback-zero" with projectedMinor of zero.
 *   - When fewer than three actuals are available the forecast still runs using
 *     whatever months exist (method: "moving-average-3m").
 */
export interface MonthSeries {
  /** Historical monthly totals in ascending chronological order (earliest month first). */
  monthlyTotals: MonthlyTotal[];
  /** Near-term forecast derived from monthlyTotals. */
  forecast: ForecastResult;
}