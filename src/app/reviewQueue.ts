import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import { orderReviewQueueTransactions } from "../domain/categorization/reviewQueue.js";

export function listUncategorizedReviewQueue(
  database: Pick<LocalLedgerDatabase, "listUncategorizedTransactions">,
  householdId: string
) {
  return orderReviewQueueTransactions(database.listUncategorizedTransactions(householdId));
}
