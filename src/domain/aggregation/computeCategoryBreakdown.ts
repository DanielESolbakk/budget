import type { CategoryBreakdown, CategoryBreakdownEntry, Transaction } from "../types.js";

export const UNCATEGORIZED_LABEL = "Uncategorized";

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
  yearMonth: string
): CategoryBreakdown {
  const monthTxs = transactions.filter(tx => tx.bookedAtIso.startsWith(yearMonth));

  const byCategory = new Map<string | null, { totalMinor: number; transactionCount: number }>();

  for (const tx of monthTxs) {
    const key = tx.categoryId ?? null;
    const acc = byCategory.get(key) ?? { totalMinor: 0, transactionCount: 0 };
    acc.totalMinor += Math.abs(tx.amountMinor);
    acc.transactionCount += 1;
    byCategory.set(key, acc);
  }

  const categorized: CategoryBreakdownEntry[] = [];
  let uncategorizedEntry: CategoryBreakdownEntry | undefined;

  for (const [categoryId, { totalMinor, transactionCount }] of byCategory) {
    if (categoryId === null) {
      uncategorizedEntry = {
        categoryId: null,
        label: UNCATEGORIZED_LABEL,
        totalMinor,
        transactionCount,
      };
    } else {
      categorized.push({ categoryId, label: categoryId, totalMinor, transactionCount });
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
