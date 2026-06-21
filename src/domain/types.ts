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