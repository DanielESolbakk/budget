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

  const byCategory = new Map<string | null, { totalMinor: number; transactionIds: Set<string> }>();

  for (const tx of monthTxs) {
    const categoryAmounts = tx.categoryAllocations?.length
      ? tx.categoryAllocations
      : [{ categoryId: tx.categoryId ?? null, amountMinor: tx.amountMinor }];

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
