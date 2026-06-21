import type { MonthlyBreakdown, Transaction } from "../types.js";

/**
 * Computes deterministic income, expense, and net totals for a given calendar month
 * from a flat list of transactions.
 *
 * Positive amountMinor values count as income; negative values count as expense.
 * Only transactions whose bookedAtIso starts with the given YYYY-MM prefix are included.
 */
export function computeMonthlyTotals(
  transactions: Transaction[],
  yearMonth: string
): MonthlyBreakdown {
  let incomeMinor = 0;
  let expenseMinor = 0;

  for (const tx of transactions) {
    if (!tx.bookedAtIso.startsWith(yearMonth)) continue;
    if (tx.amountMinor >= 0) {
      incomeMinor += tx.amountMinor;
    } else {
      expenseMinor += Math.abs(tx.amountMinor);
    }
  }

  return {
    yearMonth,
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
  };
}
