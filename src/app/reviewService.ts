import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import { categorizeTransaction } from "../domain/categorization/categorizeTransaction.js";
import { detectDuplicate } from "../domain/import/detectDuplicate.js";
import { orderReviewQueueTransactions } from "../domain/categorization/reviewQueue.js";
import { CATEGORIZATION_REVIEW_THRESHOLD } from "../domain/categorization/scoreCategorizationConfidence.js";
import { validateCorrectionCategoryId } from "../domain/review/correction.js";
import { normalizeMerchantName } from "../domain/merchant/normalizeMerchantName.js";
import {
  validateImportReviewCorrectionInput,
  type ImportReviewCorrectionInput,
  type ImportReviewCorrectionValidationError,
  type ImportReviewItem,
  type Transaction,
} from "../domain/types.js";

export function listCategorizationReviewQueue(
  database: Pick<LocalLedgerDatabase, "loadLedgerSnapshotData">,
  householdId: string
): Transaction[] {
  const reviewTransactions = database.loadLedgerSnapshotData().transactions.filter((transaction) =>
    transaction.householdId === householdId &&
    (transaction.categoryId === undefined ||
      (transaction.categorization !== undefined &&
        transaction.categorization.confidence < CATEGORIZATION_REVIEW_THRESHOLD))
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

export type ImportReviewActionFailureCode =
  | "IMPORT_REVIEW_ITEM_NOT_FOUND"
  | "IMPORT_REVIEW_ITEM_ALREADY_RESOLVED"
  | "IMPORT_REVIEW_VALIDATION_FAILED"
  | "IMPORT_REVIEW_DUPLICATE_TRANSACTION"
  | "IMPORT_REVIEW_CORRECTED_TRANSACTION_MISSING"
  | "IMPORT_REVIEW_DISMISSAL_REASON_REQUIRED";

export type ImportReviewCorrectionResult =
  | { ok: true; item: ImportReviewItem; transaction: Transaction }
  | {
      ok: false;
      code: ImportReviewActionFailureCode;
      message: string;
      errors?: ImportReviewCorrectionValidationError[];
      matchingTransactionId?: string;
    };

export type ImportReviewDismissalResult =
  | { ok: true; item: ImportReviewItem }
  | { ok: false; code: ImportReviewActionFailureCode; message: string };

export function applyImportReviewCorrection(
  database: Pick<
    LocalLedgerDatabase,
    | "listImportReviewItems"
    | "getAccountsForHousehold"
    | "getTransactionsForAccount"
    | "getTransactionById"
    | "completeImportReviewCorrection"
  >,
  householdId: string,
  reviewItemId: string,
  correction: ImportReviewCorrectionInput,
  correctedAtIso: string,
  categoryRules: ReadonlyMap<string, string> = new Map()
): ImportReviewCorrectionResult {
  const item = database.listImportReviewItems(householdId).find((candidate) =>
    candidate.id === reviewItemId
  );
  if (item === undefined) {
    return {
      ok: false,
      code: "IMPORT_REVIEW_ITEM_NOT_FOUND",
      message: `Import review item not found: ${reviewItemId}`,
    };
  }

  const validation = validateImportReviewCorrectionInput(correction, {
    householdId: item.householdId,
    accounts: database.getAccountsForHousehold(item.householdId),
  });
  if (!validation.ok) {
    return {
      ok: false,
      code: "IMPORT_REVIEW_VALIDATION_FAILED",
      message: "Correct the highlighted fields before saving this transaction.",
      errors: validation.errors,
    };
  }
  const correctionJson = JSON.stringify(validation.value);

  if (item.status === "corrected") {
    if (
      item.correctionJson !== correctionJson ||
      item.correctedTransactionId === undefined
    ) {
      return {
        ok: false,
        code: "IMPORT_REVIEW_ITEM_ALREADY_RESOLVED",
        message: "This import review item has already been resolved.",
      };
    }
    const transaction = database.getTransactionById(item.correctedTransactionId);
    return transaction === undefined
      ? {
          ok: false,
          code: "IMPORT_REVIEW_CORRECTED_TRANSACTION_MISSING",
          message: "The transaction created from this review item is no longer in the ledger.",
        }
      : { ok: true, item, transaction };
  }
  if (item.status !== "unresolved") {
    return {
      ok: false,
      code: "IMPORT_REVIEW_ITEM_ALREADY_RESOLVED",
      message: "This import review item has already been resolved.",
    };
  }

  const transactionDraft: Transaction = {
    id: `import-review-${item.id}`,
    householdId: item.householdId,
    accountId: validation.value.accountId,
    bookedAtIso: validation.value.bookedAtIso,
    amountMinor: validation.value.amountMinor,
    merchantRaw: validation.value.merchantRaw,
    currencyCode: validation.value.currencyCode,
    sourceType: item.sourceType,
    importJobId: item.importJobId,
  };
  const duplicate = detectDuplicate(transactionDraft, database.getTransactionsForAccount(transactionDraft.accountId));
  if (duplicate.isDuplicate) {
    return {
      ok: false,
      code: "IMPORT_REVIEW_DUPLICATE_TRANSACTION",
      message: "A matching transaction already exists in this account.",
      matchingTransactionId: duplicate.matchingTransactionId,
    };
  }

  const transaction = categorizeTransaction(transactionDraft, categoryRules);
  const saved = database.completeImportReviewCorrection(
    reviewItemId,
    transaction,
    correctionJson,
    correctedAtIso
  );
  return { ok: true, item: saved.item, transaction: saved.transaction };
}

export function dismissImportReviewItem(
  database: Pick<LocalLedgerDatabase, "listImportReviewItems" | "completeImportReviewDismissal">,
  householdId: string,
  reviewItemId: string,
  reason: string,
  dismissedAtIso: string
): ImportReviewDismissalResult {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    return {
      ok: false,
      code: "IMPORT_REVIEW_DISMISSAL_REASON_REQUIRED",
      message: "Enter a reason before dismissing this row.",
    };
  }
  const item = database.listImportReviewItems(householdId).find((candidate) =>
    candidate.id === reviewItemId
  );
  if (item === undefined) {
    return {
      ok: false,
      code: "IMPORT_REVIEW_ITEM_NOT_FOUND",
      message: `Import review item not found: ${reviewItemId}`,
    };
  }
  if (item.status === "corrected") {
    return {
      ok: false,
      code: "IMPORT_REVIEW_ITEM_ALREADY_RESOLVED",
      message: "This import review item has already been resolved.",
    };
  }
  if (item.status === "dismissed" && item.dismissalReason !== normalizedReason) {
    return {
      ok: false,
      code: "IMPORT_REVIEW_ITEM_ALREADY_RESOLVED",
      message: "This import review item has already been dismissed with a different reason.",
    };
  }

  return {
    ok: true,
    item: database.completeImportReviewDismissal(reviewItemId, normalizedReason, dismissedAtIso),
  };
}