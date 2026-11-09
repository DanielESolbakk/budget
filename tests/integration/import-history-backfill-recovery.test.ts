import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createImportHistoryRepository } from "../../src/app/backup/importHistoryRepository.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { withIsolatedLedger } from "../helpers/isolatedLedger.js";

describe("legacy import-history backfill recovery", () => {
  it("rolls back earlier history rows on a later failure, then retries safely across reopen", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      for (const id of ["first", "second"]) {
        ledger.appendImportJobAndTransactions({
          id, householdId: "hh-isolated", sourceType: "csv",
          sourceName: `synthetic-${id}.csv`, startedAtIso: "2026-05-01T00:00:00Z",
          candidateCount: 1,
        }, [{
          id: `tx-${id}`, householdId: "hh-isolated", accountId: "acc-isolated",
          importJobId: id, bookedAtIso: "2026-05-01", amountMinor: -1250,
          merchantRaw: "SYNTHETIC KIWI", currencyCode: "NOK", sourceType: "csv",
        }]);
      }
      const before = ledger.loadLedgerSnapshotData();
      const raw = new DatabaseSync(dbPath);
      try {
        raw.exec(`
          DELETE FROM import_job_transaction_baselines;
          DELETE FROM import_job_operations;
          CREATE TRIGGER synthetic_backfill_failure BEFORE INSERT ON import_job_operations
          WHEN (SELECT COUNT(*) FROM import_job_operations) = 1
          BEGIN SELECT RAISE(ABORT, 'synthetic later backfill failure'); END;
        `);
        const history = createImportHistoryRepository(raw);
        expect(() => history.backfillImportJobHistory()).toThrow("synthetic later backfill failure");
        expect(raw.prepare("SELECT * FROM import_job_operations").all()).toEqual([]);
        expect(raw.prepare("SELECT * FROM import_job_transaction_baselines").all()).toEqual([]);
        expect(ledger.loadLedgerSnapshotData()).toEqual(before);
        raw.exec("DROP TRIGGER synthetic_backfill_failure");
        history.backfillImportJobHistory();
        history.backfillImportJobHistory();
        expect(history.listImportJobHistory("hh-isolated")).toMatchObject([
          { id: "second", importedCount: 1, candidateCount: 1, undoAvailable: false },
          { id: "first", importedCount: 1, candidateCount: 1, undoAvailable: false },
        ]);
        expect(raw.prepare("SELECT * FROM import_job_transaction_baselines").all()).toEqual([]);
      } finally {
        raw.close();
      }
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.loadLedgerSnapshotData()).toEqual(before);
        expect(reopened.listImportJobHistory("hh-isolated")).toMatchObject([
          { id: "second", importedCount: 1, undoAvailable: false },
          { id: "first", importedCount: 1, undoAvailable: false },
        ]);
        expect(reopened.undoImportJob("first")).toMatchObject({
          removedCount: 0, retainedCount: 1,
          retainedTransactions: [{ id: "tx-first", amountMinor: -1250, reason: "baseline-unavailable" }],
        });
        expect(reopened.loadLedgerSnapshotData()).toEqual(before);
      } finally {
        reopened.close();
      }
    });
  });
});
