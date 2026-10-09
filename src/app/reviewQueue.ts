import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import { orderReviewQueueTransactions } from "../domain/categorization/reviewQueue.js";
import { normalizeMerchantName } from "../domain/merchant/normalizeMerchantName.js";
import type {
  SameMerchantPropagationInput,
  SameMerchantPropagationOperation,
  SameMerchantPropagationPreview,
} from "../domain/types.js";

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

export function previewSameMerchantPropagation(
  database: Pick<
    LocalLedgerDatabase,
    | "getTransactionById"
    | "listMerchantCorrectionProvenance"
    | "listMerchantCategoryRules"
    | "listUncategorizedTransactions"
    | "getAccountsForHousehold"
  >,
  sourceTransactionId: string
): SameMerchantPropagationPreview {
  const sourceTransaction = database.getTransactionById(sourceTransactionId);
  if (sourceTransaction?.categoryId === undefined) {
    throw new Error(`Corrected source transaction not found: ${sourceTransactionId}`);
  }

  const merchantAlias = normalizeMerchantName(sourceTransaction.merchantRaw);
  const hasMatchingCorrection = database.listMerchantCorrectionProvenance().some((correction) =>
    correction.sourceTransactionId === sourceTransactionId &&
    correction.merchantAlias === merchantAlias &&
    correction.categoryId === sourceTransaction.categoryId
  );
  const currentRule = database.listMerchantCategoryRules().find((rule) =>
    rule.merchantAlias === merchantAlias
  );
  if (!hasMatchingCorrection || currentRule?.categoryId !== sourceTransaction.categoryId) {
    throw new Error(`Current source correction not found: ${sourceTransactionId}`);
  }

  const accountNames = new Map(
    database.getAccountsForHousehold(sourceTransaction.householdId).map((account) => [account.id, account.name])
  );
  const candidates = database.listUncategorizedTransactions(sourceTransaction.householdId)
    .filter((transaction) =>
      transaction.id !== sourceTransaction.id &&
      transaction.householdId === sourceTransaction.householdId &&
      transaction.categoryId === undefined &&
      normalizeMerchantName(transaction.merchantRaw) === merchantAlias
    )
    .sort((left, right) =>
      left.bookedAtIso.localeCompare(right.bookedAtIso) || left.id.localeCompare(right.id)
    )
    .map((transaction) => ({
      transactionId: transaction.id,
      bookedAtIso: transaction.bookedAtIso,
      merchantRaw: transaction.merchantRaw,
      accountName: accountNames.get(transaction.accountId) ?? transaction.accountId,
      amountMinor: transaction.amountMinor,
      proposedCategoryId: sourceTransaction.categoryId!,
    }));

  return {
    sourceTransactionId,
    merchantAlias,
    categoryId: sourceTransaction.categoryId,
    candidates,
  };
}

export function applySameMerchantPropagation(
  database: Pick<
    LocalLedgerDatabase,
    | "getTransactionById"
    | "listMerchantCorrectionProvenance"
    | "listMerchantCategoryRules"
    | "listUncategorizedTransactions"
    | "getAccountsForHousehold"
    | "applySameMerchantPropagation"
  >,
  input: SameMerchantPropagationInput
): SameMerchantPropagationOperation {
  if (input.transactionIds.length === 0) {
    throw new Error("At least one transaction must be selected for propagation.");
  }
  if (new Set(input.transactionIds).size !== input.transactionIds.length) {
    throw new Error("Propagation transaction IDs must be unique.");
  }

  const preview = previewSameMerchantPropagation(database, input.sourceTransactionId);
  if (preview.merchantAlias !== input.merchantAlias || preview.categoryId !== input.categoryId) {
    throw new Error("Propagation details do not match the current source correction.");
  }

  const candidateIds = new Set(preview.candidates.map((candidate) => candidate.transactionId));
  for (const transactionId of input.transactionIds) {
    if (!candidateIds.has(transactionId)) {
      throw new Error(`Transaction is not in the current same-merchant preview: ${transactionId}`);
    }
  }

  return database.applySameMerchantPropagation(input);
}

export function undoSameMerchantPropagation(
  database: Pick<LocalLedgerDatabase, "undoSameMerchantPropagation">,
  operationId: string
): boolean {
  if (operationId.trim().length === 0) {
    throw new Error("operationId must be a non-empty string.");
  }
  return database.undoSameMerchantPropagation(operationId);
}
