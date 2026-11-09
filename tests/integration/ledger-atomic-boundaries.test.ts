import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import type { ImportJob, ImportReviewItem, Transaction } from "../../src/domain/types.js";
import { withIsolatedLedger } from "../helpers/isolatedLedger.js";

const importJob: ImportJob = {
  id: "job-atomic", householdId: "hh-isolated", sourceType: "csv", sourceName: "synthetic.csv",
  startedAtIso: "2026-05-01T00:00:00Z",
};
const transaction: Transaction = {
  id: "transaction-atomic", householdId: "hh-isolated", accountId: "acc-isolated",
  bookedAtIso: "2026-05-01", amountMinor: -1000, merchantRaw: "REMA 1000",
  currencyCode: "NOK", sourceType: "csv", importJobId: "job-atomic",
};

function injectWriteFault(dbPath: string, statement: string): void {
  const raw = new DatabaseSync(dbPath);
  try {
    raw.exec(statement);
  } finally {
    raw.close();
  }
}

describe("extracted ledger transaction boundaries", () => {
  it("undoes only unreconciled pending rows and preserves booked reconciliation evidence across reopen", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      const pending = {
        id: "pending-matched", householdId: "hh-isolated", accountId: "acc-isolated",
        transactionDateIso: "2026-05-01", amountMinor: -1200, merchantRaw: "REMA 1000",
        sourceRowIndex: 1, currencyCode: "NOK", sourceType: "csv" as const,
        sourceReference: "synthetic-reference", importJobId: "job-pending",
        status: "reserved" as const, sourceStatus: "Reservert" as const,
      };
      ledger.appendImportJobAndTransactions({
        ...importJob, id: "job-pending", candidateCount: 2,
      }, [], [], [
        pending,
        { ...pending, id: "pending-unmatched", sourceRowIndex: 2,
          sourceReference: "synthetic-other-reference", amountMinor: -900 },
      ]);
      ledger.appendImportJobAndTransactions({
        ...importJob, id: "job-booked", startedAtIso: "2026-05-02T00:00:00Z",
      }, [{
        ...transaction, id: "booked", importJobId: "job-booked",
        sourceReference: "synthetic-reference",
      }]);
      expect(ledger.loadLedgerSnapshotData().pendingObservations).toMatchObject([
        { id: "pending-matched", reconciledTransactionId: "booked" },
        { id: "pending-unmatched" },
      ]);
      const before = ledger.loadLedgerSnapshotData();
      expect(ledger.undoImportJob("job-pending")).toEqual({
        importJobId: "job-pending", removedCount: 1, retainedCount: 1,
        alreadyUndone: false, retainedTransactions: [],
      });
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.loadLedgerSnapshotData().transactions).toEqual(before.transactions);
        expect(reopened.loadLedgerSnapshotData().pendingObservations).toEqual([
          { ...pending, reconciledTransactionId: "booked", reconciledAtIso: "2026-05-02T00:00:00Z" },
        ]);
        expect(reopened.listPendingTransactionObservations("hh-isolated")).toEqual([]);
        expect(reopened.listImportJobHistory("hh-isolated").find(job => job.id === "job-pending"))
          .toMatchObject({ undoAvailable: false, undoRemovedCount: 1, undoRetainedCount: 1 });
        expect(reopened.undoImportJob("job-pending")).toEqual({
          importJobId: "job-pending", removedCount: 1, retainedCount: 1,
          alreadyUndone: true, retainedTransactions: [],
        });
        expect(reopened.undoImportJob("job-booked")).toMatchObject({
          removedCount: 1, retainedCount: 0,
        });
        expect(reopened.listPendingTransactionObservations("hh-isolated")).toEqual([pending]);
      } finally {
        reopened.close();
      }
    });
  });

  it("rolls back a commitment update when its decision insert faults and preserves it after reopen", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      const commitment = {
        id: "commitment", householdId: "hh-isolated", description: "Electricity", currencyCode: "NOK",
        amountMinor: 10000, isVariable: false, cadence: "monthly" as const,
        firstDueDateIso: "2026-05-01", activeFromIso: "2026-05-01", status: "active" as const,
        createdAtIso: "2026-01-01T00:00:00Z", updatedAtIso: "2026-01-01T00:00:00Z",
      };
      ledger.createRecurringCommitment(commitment);
      injectWriteFault(dbPath, `CREATE TRIGGER reject_decision BEFORE INSERT ON recurring_commitment_decisions
        BEGIN SELECT RAISE(ABORT, 'synthetic decision fault'); END;`);
      expect(() => ledger.updateRecurringCommitmentAndDecision({ ...commitment, amountMinor: 11000 },
        { id: "decision", commitmentId: "commitment", decisionType: "amount-change-confirmed",
          decidedAtIso: "2026-05-01T00:00:00Z", previousAmountMinor: 10000, newAmountMinor: 11000 }))
        .toThrow("synthetic decision fault");
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.listRecurringCommitments("hh-isolated")).toEqual([
          { id: "commitment", householdId: "hh-isolated", description: "Electricity", currencyCode: "NOK",
            amountMinor: 10000, isVariable: false, cadence: "monthly", firstDueDateIso: "2026-05-01",
            activeFromIso: "2026-05-01", status: "active", createdAtIso: "2026-01-01T00:00:00Z",
            updatedAtIso: "2026-01-01T00:00:00Z" },
        ]);
        expect(reopened.listRecurringCommitmentDecisions("hh-isolated")).toEqual([]);
      } finally {
        reopened.close();
      }
    });
  });

  it("restores all old rows when snapshot insertion fails after deletion and the first insert", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      injectWriteFault(dbPath, `CREATE TRIGGER reject_replacement_account BEFORE INSERT ON accounts
        WHEN NEW.id = 'replacement-account'
        BEGIN SELECT RAISE(ABORT, 'synthetic replacement fault'); END;`);
      expect(() => ledger.replaceLedgerSnapshotData({
        household: { id: "replacement", name: "New synthetic", createdAtIso: "2026-05-01T00:00:00Z" },
        accounts: [{ id: "replacement-account", householdId: "replacement", name: "New", currencyCode: "NOK" }],
        transactions: [], importJobs: [], monthlyCategoryTargets: [],
      })).toThrow("synthetic replacement fault");
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.loadRuntimeMetadata()).toEqual({
          household: { id: "hh-isolated", name: "Synthetic household", createdAtIso: "2026-01-01T00:00:00Z" },
          accounts: [{ id: "acc-isolated", householdId: "hh-isolated", name: "Current", currencyCode: "NOK" }],
          monthlyCategoryTargets: [], merchantCategoryRules: [],
        });
      } finally {
        reopened.close();
      }
    });
  });

  it("rolls back category, rule, and provenance when the final correction write faults", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      ledger.appendImportJobAndTransactions(importJob, [transaction]);
      injectWriteFault(dbPath, `CREATE TRIGGER reject_provenance BEFORE INSERT ON merchant_correction_provenance
        BEGIN SELECT RAISE(ABORT, 'synthetic provenance fault'); END;`);
      expect(() => ledger.updateTransactionCategoryAndRule(transaction.id,
        { merchantAlias: "REMA 1000", categoryId: "groceries" })).toThrow("synthetic provenance fault");
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.getTransactionById("transaction-atomic")).toEqual(transaction);
        expect(reopened.listMerchantCategoryRules()).toEqual([]);
        expect(reopened.listMerchantCorrectionProvenance()).toEqual([]);
      } finally {
        reopened.close();
      }
    });
  });

  it("rolls back a review transaction, status, and history counts when baseline insertion faults", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      const reviewItem: ImportReviewItem = {
        id: "review-atomic", importJobId: "job-atomic", householdId: "hh-isolated",
        accountId: "acc-isolated", sourceType: "csv", sourceName: "synthetic.csv",
        sourceIdentity: "synthetic-source", sourceRowIndex: 1, rawRow: "invalid date,REMA 1000,-10.00",
        parserErrors: [], status: "unresolved", createdAtIso: "2026-05-01T00:00:00Z",
        updatedAtIso: "2026-05-01T00:00:00Z",
      };
      ledger.appendImportJobAndTransactions(
        { ...importJob, candidateCount: 1, validationFailureCount: 1 }, [], [reviewItem]);
      injectWriteFault(dbPath, `CREATE TRIGGER reject_review_baseline BEFORE INSERT ON import_job_transaction_baselines
        BEGIN SELECT RAISE(ABORT, 'synthetic review baseline fault'); END;`);
      expect(() => ledger.completeImportReviewCorrection("review-atomic", transaction,
        '{"syntheticCorrection":true}', "2026-05-02T00:00:00Z")).toThrow("synthetic review baseline fault");
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.getTransactionById("transaction-atomic")).toBeUndefined();
        expect(reopened.listImportReviewItems("hh-isolated")).toEqual([reviewItem]);
        expect(reopened.listImportJobHistory("hh-isolated")).toMatchObject([
          { id: "job-atomic", candidateCount: 1, importedCount: 0, undoneAtIso: null },
        ]);
      } finally {
        reopened.close();
      }
    });
  });

  it("restores deleted transactions when recording the import undo result faults", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      ledger.appendImportJobAndTransactions(importJob, [transaction]);
      injectWriteFault(dbPath, `CREATE TRIGGER reject_undo_result BEFORE UPDATE ON import_job_operations
        WHEN NEW.undone_at_iso IS NOT NULL
        BEGIN SELECT RAISE(ABORT, 'synthetic undo result fault'); END;`);
      expect(() => ledger.undoImportJob("job-atomic")).toThrow("synthetic undo result fault");
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.getTransactionById("transaction-atomic")).toEqual(transaction);
        expect(reopened.listImportJobHistory("hh-isolated")).toMatchObject([
          { id: "job-atomic", importedCount: 1, undoneAtIso: null, undoAvailable: true,
            undoRemovedCount: 0, undoRetainedCount: 0 },
        ]);
        injectWriteFault(dbPath, "DROP TRIGGER reject_undo_result");
        expect(reopened.undoImportJob("job-atomic")).toEqual({
          importJobId: "job-atomic", removedCount: 1, retainedCount: 0, alreadyUndone: false,
          retainedTransactions: [],
        });
      } finally {
        reopened.close();
      }
    });
});
});
