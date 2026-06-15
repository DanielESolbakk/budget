import type { ForecastEntry, ForecastMethod, ForecastResult, MonthlyTotal } from "../types.js";

const MOVING_AVERAGE_WINDOW = 3;

/**
 * Adds one calendar month to a YYYY-MM string.
 */
function addOneMonth(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (month === 12) {
    return `${year + 1}-01`;
  }
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * Computes a deterministic near-term forecast using a 3-month simple moving
 * average of historical monthly totals.
 *
 * Method: moving-average-3m
 *   - Uses up to the last 3 months of actuals as the window.
 *   - If fewer than 3 months are available, uses whatever months exist.
 *
 * Fallback (usedFallback: true, method: "fallback-zero"):
 *   - Applied when the history array is empty; all projected values are zero.
 *   - Starts from `fallbackStartYearMonth` when provided, otherwise from the
 *     current calendar month, keeping callers deterministic in tests.
 *
 * @param history               Monthly totals in ascending chronological order.
 * @param periods               Number of future months to forecast (default 3).
 * @param fallbackStartYearMonth  YYYY-MM month to begin fallback entries from.
 *                              Defaults to the current UTC month when omitted.
 */
export function simpleForecast(
  history: MonthlyTotal[],
  periods = 3,
  fallbackStartYearMonth?: string
): ForecastResult {
  if (history.length === 0) {
    const startMonth = fallbackStartYearMonth ?? currentYearMonth();
    const entries: ForecastEntry[] = [];
    let cursor = startMonth;
    for (let i = 0; i < periods; i++) {
      if (i > 0) {
        cursor = addOneMonth(cursor);
      }
      entries.push({ yearMonth: cursor, projectedMinor: 0, method: "fallback-zero" });
    }
    return { entries, usedFallback: true };
  }

  const window = history.slice(-MOVING_AVERAGE_WINDOW);
  const average = Math.round(
    window.reduce((sum, m) => sum + m.totalMinor, 0) / window.length
  );
  const method: ForecastMethod = "moving-average-3m";

  // history.length > 0 is guaranteed by the early-return guard above.
  const lastYearMonth = history[history.length - 1]!.yearMonth;
  const entries: ForecastEntry[] = [];
  let cursor = lastYearMonth;
  for (let i = 0; i < periods; i++) {
    cursor = addOneMonth(cursor);
    entries.push({ yearMonth: cursor, projectedMinor: average, method });
  }

  return { entries, usedFallback: false };
}

function currentYearMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}
