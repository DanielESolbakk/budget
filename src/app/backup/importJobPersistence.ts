import { DatabaseSync } from "node:sqlite";
import type { ImportJob, Transaction } from "../../domain/types.js";

export function serializeTransactionForUndo(transaction: Transaction): string {
  return JSON.stringify({
    id: transaction.id,
    householdId: transaction.householdId,
    accountId: transaction.accountId,
    bookedAtIso: transaction.bookedAtIso,
    amountMinor: transaction.amountMinor,
    merchantRaw: transaction.merchantRaw,
    currencyCode: transaction.currencyCode ?? null,
    sourceType: transaction.sourceType ?? null,
    sourceReference: transaction.sourceReference ?? null,
    categoryId: transaction.categoryId ?? null,
    categoryAllocations: transaction.categoryAllocations ?? null,
    importJobId: transaction.importJobId ?? null,
  });
}

export function persistImportJobOperation(
  db: DatabaseSync,
  importJob: ImportJob,
  importedTransactions: Transaction[],
  importedPendingCount = 0
): void {
  const accountId = importJob.provenance?.accountId ?? importedTransactions[0]?.accountId ?? null;
  const candidateCount = importJob.candidateCount ?? importedTransactions.length;
  const duplicateCount = importJob.provenance?.duplicateCount ?? 0;
  db.prepare(`
    INSERT INTO import_job_operations (
      import_job_id, household_id, account_id, candidate_count, imported_count, duplicate_count
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(import_job_id) DO UPDATE SET
      household_id = excluded.household_id,
      account_id = COALESCE(excluded.account_id, import_job_operations.account_id),
      candidate_count = excluded.candidate_count,
      imported_count = MAX(import_job_operations.imported_count, excluded.imported_count),
      duplicate_count = excluded.duplicate_count
  `).run(
    importJob.id,
    importJob.householdId,
    accountId,
    candidateCount,
    importedTransactions.length + importedPendingCount,
    duplicateCount
  );
}

export function persistTransactionBaseline(db: DatabaseSync, importJobId: string, transaction: Transaction): void {
  db.prepare(
    "INSERT OR REPLACE INTO import_job_transaction_baselines (import_job_id, transaction_id, baseline_json) VALUES (?, ?, ?)"
  ).run(importJobId, transaction.id, serializeTransactionForUndo(transaction));
}
