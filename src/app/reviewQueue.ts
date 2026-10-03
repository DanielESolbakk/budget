import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import { orderReviewQueueTransactions } from "../domain/categorization/reviewQueue.js";

export function listUncategorizedReviewQueue(
  database: Pick<LocalLedgerDatabase, "loadLedgerSnapshotData">
) {
  const uncategorizedTransactions = database
    .loadLedgerSnapshotData()
    .transactions
    .filter((transaction) => transaction.categoryId === undefined);

  return orderReviewQueueTransactions(uncategorizedTransactions);
}
