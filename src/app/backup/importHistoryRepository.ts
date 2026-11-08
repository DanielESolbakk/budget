import { type TransactionRow, mapTransactionRow, parseSourceType } from "./ledgerTransactionRows.js";
import { DatabaseSync } from "node:sqlite";
import type { ImportJobHistoryEntry, UndoImportJobResult } from "../../domain/import/importJobHistory.js";
import type { ImportJob, ImportJobProvenance } from "../../domain/types.js";
import { serializeTransactionForUndo, persistImportJobOperation } from "./importJobPersistence.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type ImportHistoryRepository = Pick<LocalLedgerDatabase,
  | "listImportJobHistory"
  | "undoImportJob"
> & { backfillImportJobHistory: () => void };

export function createImportHistoryRepository(db: DatabaseSync): ImportHistoryRepository {
  function backfillImportJobHistory(): void {
    const legacyJobs = db.prepare(`
      SELECT job.id, job.household_id, job.source_type, job.source_name, job.adapter_id,
        job.candidate_count, job.validation_failure_count, job.started_at_iso,
        job.finished_at_iso, job.provenance_json
      FROM import_jobs AS job
      LEFT JOIN import_job_operations AS operation ON operation.import_job_id = job.id
      WHERE operation.import_job_id IS NULL
    `).all() as Array<{
      id: string;
      household_id: string;
      source_type: string;
      source_name: string;
      adapter_id: string | null;
      candidate_count: number | null;
      validation_failure_count: number | null;
      started_at_iso: string;
      finished_at_iso: string | null;
      provenance_json: string | null;
    }>;

    db.exec("BEGIN");
    try {
      for (const job of legacyJobs) {
        const transactions = db.prepare(`
          SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
            currency_code, source_type, source_reference, category_id, import_job_id,
            category_allocations_json
          FROM transactions
          WHERE import_job_id = ?
        `).all(job.id) as unknown as TransactionRow[];
        const importJob: ImportJob = {
          id: job.id,
          householdId: job.household_id,
          sourceType: parseSourceType(job.source_type),
          sourceName: job.source_name,
          startedAtIso: job.started_at_iso,
          ...(job.adapter_id === null ? {} : { adapterId: job.adapter_id }),
          ...(job.candidate_count === null ? {} : { candidateCount: job.candidate_count }),
          ...(job.validation_failure_count === null
            ? {}
            : { validationFailureCount: job.validation_failure_count }),
          ...(job.finished_at_iso === null ? {} : { finishedAtIso: job.finished_at_iso }),
          ...(job.provenance_json === null
            ? {}
            : { provenance: JSON.parse(job.provenance_json) as ImportJobProvenance }),
        };
        persistImportJobOperation(db, importJob, transactions.map(mapTransactionRow));
        db.prepare("UPDATE import_job_operations SET undo_available = 0 WHERE import_job_id = ?")
          .run(job.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function retainedImportTransactions(importJobId: string): UndoImportJobResult["retainedTransactions"] {
    const transactions = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id,
        category_allocations_json
      FROM transactions
      WHERE import_job_id = ?
      ORDER BY booked_at_iso, id
    `).all(importJobId) as unknown as TransactionRow[];
    const baselines = new Map(db.prepare(`
      SELECT transaction_id
      FROM import_job_transaction_baselines
      WHERE import_job_id = ?
    `).all(importJobId).map((row) => {
      const baseline = row as { transaction_id: string };
      return [baseline.transaction_id, true] as const;
    }));

    return transactions.map((row) => {
      const transaction = mapTransactionRow(row);
      return {
        id: transaction.id,
        bookedAtIso: transaction.bookedAtIso,
        amountMinor: transaction.amountMinor,
        merchantRaw: transaction.merchantRaw,
        currencyCode: transaction.currencyCode ?? "NOK",
        reason: baselines.has(transaction.id) ? "changed-after-import" : "baseline-unavailable",
      };
    });
  }

  function listImportJobHistory(householdId: string): ImportJobHistoryEntry[] {
    return db.prepare(`
      SELECT job.id, job.household_id, job.source_type, job.source_name, job.adapter_id,
        job.started_at_iso, job.finished_at_iso,
        operation.account_id,
        COALESCE(operation.candidate_count, job.candidate_count, 0) AS candidate_count,
        COALESCE(operation.imported_count, 0) AS imported_count,
        COALESCE(operation.duplicate_count, 0) AS duplicate_count,
        operation.undone_at_iso,
        COALESCE(operation.undo_removed_count, 0) AS undo_removed_count,
        COALESCE(operation.undo_retained_count, 0) AS undo_retained_count,
        CASE WHEN operation.undo_available = 1 AND operation.undone_at_iso IS NULL THEN 1 ELSE 0 END AS undo_available
      FROM import_jobs AS job
      LEFT JOIN import_job_operations AS operation ON operation.import_job_id = job.id
      WHERE job.household_id = ?
      ORDER BY job.started_at_iso DESC, job.id DESC
    `).all(householdId).map((row) => {
      const history = row as {
        id: string;
        household_id: string;
        source_type: string;
        source_name: string;
        adapter_id: string | null;
        account_id: string | null;
        candidate_count: number;
        imported_count: number;
        duplicate_count: number;
        started_at_iso: string;
        finished_at_iso: string | null;
        undone_at_iso: string | null;
        undo_removed_count: number;
        undo_retained_count: number;
        undo_available: number;
      };
      return {
        id: history.id,
        householdId: history.household_id,
        sourceType: parseSourceType(history.source_type),
        sourceName: history.source_name,
        adapterId: history.adapter_id,
        accountId: history.account_id,
        candidateCount: history.candidate_count,
        importedCount: history.imported_count,
        duplicateCount: history.duplicate_count,
        undoAvailable: history.undo_available === 1,
        startedAtIso: history.started_at_iso,
        finishedAtIso: history.finished_at_iso,
        undoneAtIso: history.undone_at_iso,
        undoRemovedCount: history.undo_removed_count,
        undoRetainedCount: history.undo_retained_count,
        retainedTransactions: history.undone_at_iso === null || history.undo_retained_count === 0
          ? []
          : retainedImportTransactions(history.id),
      } satisfies ImportJobHistoryEntry;
    });
  }

  function undoImportJob(importJobId: string): UndoImportJobResult {
    const operation = db.prepare(`
      SELECT imported_count, undone_at_iso, undo_removed_count, undo_retained_count, undo_available
      FROM import_job_operations
      WHERE import_job_id = ?
    `).get(importJobId) as {
      imported_count: number;
      undone_at_iso: string | null;
      undo_removed_count: number;
      undo_retained_count: number;
      undo_available: number;
    } | undefined;
    if (operation === undefined) throw new Error(`Import job not found: ${importJobId}`);
    if (operation.undone_at_iso !== null) {
      return {
        importJobId,
        removedCount: operation.undo_removed_count,
        retainedCount: operation.undo_retained_count,
        alreadyUndone: true,
        retainedTransactions: retainedImportTransactions(importJobId),
      };
    }

    const transactions = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id,
        category_allocations_json
      FROM transactions
      WHERE import_job_id = ?
      ORDER BY id
    `).all(importJobId) as unknown as TransactionRow[];
    const pendingObservations = db.prepare(`
      SELECT id, reconciled_transaction_id
      FROM pending_transaction_observations
      WHERE import_job_id = ?
      ORDER BY id
    `).all(importJobId) as Array<{ id: string; reconciled_transaction_id: string | null }>;
    const baselines = new Map(db.prepare(`
      SELECT transaction_id, baseline_json
      FROM import_job_transaction_baselines
      WHERE import_job_id = ?
    `).all(importJobId).map((row) => {
      const baseline = row as { transaction_id: string; baseline_json: string };
      return [baseline.transaction_id, baseline.baseline_json] as const;
    }));

    let removedCount = 0;
    let retainedCount = 0;
    const retainedTransactions: UndoImportJobResult["retainedTransactions"] = [];
    const undoneAtIso = new Date().toISOString();
    db.exec("BEGIN");
    try {
      if (operation.undo_available === 1) {
        const deleteTransaction = db.prepare(
          "DELETE FROM transactions WHERE id = ? AND import_job_id = ?"
        );
        const restorePendingObservation = db.prepare(`
          UPDATE pending_transaction_observations
          SET reconciled_transaction_id = NULL, reconciled_at_iso = NULL
          WHERE reconciled_transaction_id = ?
        `);
        for (const row of transactions) {
          const transaction = mapTransactionRow(row);
          const baselineJson = baselines.get(transaction.id);
          if (baselineJson !== undefined && serializeTransactionForUndo(transaction) === baselineJson) {
            const result = deleteTransaction.run(transaction.id, importJobId) as { changes: number | bigint };
            const removedTransactionCount = Number(result.changes);
            removedCount += removedTransactionCount;
            if (removedTransactionCount > 0) {
              restorePendingObservation.run(transaction.id);
            }
          } else {
            retainedCount += 1;
            retainedTransactions.push({
              id: transaction.id,
              bookedAtIso: transaction.bookedAtIso,
              amountMinor: transaction.amountMinor,
              merchantRaw: transaction.merchantRaw,
              currencyCode: transaction.currencyCode ?? "NOK",
              reason: baselineJson === undefined ? "baseline-unavailable" : "changed-after-import",
            });
          }
        }
        const undoPendingObservation = db.prepare(`
          DELETE FROM pending_transaction_observations
          WHERE id = ? AND reconciled_transaction_id IS NULL
        `);
        for (const observation of pendingObservations) {
          if (observation.reconciled_transaction_id !== null) {
            retainedCount += 1;
            continue;
          }
          const result = undoPendingObservation.run(observation.id) as {
            changes: number | bigint;
          };
          removedCount += Number(result.changes);
        }
      } else {
        retainedCount = transactions.length + pendingObservations.length;
        for (const row of transactions) {
          const transaction = mapTransactionRow(row);
          retainedTransactions.push({
            id: transaction.id,
            bookedAtIso: transaction.bookedAtIso,
            amountMinor: transaction.amountMinor,
            merchantRaw: transaction.merchantRaw,
            currencyCode: transaction.currencyCode ?? "NOK",
            reason: baselines.has(transaction.id) ? "changed-after-import" : "baseline-unavailable",
          });
        }
      }

      db.prepare(`
        UPDATE import_job_operations
        SET undone_at_iso = ?, undo_removed_count = ?, undo_retained_count = ?, undo_available = 0
        WHERE import_job_id = ?
      `).run(undoneAtIso, removedCount, retainedCount, importJobId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return { importJobId, removedCount, retainedCount, alreadyUndone: false, retainedTransactions };
  }

  return { backfillImportJobHistory, listImportJobHistory, undoImportJob };
}
