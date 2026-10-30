import type { Transaction } from "../types.js";
import { CATEGORIZATION_REVIEW_THRESHOLD } from "./scoreCategorizationConfidence.js";

export function needsCategorizationReview(transaction: Transaction): boolean {
  return !(transaction.categoryAllocations?.length) &&
    (transaction.categoryId === undefined ||
      (transaction.categorization !== undefined &&
        transaction.categorization.confidence < CATEGORIZATION_REVIEW_THRESHOLD));
}

export function orderReviewQueueTransactions(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort((left, right) =>
    (left.categorization?.confidence ?? 0) - (right.categorization?.confidence ?? 0) ||
    left.id.localeCompare(right.id)
  );
}
