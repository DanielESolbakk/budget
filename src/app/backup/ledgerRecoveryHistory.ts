import type { DatabaseSync } from "node:sqlite";
import type { LedgerRecoveryHistory } from "../../domain/backup/snapshotContract.js";
import { createCorrectionRepository } from "./correctionRepository.js";
import { validateRecoveryHistory } from "./snapshotHistoryValidation.js";

export function readLedgerRecoveryHistory(
  database: DatabaseSync,
  householdId: string,
  accountIds: Set<string>,
  importJobIds: Set<string>,
  categoryIds: readonly string[],
  transactionIds: Set<string>,
): LedgerRecoveryHistory {
  const corrections = createCorrectionRepository(database);
  const baselines = database.prepare(`SELECT import_job_id, transaction_id, baseline_json
    FROM import_job_transaction_baselines ORDER BY import_job_id, transaction_id`).all();
  const importRows = database.prepare(`SELECT import_job_id, account_id, candidate_count, imported_count,
    duplicate_count, undone_at_iso, undo_removed_count, undo_retained_count, undo_available
    FROM import_job_operations ORDER BY import_job_id`).all();
  const operationIds = new Set(importRows.map((row) => row.import_job_id));
  const baselinesByImport = new Map<string, Array<{ transactionId: unknown; serializedTransaction: unknown }>>();
  for (const baseline of baselines) {
    if (typeof baseline.import_job_id !== "string" || !operationIds.has(baseline.import_job_id)) {
      throw new Error("Invalid saved import baseline: missing import operation.");
    }
    const entries = baselinesByImport.get(baseline.import_job_id) ?? [];
    entries.push({ transactionId: baseline.transaction_id, serializedTransaction: baseline.baseline_json });
    baselinesByImport.set(baseline.import_job_id, entries);
  }
  const importOperations = importRows.map((row) => {
    if (typeof row.import_job_id !== "string") throw new Error("Invalid saved import operation identity.");
    if (row.undo_available !== 0 && row.undo_available !== 1) throw new Error("Invalid saved import undo availability.");
    return {
      importJobId: row.import_job_id,
      ...(row.account_id === null ? {} : { accountId: row.account_id }),
      candidateCount: row.candidate_count, importedCount: row.imported_count, duplicateCount: row.duplicate_count,
      undoRemovedCount: row.undo_removed_count, undoRetainedCount: row.undo_retained_count,
      undoAvailable: row.undo_available === 1,
      ...(row.undone_at_iso === null ? {} : { undoneAtIso: row.undone_at_iso }),
      transactionBaselines: baselinesByImport.get(row.import_job_id) ?? [],
    };
  });
  return validateRecoveryHistory({
    merchantCorrections: corrections.listMerchantCorrectionProvenance(),
    transactionCategoryEdits: corrections.listTransactionCategoryEdits(),
    sameMerchantPropagations: corrections.listSameMerchantPropagationOperations(),
    importOperations,
  }, householdId, accountIds, importJobIds, categoryIds, "local ledger", transactionIds);
}

export function insertLedgerRecoveryHistory(database: DatabaseSync, history: LedgerRecoveryHistory): void {
  const insertCorrection = database.prepare(`INSERT INTO merchant_correction_provenance (
    id, source_transaction_id, merchant_alias, category_id, actor, corrected_at_iso, original_categorization_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const correction of history.merchantCorrections) {
    insertCorrection.run(correction.id, correction.sourceTransactionId, correction.merchantAlias,
      correction.categoryId, correction.actor, correction.correctedAtIso,
      correction.originalCategorization === undefined ? null : JSON.stringify(correction.originalCategorization));
  }
  const insertCategoryEdit = database.prepare(`INSERT INTO transaction_category_edit_provenance (
    id, source_transaction_id, merchant_alias, mode, category_id, allocations_json,
    previous_category_id, previous_allocations_json, remember_for_merchant,
    merchant_rule_effect, actor, corrected_at_iso
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const edit of history.transactionCategoryEdits) {
    insertCategoryEdit.run(
      edit.id,
      edit.sourceTransactionId,
      edit.merchantAlias,
      edit.mode,
      edit.categoryId ?? null,
      edit.allocations === undefined ? null : JSON.stringify(edit.allocations),
      edit.previousCategoryId ?? null,
      edit.previousAllocations === undefined ? null : JSON.stringify(edit.previousAllocations),
      edit.rememberForMerchant ? 1 : 0,
      edit.merchantRuleEffect,
      edit.actor,
      edit.correctedAtIso
    );
  }
  const insertPropagation = database.prepare(`INSERT INTO same_merchant_propagation_operations (
    id, source_transaction_id, merchant_alias, category_id, applied_at_iso, undone_at_iso
  ) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertChange = database.prepare(`INSERT INTO same_merchant_propagation_changes (
    operation_id, transaction_id, before_category_id, after_category_id,
    before_categorization_json, after_categorization_json
  ) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const operation of history.sameMerchantPropagations) {
    insertPropagation.run(operation.id, operation.sourceTransactionId, operation.merchantAlias,
      operation.categoryId, operation.appliedAtIso, operation.undoneAtIso ?? null);
    for (const change of operation.changes) {
      insertChange.run(operation.id, change.transactionId, change.beforeCategoryId, change.afterCategoryId,
        change.beforeCategorization === undefined ? null : JSON.stringify(change.beforeCategorization),
        change.afterCategorization === undefined ? null : JSON.stringify(change.afterCategorization));
    }
  }
  const insertImport = database.prepare(`INSERT INTO import_job_operations (
    import_job_id, household_id, account_id, candidate_count, imported_count, duplicate_count,
    undone_at_iso, undo_removed_count, undo_retained_count, undo_available
  ) VALUES (?, (SELECT household_id FROM import_jobs WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertBaseline = database.prepare(`INSERT INTO import_job_transaction_baselines (
    import_job_id, transaction_id, baseline_json
  ) VALUES (?, ?, ?)`);
  for (const operation of history.importOperations) {
    insertImport.run(operation.importJobId, operation.importJobId, operation.accountId ?? null,
      operation.candidateCount, operation.importedCount, operation.duplicateCount, operation.undoneAtIso ?? null,
      operation.undoRemovedCount, operation.undoRetainedCount, operation.undoAvailable ? 1 : 0);
    for (const baseline of operation.transactionBaselines) {
      insertBaseline.run(operation.importJobId, baseline.transactionId, baseline.serializedTransaction);
    }
  }
}
