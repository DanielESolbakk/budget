import type { MonthlyTotal, Transaction } from "../types.js";

function addOneMonth(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (month === 12) {
    return `${year + 1}-01`;
  }

  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function toYearMonth(bookedAtIso: string): string {
  return bookedAtIso.slice(0, 7);
}

/**
 * Builds deterministic month buckets from flat transactions.
 *
 * Behavior:
 * - Buckets are returned in ascending YYYY-MM order, independent of input order.
 * - Missing months between earliest and latest transaction month are included with totalMinor = 0.
 * - Months that net to exactly zero from real transactions are preserved explicitly with totalMinor = 0.
 */
export function buildMonthBuckets(transactions: Transaction[]): MonthlyTotal[] {
  if (transactions.length === 0) {
    return [];
  }

  const totalsByMonth = new Map<string, number>();

  for (const tx of transactions) {
    const yearMonth = toYearMonth(tx.bookedAtIso);
    const current = totalsByMonth.get(yearMonth) ?? 0;
    totalsByMonth.set(yearMonth, current + tx.amountMinor);
  }

  const months = Array.from(totalsByMonth.keys()).sort();
  const firstMonth = months[0]!;
  const lastMonth = months[months.length - 1]!;

  const buckets: MonthlyTotal[] = [];
  let cursor = firstMonth;

  while (cursor <= lastMonth) {
    buckets.push({ yearMonth: cursor, totalMinor: totalsByMonth.get(cursor) ?? 0 });
    cursor = addOneMonth(cursor);
  }

  return buckets;
}
