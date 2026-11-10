import type { CategoryBreakdown, CategoryBreakdownEntry, Transaction } from "../types.js";
import { isIsoCalendarDate } from "../date/calendarDate.js";

export const UNCATEGORIZED_LABEL = "Uncategorized";

export type CategoryBreakdownFlow = "all" | "inflows" | "spending";

/**
 * Computes a deterministic category breakdown for transactions within a given calendar month.
 *
 * Transactions without a categoryId are grouped under an explicit "Uncategorized" entry
 * (categoryId: null) that always appears last in the result.
 *
 * Ordering: categorized entries sorted by totalMinor descending, ties broken by categoryId
 * ascending. The uncategorized entry (if present) is always last.
 */
export function computeCategoryBreakdown(
  transactions: Transaction[],
  yearMonth: string,
  flow: CategoryBreakdownFlow = "all"
): CategoryBreakdown {
  const monthTxs = transactions.filter(tx => tx.bookedAtIso.startsWith(yearMonth));
  return buildCategoryBreakdown(monthTxs, yearMonth, flow);
}

export function computeCategoryBreakdownForDateRange(
  transactions: Transaction[],
  startDateIso: string,
  endDateExclusiveIso: string,
  flow: CategoryBreakdownFlow = "all"
): CategoryBreakdown {
  if (!isIsoCalendarDate(startDateIso) || !isIsoCalendarDate(endDateExclusiveIso)) {
    throw new RangeError("Reporting range boundaries must be valid calendar dates.");
  }
  if (startDateIso >= endDateExclusiveIso) {
    throw new RangeError("Reporting range end must be after its start.");
  }

  const rangeTxs = transactions.filter((tx) => {
    const bookedDateIso = tx.bookedAtIso.slice(0, 10);
    if (!isIsoCalendarDate(bookedDateIso)) {
      throw new RangeError(`Transaction has an invalid booked date: ${tx.id}`);
    }
    return bookedDateIso >= startDateIso && bookedDateIso < endDateExclusiveIso;
  });
  return buildCategoryBreakdown(rangeTxs, startDateIso.slice(0, 7), flow);
}

function buildCategoryBreakdown(
  transactions: Transaction[],
  yearMonth: string,
  flow: CategoryBreakdownFlow
): CategoryBreakdown {
  const byCategory = new Map<string | null, { totalMinor: number; transactionIds: Set<string> }>();

  for (const tx of transactions) {
    const categoryAmounts = tx.categoryAllocations?.length
      ? tx.categoryAllocations.filter((allocation) => includesFlow(allocation.amountMinor, flow))
      : includesFlow(tx.amountMinor, flow)
        ? [{ categoryId: tx.categoryId ?? null, amountMinor: tx.amountMinor }]
        : [];

    for (const allocation of categoryAmounts) {
      const acc = byCategory.get(allocation.categoryId) ?? {
        totalMinor: 0,
        transactionIds: new Set<string>(),
      };
      acc.totalMinor += Math.abs(allocation.amountMinor);
      acc.transactionIds.add(tx.id);
      byCategory.set(allocation.categoryId, acc);
    }
  }

  const categorized: CategoryBreakdownEntry[] = [];
  let uncategorizedEntry: CategoryBreakdownEntry | undefined;

  for (const [categoryId, { totalMinor, transactionIds }] of byCategory) {
    if (categoryId === null) {
      uncategorizedEntry = {
        categoryId: null,
        label: UNCATEGORIZED_LABEL,
        totalMinor,
        transactionCount: transactionIds.size,
      };
    } else {
      categorized.push({ categoryId, label: categoryId, totalMinor, transactionCount: transactionIds.size });
    }
  }

  categorized.sort(
    (a, b) => b.totalMinor - a.totalMinor || a.categoryId!.localeCompare(b.categoryId!)
  );

  const entries: CategoryBreakdownEntry[] = uncategorizedEntry
    ? [...categorized, uncategorizedEntry]
    : categorized;

  return { yearMonth, entries };
}

function includesFlow(amountMinor: number, flow: CategoryBreakdownFlow): boolean {
  if (flow === "all") return true;
  return flow === "inflows" ? amountMinor > 0 : amountMinor < 0;
}
