import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import { categorizeTransaction } from "../domain/categorization/categorizeTransaction.js";
import { orderReviewQueueTransactions } from "../domain/categorization/reviewQueue.js";
import { validateCorrectionCategoryId } from "../domain/review/correction.js";
import { normalizeMerchantName } from "../domain/merchant/normalizeMerchantName.js";
import type { Transaction } from "../domain/types.js";

export function listCategorizationReviewQueue(
  database: Pick<LocalLedgerDatabase, "loadLedgerSnapshotData">,
  householdId: string
): Transaction[] {
  const reviewTransactions = database.loadLedgerSnapshotData().transactions.filter((transaction) =>
    transaction.householdId === householdId &&
    (transaction.categoryId === undefined || transaction.categorization?.requiresReview === true)
  );
  return orderReviewQueueTransactions(reviewTransactions);
}

export function applyCategorizationCorrection(
  database: Pick<
    LocalLedgerDatabase,
    "getTransactionById" | "loadLedgerSnapshotData" | "updateTransactionCategoryAndRule"
  >,
  learnedCategoryRules: Map<string, string>,
  transactionId: string,
  categoryId: string
): { transaction: Transaction; futureMatchingChanged: boolean } {
  validateCorrectionCategoryId(categoryId);
  const transaction = database.getTransactionById(transactionId);
  if (transaction === undefined) {
    throw new Error(`Transaction not found: ${transactionId}`);
  }

  const merchantAlias = normalizeMerchantName(transaction.merchantRaw);
  const futureMatchingChanged = learnedCategoryRules.get(merchantAlias) !== categoryId;
  const updatedLearnedCategoryRules = new Map(learnedCategoryRules);
  updatedLearnedCategoryRules.set(merchantAlias, categoryId);
  const uncategorizedTransaction = { ...transaction };
  delete uncategorizedTransaction.categoryId;
  const correctedCategorization = categorizeTransaction(
    uncategorizedTransaction,
    updatedLearnedCategoryRules
  ).categorization;
  if (correctedCategorization === undefined) {
    throw new Error("Corrected transaction did not produce categorization metadata.");
  }

  database.updateTransactionCategoryAndRule(
    transactionId,
    { merchantAlias, categoryId },
    correctedCategorization
  );
  learnedCategoryRules.set(merchantAlias, categoryId);

  const correctedTransaction = database.loadLedgerSnapshotData().transactions.find((entry) =>
    entry.id === transactionId
  );
  if (correctedTransaction === undefined) {
    throw new Error(`Transaction not found after correction: ${transactionId}`);
  }

  return { transaction: correctedTransaction, futureMatchingChanged };
}