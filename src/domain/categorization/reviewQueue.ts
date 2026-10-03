import type { Transaction } from "../types.js";

export function orderReviewQueueTransactions(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort((left, right) =>
    left.bookedAtIso.slice(0, 10).localeCompare(right.bookedAtIso.slice(0, 10)) ||
    left.id.localeCompare(right.id)
  );
}
