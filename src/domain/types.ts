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

export interface MonthlyCategoryTargetInput {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  /** Category identifier receiving the monthly target. */
  categoryId: string;
  /** Target amount for the category, in minor units. */
  targetMinor: number;
}

export interface MonthlyCategoryTarget extends MonthlyCategoryTargetInput {}

export type MonthlyCategoryTargetValidationErrorCode =
  | "INVALID_TARGET_YEAR_MONTH"
  | "INVALID_TARGET_CATEGORY_ID"
  | "INVALID_TARGET_MINOR_INTEGER"
  | "INVALID_TARGET_MINOR_RANGE";

export interface MonthlyCategoryTargetValidationErrorResponse {
  code: MonthlyCategoryTargetValidationErrorCode;
  message: string;
}

export class MonthlyCategoryTargetValidationError extends Error {
  readonly code: MonthlyCategoryTargetValidationErrorCode;

  constructor(response: MonthlyCategoryTargetValidationErrorResponse) {
    super(response.message);
    this.name = "MonthlyCategoryTargetValidationError";
    this.code = response.code;
  }
}

export interface MonthlyCategoryTargetQuery {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  /** Category identifier to look up. */
  categoryId: string;
}

export interface TargetVsActualCategoryRow {
  /** Category identifier, or null for uncategorized actuals. */
  categoryId: string | null;
  /** Monthly target in minor units. Null when no explicit target exists. */
  targetMinor: number | null;
  /** Actual absolute spend/income total in minor units for the selected month. */
  actualMinor: number;
  /**
   * actualMinor - targetMinor in minor units.
   * Null when no explicit target exists for the row.
   */
  deltaMinor: number | null;
}

export interface TargetVsActualCategoryRows {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  /** Deterministically ordered rows for target-vs-actual rendering/consumption. */
  rows: TargetVsActualCategoryRow[];
}

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Returns true when the value matches the canonical YYYY-MM month format (e.g. "2026-05"). */
export function isYearMonth(value: string): boolean {
  return YEAR_MONTH_PATTERN.test(value);
}

/**
 * Validates monthly category target input.
 * Throws when yearMonth/categoryId/targetMinor are invalid; otherwise returns the input unchanged.
 */
export function validateMonthlyCategoryTargetInput(
  input: MonthlyCategoryTargetInput
): MonthlyCategoryTargetInput {
  if (!isYearMonth(input.yearMonth)) {
    throw new MonthlyCategoryTargetValidationError({
      code: "INVALID_TARGET_YEAR_MONTH",
      message: `Invalid target yearMonth: ${input.yearMonth}`,
    });
  }

  if (input.categoryId.trim().length === 0) {
    throw new MonthlyCategoryTargetValidationError({
      code: "INVALID_TARGET_CATEGORY_ID",
      message: "Target categoryId must be a non-empty string.",
    });
  }

  if (!Number.isInteger(input.targetMinor)) {
    throw new MonthlyCategoryTargetValidationError({
      code: "INVALID_TARGET_MINOR_INTEGER",
      message: `Target targetMinor must be an integer: ${input.targetMinor}`,
    });
  }

  if (input.targetMinor < 0) {
    throw new MonthlyCategoryTargetValidationError({
      code: "INVALID_TARGET_MINOR_RANGE",
      message: `Target targetMinor must be zero or positive: ${input.targetMinor}`,
    });
  }

  return input;
}

/**
 * Validates a month/category target lookup query.
 * Throws when yearMonth or categoryId are invalid; otherwise returns the query unchanged.
 */
export function validateMonthlyCategoryTargetQuery(
  query: MonthlyCategoryTargetQuery
): MonthlyCategoryTargetQuery {
  if (!isYearMonth(query.yearMonth)) {
    throw new Error(`Invalid target query yearMonth: ${query.yearMonth}`);
  }

  if (query.categoryId.trim().length === 0) {
    throw new Error("Target query categoryId must be a non-empty string.");
  }

  return query;
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