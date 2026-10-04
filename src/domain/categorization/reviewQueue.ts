import type { Transaction } from "../types.js";

export function orderReviewQueueTransactions(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort((left, right) =>
    (left.categorization?.confidence ?? 0) - (right.categorization?.confidence ?? 0) ||
    left.id.localeCompare(right.id)
  );
}
