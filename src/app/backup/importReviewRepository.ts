import { merchantSearchValue, serializeTransactionCategoryAllocations } from "./ledgerTransactionRows.js";
import { DatabaseSync } from "node:sqlite";
import { transactionBookingTimeMillis } from "../../domain/ledger/filterTransactions.js";
import type {
  ImportReviewItem,
  SourceDocumentTextLineEvidence,
  SourceTextLineClassification,
  SourceTextLineEvidence,
  SourceTextItemEvidence,
  Transaction,
} from "../../domain/types.js";
import { persistTransactionBaseline } from "./importJobPersistence.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type ReviewTransactionReader = Pick<LocalLedgerDatabase,
  | "getTransactionById"
>;
type ImportReviewRepository = Pick<LocalLedgerDatabase,
  | "listImportReviewItems"
  | "completeImportReviewCorrection"
  | "completeImportReviewDismissal"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceTextItemEvidence(value: unknown): value is SourceTextItemEvidence {
  if (!isRecord(value)) return false;
  return typeof value.text === "string" &&
    typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y);
}

function isSourceTextLineClassification(value: unknown): value is SourceTextLineClassification {
  return value === "document-metadata" ||
    value === "column-header" ||
    value === "transaction" ||
    value === "continuation" ||
    value === "document-decoration" ||
    value === "unclassified";
}

function isSourceTextLineEvidence(value: unknown): value is SourceTextLineEvidence {
  if (!isRecord(value)) return false;
  return typeof value.pageNumber === "number" && Number.isSafeInteger(value.pageNumber) && value.pageNumber > 0 &&
    typeof value.lineNumber === "number" && Number.isSafeInteger(value.lineNumber) && value.lineNumber > 0 &&
    typeof value.startOffset === "number" && Number.isSafeInteger(value.startOffset) && value.startOffset >= 0 &&
    typeof value.endOffset === "number" && Number.isSafeInteger(value.endOffset) &&
      value.endOffset >= value.startOffset &&
    typeof value.rawText === "string" &&
    (value.classification === undefined || isSourceTextLineClassification(value.classification)) &&
    (value.items === undefined || (
      Array.isArray(value.items) && value.items.every(isSourceTextItemEvidence)
    ));
}

function isSourceDocumentTextLineEvidence(
  value: unknown
): value is SourceDocumentTextLineEvidence {
  if (!isRecord(value)) return false;
  return typeof value.pageNumber === "number" &&
    Number.isSafeInteger(value.pageNumber) &&
    value.pageNumber > 0 &&
    Array.isArray(value.sourceLines) &&
    value.sourceLines.every((line) =>
      isSourceTextLineEvidence(line) && line.pageNumber === value.pageNumber
    );
}

function mapImportReviewItemRow(row: Record<string, unknown>): ImportReviewItem {
  const requiredString = (column: string): string => {
    const value = row[column];
    if (typeof value !== "string") {
      throw new Error(`Invalid import review item ${column} value.`);
    }
    return value;
  };
  const optionalString = (column: string): string | undefined => {
    const value = row[column];
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new Error(`Invalid import review item ${column} value.`);
    }
    return value;
  };
  const sourceType = requiredString("source_type");
  if (sourceType !== "csv" && sourceType !== "pdf") {
    throw new Error(`Invalid import review source type: ${sourceType}`);
  }
  const status = requiredString("status");
  if (status !== "unresolved" && status !== "corrected" && status !== "dismissed") {
    throw new Error(`Invalid import review status: ${status}`);
  }
  const sourceRowIndex = row.source_row_index;
  if (typeof sourceRowIndex !== "number" || !Number.isSafeInteger(sourceRowIndex)) {
    throw new Error("Invalid import review item source row index.");
  }
  const parserErrorsJson = requiredString("parser_errors_json");
  const parserErrors: unknown = JSON.parse(parserErrorsJson);
  if (!Array.isArray(parserErrors) || !parserErrors.every((error) =>
    typeof error === "object" && error !== null &&
      "code" in error && typeof error.code === "string" &&
      "message" in error && typeof error.message === "string" &&
      (!("field" in error) || typeof error.field === "string")
  )) {
    throw new Error("Invalid import review item parser diagnostics.");
  }
  const sourceEvidenceJson = optionalString("source_evidence_json");
  const sourceEvidence: unknown = sourceEvidenceJson === undefined
    ? undefined
    : JSON.parse(sourceEvidenceJson);
  if (sourceEvidence !== undefined && !isSourceDocumentTextLineEvidence(sourceEvidence)) {
    throw new Error("Invalid import review item source evidence.");
  }
  const correctedAtIso = optionalString("corrected_at_iso");
  const correctedTransactionId = optionalString("corrected_transaction_id");
  const correctionJson = optionalString("correction_json");
  const dismissalReason = optionalString("dismissal_reason");
  const dismissedAtIso = optionalString("dismissed_at_iso");

  return {
    id: requiredString("id"),
    importJobId: requiredString("import_job_id"),
    householdId: requiredString("household_id"),
    accountId: requiredString("account_id"),
    sourceType,
    sourceName: requiredString("source_name"),
    sourceIdentity: requiredString("source_identity"),
    sourceRowIndex,
    ...(sourceEvidence === undefined ? {} : { sourceEvidence }),
    rawRow: requiredString("raw_row"),
    parserErrors,
    status,
    createdAtIso: requiredString("created_at_iso"),
    updatedAtIso: requiredString("updated_at_iso"),
    ...(correctedAtIso === undefined ? {} : { correctedAtIso }),
    ...(correctedTransactionId === undefined ? {} : { correctedTransactionId }),
    ...(correctionJson === undefined ? {} : { correctionJson }),
    ...(dismissalReason === undefined ? {} : { dismissalReason }),
    ...(dismissedAtIso === undefined ? {} : { dismissedAtIso }),
  };
}

export function createImportReviewRepository(db: DatabaseSync, readers: ReviewTransactionReader): ImportReviewRepository {
  const { getTransactionById } = readers;

  function listImportReviewItems(householdId: string): ImportReviewItem[] {
    return (
      db.prepare(`
        SELECT id, import_job_id, household_id, account_id, source_type, source_name, source_identity,
          source_row_index, source_evidence_json, raw_row, parser_errors_json, status, created_at_iso, updated_at_iso,
          corrected_at_iso, corrected_transaction_id, correction_json, dismissal_reason, dismissed_at_iso
        FROM import_review_items
        WHERE household_id = ?
        ORDER BY created_at_iso, id
      `).all(householdId)
    ).map(mapImportReviewItemRow);
  }

  function getImportReviewItemById(reviewItemId: string): ImportReviewItem | undefined {
    const row = db.prepare(`
      SELECT id, import_job_id, household_id, account_id, source_type, source_name, source_identity,
        source_row_index, source_evidence_json, raw_row, parser_errors_json, status, created_at_iso, updated_at_iso,
        corrected_at_iso, corrected_transaction_id, correction_json, dismissal_reason, dismissed_at_iso
      FROM import_review_items
      WHERE id = ?
    `).get(reviewItemId);
    return row === undefined ? undefined : mapImportReviewItemRow(row);
  }

  function completeImportReviewCorrection(
    reviewItemId: string,
    transaction: Transaction,
    correctionJson: string,
    correctedAtIso: string
  ): { item: ImportReviewItem; transaction: Transaction } {
    db.exec("BEGIN");
    try {
      const reviewItem = getImportReviewItemById(reviewItemId);
      if (reviewItem === undefined) {
        throw new Error(`Import review item not found: ${reviewItemId}`);
      }
      if (
        reviewItem.importJobId !== transaction.importJobId ||
        reviewItem.householdId !== transaction.householdId ||
        reviewItem.sourceType !== transaction.sourceType
      ) {
        throw new Error("Corrected transaction provenance does not match the import review item.");
      }
      if (reviewItem.status === "corrected") {
        if (reviewItem.correctionJson !== correctionJson || reviewItem.correctedTransactionId === undefined) {
          throw new Error(`Import review item has already been corrected: ${reviewItemId}`);
        }
        const existingTransaction = getTransactionById(reviewItem.correctedTransactionId);
        if (existingTransaction === undefined) {
          throw new Error(`Corrected transaction is missing: ${reviewItem.correctedTransactionId}`);
        }
        db.exec("COMMIT");
        return { item: reviewItem, transaction: existingTransaction };
      }
      if (reviewItem.status !== "unresolved") {
        throw new Error(`Import review item is already resolved: ${reviewItemId}`);
      }

      const result = db.prepare(`
        INSERT OR IGNORE INTO transactions (
          id, household_id, account_id, booked_at_iso, booked_at_millis, amount_minor, merchant_raw, merchant_search,
          currency_code, source_type, source_reference, category_id, import_job_id, categorization_json,
          category_allocations_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transaction.id,
        transaction.householdId,
        transaction.accountId,
        transaction.bookedAtIso,
        transactionBookingTimeMillis(transaction.bookedAtIso),
        transaction.amountMinor,
        transaction.merchantRaw,
        merchantSearchValue(transaction),
        transaction.currencyCode ?? null,
        transaction.sourceType ?? null,
        transaction.sourceReference ?? null,
        transaction.categoryId ?? null,
        transaction.importJobId ?? null,
        transaction.categorization === undefined ? null : JSON.stringify(transaction.categorization),
        serializeTransactionCategoryAllocations(transaction)
      ) as { changes: number | bigint };
      if (Number(result.changes) !== 1) {
        throw new Error(`Corrected transaction already exists: ${transaction.id}`);
      }

      const updateResult = db.prepare(`
        UPDATE import_review_items
        SET status = 'corrected', updated_at_iso = ?, corrected_at_iso = ?,
          corrected_transaction_id = ?, correction_json = ?
        WHERE id = ? AND status = 'unresolved'
      `).run(correctedAtIso, correctedAtIso, transaction.id, correctionJson, reviewItemId) as { changes: number | bigint };
      if (Number(updateResult.changes) !== 1) {
        throw new Error(`Import review item changed while correcting: ${reviewItemId}`);
      }

      const operationResult = db.prepare(`
        UPDATE import_job_operations
        SET candidate_count = candidate_count + 1, imported_count = imported_count + 1
        WHERE import_job_id = ?
      `).run(reviewItem.importJobId) as { changes: number | bigint };
      if (Number(operationResult.changes) !== 1) {
        throw new Error(`Import job history not found for review item: ${reviewItemId}`);
      }
      persistTransactionBaseline(db, reviewItem.importJobId, transaction);

      const updatedItem = getImportReviewItemById(reviewItemId);
      const savedTransaction = getTransactionById(transaction.id);
      if (updatedItem === undefined || savedTransaction === undefined) {
        throw new Error(`Corrected import review item could not be reloaded: ${reviewItemId}`);
      }

      db.exec("COMMIT");
      return { item: updatedItem, transaction: savedTransaction };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function completeImportReviewDismissal(
    reviewItemId: string,
    reason: string,
    dismissedAtIso: string
  ): ImportReviewItem {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new Error("A dismissal reason is required.");

    db.exec("BEGIN");
    try {
      const reviewItem = getImportReviewItemById(reviewItemId);
      if (reviewItem === undefined) {
        throw new Error(`Import review item not found: ${reviewItemId}`);
      }
      if (reviewItem.status === "dismissed") {
        if (reviewItem.dismissalReason !== normalizedReason) {
          throw new Error(`Import review item has already been dismissed: ${reviewItemId}`);
        }
        db.exec("COMMIT");
        return reviewItem;
      }
      if (reviewItem.status !== "unresolved") {
        throw new Error(`Import review item is already resolved: ${reviewItemId}`);
      }

      const result = db.prepare(`
        UPDATE import_review_items
        SET status = 'dismissed', updated_at_iso = ?, dismissal_reason = ?, dismissed_at_iso = ?
        WHERE id = ? AND status = 'unresolved'
      `).run(dismissedAtIso, normalizedReason, dismissedAtIso, reviewItemId) as { changes: number | bigint };
      if (Number(result.changes) !== 1) {
        throw new Error(`Import review item changed while dismissing: ${reviewItemId}`);
      }

      const updatedItem = getImportReviewItemById(reviewItemId);
      if (updatedItem === undefined) {
        throw new Error(`Dismissed import review item could not be reloaded: ${reviewItemId}`);
      }

      db.exec("COMMIT");
      return updatedItem;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    listImportReviewItems,
    completeImportReviewCorrection,
    completeImportReviewDismissal,
  };
}
