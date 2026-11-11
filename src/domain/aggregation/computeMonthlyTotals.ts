import type { MonthlyBreakdown, Transaction } from "../types.js";
import { isIsoCalendarDate } from "../date/calendarDate.js";

export interface DateRangeTotals {
  startDateIso: string;
  endDateExclusiveIso: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
}

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

export function computeDateRangeTotals(
  transactions: Transaction[],
  startDateIso: string,
  endDateExclusiveIso: string
): DateRangeTotals {
  if (!isIsoCalendarDate(startDateIso) || !isIsoCalendarDate(endDateExclusiveIso)) {
    throw new RangeError("Reporting range boundaries must be valid calendar dates.");
  }
  if (startDateIso >= endDateExclusiveIso) {
    throw new RangeError("Reporting range end must be after its start.");
  }

  let incomeMinor = 0;
  let expenseMinor = 0;

  for (const tx of transactions) {
    const bookedDateIso = tx.bookedAtIso.slice(0, 10);
    if (!isIsoCalendarDate(bookedDateIso)) {
      throw new RangeError(`Transaction has an invalid booked date: ${tx.id}`);
    }
    if (bookedDateIso < startDateIso || bookedDateIso >= endDateExclusiveIso) continue;

    if (tx.amountMinor >= 0) {
      incomeMinor += tx.amountMinor;
    } else {
      expenseMinor += Math.abs(tx.amountMinor);
    }
  }

  return {
    startDateIso,
    endDateExclusiveIso,
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
  };
}
