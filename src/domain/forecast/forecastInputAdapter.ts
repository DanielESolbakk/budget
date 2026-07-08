import type { ForecastInput, MonthlyTotal, MonthSeries } from "../types.js";

const DEFAULT_PERIODS = 3;

function currentYearMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Converts a month-bucket array into a fully resolved ForecastInput boundary.
 *
 * Behaviour:
 * - `periods` defaults to 3 when not provided.
 * - `fallbackStartYearMonth` defaults to the current UTC calendar month when
 *   not provided, ensuring the forecast engine always receives a concrete value.
 * - When `monthlyTotals` is empty the adapter still resolves all fields
 *   explicitly so the forecast engine can generate fallback-zero entries
 *   without any additional defaulting logic.
 *
 * @param monthlyTotals  Month-bucket output in ascending YYYY-MM order.
 * @param options        Optional period count and fallback start month override.
 */
export function buildForecastInput(
  monthlyTotals: MonthlyTotal[],
  options?: {
    periods?: number;
    fallbackStartYearMonth?: string;
  }
): ForecastInput {
  return {
    history: monthlyTotals,
    periods: options?.periods ?? DEFAULT_PERIODS,
    fallbackStartYearMonth: options?.fallbackStartYearMonth ?? currentYearMonth(),
  };
}

/**
 * Convenience overload that extracts `monthlyTotals` from a MonthSeries and
 * delegates to `buildForecastInput`.
 *
 * @param series   MonthSeries read-model from the dashboard domain.
 * @param options  Optional period count and fallback start month override.
 */
export function buildForecastInputFromMonthSeries(
  series: MonthSeries,
  options?: {
    periods?: number;
    fallbackStartYearMonth?: string;
  }
): ForecastInput {
  return buildForecastInput(series.monthlyTotals, options);
}
