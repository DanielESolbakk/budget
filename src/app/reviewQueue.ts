import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import { orderReviewQueueTransactions } from "../domain/categorization/reviewQueue.js";

export function listCategorizationReviewQueue(
  database: Pick<LocalLedgerDatabase, "loadLedgerSnapshotData">,
  householdId: string
) {
  const reviewTransactions = database.loadLedgerSnapshotData().transactions.filter((transaction) =>
    transaction.householdId === householdId &&
    (transaction.categoryId === undefined || transaction.categorization?.requiresReview === true)
  );
  return orderReviewQueueTransactions(reviewTransactions);
}
