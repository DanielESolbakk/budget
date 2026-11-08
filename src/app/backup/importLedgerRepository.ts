import { merchantSearchValue, serializeTransactionCategoryAllocations } from "./ledgerTransactionRows.js";
import { DatabaseSync } from "node:sqlite";
import {
  matchPendingTransactionObservations,
  type PendingTransactionMatchCandidate,
} from "../../domain/import/pendingTransactionMatching.js";
import { transactionBookingTimeMillis } from "../../domain/ledger/filterTransactions.js";
import type {
  ImportJob,
  ImportReviewItem,
  PendingTransactionObservation,
  Transaction,
} from "../../domain/types.js";
import { persistImportJobOperation, persistTransactionBaseline } from "./importJobPersistence.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type ImportLedgerRepository = Pick<LocalLedgerDatabase,
  | "appendImportJob"
  | "hasImportJob"
  | "appendTransactions"
  | "appendImportJobAndTransactions"
  | "appendManualEntry"
>;

export function createImportLedgerRepository(db: DatabaseSync): ImportLedgerRepository {
  function appendImportJob(importJob: ImportJob): void {
    db.exec("BEGIN");
    try {
      db.prepare(
      "INSERT OR IGNORE INTO import_jobs (id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        importJob.id,
        importJob.householdId,
        importJob.sourceType,
        importJob.sourceName,
        importJob.adapterId ?? null,
        importJob.candidateCount ?? null,
        importJob.validationFailureCount ?? null,
        importJob.startedAtIso,
        importJob.finishedAtIso ?? null,
        importJob.provenance ? JSON.stringify(importJob.provenance) : null
      );
      persistImportJobOperation(db, importJob, []);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function hasImportJob(importJobId: string): boolean {
    return db.prepare("SELECT 1 FROM import_jobs WHERE id = ?").get(importJobId) !== undefined;
  }

  function appendTransactions(transactions: Transaction[]): number {
    const insertTransaction = db.prepare(
  "INSERT OR IGNORE INTO transactions (id, household_id, account_id, booked_at_iso, booked_at_millis, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json, category_allocations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    let insertedCount = 0;
    const insertedTransactions: Transaction[] = [];
    db.exec("BEGIN");
    try {
      for (const transaction of transactions) {
        const result = insertTransaction.run(
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
        if (Number(result.changes) > 0) {
          insertedCount += Number(result.changes);
          insertedTransactions.push(transaction);
        }
      }
      for (const transaction of insertedTransactions) {
        if (transaction.importJobId === undefined) continue;
        const operation = db.prepare(
          "SELECT 1 FROM import_job_operations WHERE import_job_id = ?"
        ).get(transaction.importJobId);
        if (operation === undefined) continue;
        persistTransactionBaseline(db, transaction.importJobId, transaction);
        db.prepare(`
          UPDATE import_job_operations
          SET imported_count = imported_count + 1,
            candidate_count = MAX(candidate_count, imported_count + 1)
          WHERE import_job_id = ?
        `).run(transaction.importJobId);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return insertedCount;
  }

  function appendImportJobAndTransactions(
    importJob: ImportJob,
    transactions: Transaction[],
    reviewItems: ImportReviewItem[] = [],
    pendingObservations: PendingTransactionObservation[] = []
  ): number {
    const insertImportJob = db.prepare(
      "INSERT OR IGNORE INTO import_jobs (id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertTransaction = db.prepare(
  "INSERT OR IGNORE INTO transactions (id, household_id, account_id, booked_at_iso, booked_at_millis, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json, category_allocations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertReviewItem = db.prepare(`
      INSERT OR IGNORE INTO import_review_items (
        id, import_job_id, household_id, account_id, source_type, source_name, source_identity,
        source_row_index, source_evidence_json, raw_row, parser_errors_json, status, created_at_iso, updated_at_iso,
        corrected_at_iso, corrected_transaction_id, correction_json, dismissal_reason, dismissed_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPendingObservation = db.prepare(`
      INSERT OR IGNORE INTO pending_transaction_observations (
        id, household_id, account_id, transaction_date_iso, amount_minor, merchant_raw,
        source_row_index, currency_code, source_type, source_reference, import_job_id,
        status, source_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const findPendingByReference = db.prepare(`
      SELECT id, household_id, account_id, source_reference, reconciled_transaction_id
      FROM pending_transaction_observations
      WHERE household_id = ? AND account_id = ? AND TRIM(source_reference) = ?
        AND reconciled_transaction_id IS NULL
      ORDER BY id
      LIMIT 2
    `);
    const markPendingReconciled = db.prepare(`
      UPDATE pending_transaction_observations
      SET reconciled_transaction_id = ?, reconciled_at_iso = ?
      WHERE id = ? AND reconciled_transaction_id IS NULL
    `);

    db.exec("BEGIN");
    try {
      insertImportJob.run(
        importJob.id,
        importJob.householdId,
        importJob.sourceType,
        importJob.sourceName,
        importJob.adapterId ?? null,
        importJob.candidateCount ?? null,
        importJob.validationFailureCount ?? null,
        importJob.startedAtIso,
        importJob.finishedAtIso ?? null,
        importJob.provenance ? JSON.stringify(importJob.provenance) : null
      );

      let insertedPendingCount = 0;
      for (const observation of pendingObservations) {
        if (
          observation.householdId !== importJob.householdId ||
          (observation.importJobId !== undefined && observation.importJobId !== importJob.id)
        ) {
          throw new Error("Pending observations must belong to the import job and household being persisted.");
        }
        const accountExists = db.prepare(
          "SELECT 1 FROM accounts WHERE id = ? AND household_id = ?"
        ).get(observation.accountId, observation.householdId);
        if (accountExists === undefined) {
          throw new Error("Pending observation account must belong to its household.");
        }
        const result = insertPendingObservation.run(
          observation.id,
          observation.householdId,
          observation.accountId,
          observation.transactionDateIso,
          observation.amountMinor,
          observation.merchantRaw,
          observation.sourceRowIndex,
          observation.currencyCode ?? null,
          observation.sourceType,
          observation.sourceReference ?? null,
          observation.importJobId ?? null,
          observation.status,
          observation.sourceStatus
        ) as { changes: number | bigint };
        insertedPendingCount += Number(result.changes);
      }

      let insertedCount = 0;
      const insertedTransactions: Transaction[] = [];
      for (const transaction of transactions) {
        const result = insertTransaction.run(
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
        if (Number(result.changes) > 0) {
          insertedCount += Number(result.changes);
          insertedTransactions.push(transaction);
        }
      }

      const pendingCandidates: PendingTransactionMatchCandidate[] = [];
      const queriedReferenceKeys = new Set<string>();
      for (const transaction of transactions) {
        if (transaction.sourceType !== "csv" && transaction.sourceType !== "pdf") continue;
        const sourceReference = transaction.sourceReference?.trim();
        if (!sourceReference) continue;
        const key = JSON.stringify([
          transaction.householdId,
          transaction.accountId,
          sourceReference,
        ]);
        if (queriedReferenceKeys.has(key)) continue;
        queriedReferenceKeys.add(key);
        const pendingRows = findPendingByReference.all(
          transaction.householdId,
          transaction.accountId,
          sourceReference
        ) as Array<{
          id: string;
          household_id: string;
          account_id: string;
          source_reference: string | null;
          reconciled_transaction_id: string | null;
        }>;
        pendingCandidates.push(...pendingRows.map((row) => ({
          id: row.id,
          householdId: row.household_id,
          accountId: row.account_id,
          ...(row.source_reference === null ? {} : { sourceReference: row.source_reference }),
          ...(row.reconciled_transaction_id === null
            ? {}
            : { reconciledTransactionId: row.reconciled_transaction_id }),
        })));
      }

      for (const match of matchPendingTransactionObservations(transactions, pendingCandidates)) {
        markPendingReconciled.run(
          match.transactionId,
          importJob.finishedAtIso ?? importJob.startedAtIso,
          match.pendingObservationId
        );
      }

      for (const reviewItem of reviewItems) {
        if (reviewItem.importJobId !== importJob.id || reviewItem.householdId !== importJob.householdId) {
          throw new Error("Import review items must belong to the import job and household being persisted.");
        }
        insertReviewItem.run(
          reviewItem.id,
          reviewItem.importJobId,
          reviewItem.householdId,
          reviewItem.accountId,
          reviewItem.sourceType,
          reviewItem.sourceName,
          reviewItem.sourceIdentity,
          reviewItem.sourceRowIndex,
          reviewItem.sourceEvidence === undefined ? null : JSON.stringify(reviewItem.sourceEvidence),
          reviewItem.rawRow,
          JSON.stringify(reviewItem.parserErrors),
          reviewItem.status,
          reviewItem.createdAtIso,
          reviewItem.updatedAtIso,
          reviewItem.correctedAtIso ?? null,
          reviewItem.correctedTransactionId ?? null,
          reviewItem.correctionJson ?? null,
          reviewItem.dismissalReason ?? null,
          reviewItem.dismissedAtIso ?? null
        );
      }

      persistImportJobOperation(db, importJob, insertedTransactions, insertedPendingCount);
      for (const transaction of insertedTransactions) {
        persistTransactionBaseline(db, importJob.id, transaction);
      }

      db.exec("COMMIT");
      return insertedCount;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function appendManualEntry(importJob: ImportJob, transaction: Transaction): void {
    const insertImportJob = db.prepare(
      "INSERT INTO import_jobs (id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertTransaction = db.prepare(
  "INSERT INTO transactions (id, household_id, account_id, booked_at_iso, booked_at_millis, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json, category_allocations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    db.exec("BEGIN");
    try {
      insertImportJob.run(
        importJob.id,
        importJob.householdId,
        importJob.sourceType,
        importJob.sourceName,
        importJob.adapterId ?? null,
        importJob.candidateCount ?? null,
        importJob.validationFailureCount ?? null,
        importJob.startedAtIso,
        importJob.finishedAtIso ?? null,
        importJob.provenance ? JSON.stringify(importJob.provenance) : null
      );
      insertTransaction.run(
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
      );
      persistImportJobOperation(db, importJob, [transaction]);
      persistTransactionBaseline(db, importJob.id, transaction);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    appendImportJob,
    hasImportJob,
    appendTransactions,
    appendImportJobAndTransactions,
    appendManualEntry,
  };
}
