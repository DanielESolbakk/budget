import { describe, expect, it } from "vitest";
import { submitManualEntry } from "../../src/app/import/manualEntry.js";
import type { ImportJob, ManualEntryInput, Transaction } from "../../src/domain/types.js";

function makeLedger(): {
  jobs: ImportJob[];
  transactions: Transaction[];
  appendImportJob: (job: ImportJob) => void;
  appendTransactions: (txs: Transaction[]) => void;
} {
  const jobs: ImportJob[] = [];
  const transactions: Transaction[] = [];
  return {
    jobs,
    transactions,
    appendImportJob: (job) => { jobs.push(job); },
    appendTransactions: (txs) => { transactions.push(...txs); },
  };
}

const validInput: ManualEntryInput = {
  householdId: "hh-1",
  accountId: "acc-1",
  bookedAtIso: "2026-05-23",
  amountMinor: -1250,
  merchantRaw: "Kiwi Stavanger",
  categoryId: "groceries",
};

describe("manual-entry-duplicate integration", () => {
  describe("AC-1: valid manual transaction is persisted with correct fields", () => {
    it("persists the transaction with the entered fields", () => {
      const ledger = makeLedger();
      const result = submitManualEntry(validInput, [], ledger);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const tx = result.transaction;
      expect(tx.householdId).toBe("hh-1");
      expect(tx.accountId).toBe("acc-1");
      expect(tx.bookedAtIso).toBe("2026-05-23");
      expect(tx.amountMinor).toBe(-1250);
      expect(tx.merchantRaw).toBe("Kiwi Stavanger");
      expect(tx.categoryId).toBe("groceries");
      expect(tx.importJobId).toBeTruthy();
    });

    it("creates an import job with sourceType 'manual'", () => {
      const ledger = makeLedger();
      const result = submitManualEntry(validInput, [], ledger);

      expect(result.ok).toBe(true);
      expect(ledger.jobs).toHaveLength(1);
      expect(ledger.jobs[0]?.sourceType).toBe("manual");
    });

    it("appends exactly one transaction to the ledger", () => {
      const ledger = makeLedger();
      submitManualEntry(validInput, [], ledger);
      expect(ledger.transactions).toHaveLength(1);
    });
  });

  describe("AC-2: duplicate submission leaves ledger row count unchanged", () => {
    it("returns duplicate result and does not persist a second row", () => {
      const ledger = makeLedger();

      const first = submitManualEntry(validInput, [], ledger);
      expect(first.ok).toBe(true);

      // Simulate the live ledger growing after first insert
      const existing = ledger.transactions.slice();
      const second = submitManualEntry(validInput, existing, ledger);

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.reason).toBe("duplicate");
      // Ledger transaction count must remain at 1
      expect(ledger.transactions).toHaveLength(1);
    });

    it("duplicate result contains a fingerprint and matchingTransactionId (AC-3)", () => {
      const ledger = makeLedger();
      submitManualEntry(validInput, [], ledger);
      const existing = ledger.transactions.slice();

      const duplicate = submitManualEntry(validInput, existing, ledger);
      expect(duplicate.ok).toBe(false);
      if (duplicate.ok) return;
      if (duplicate.reason !== "duplicate") return;
      expect(duplicate.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(duplicate.matchingTransactionId).toBeTruthy();
    });
  });

  describe("AC-3: provenance is recorded on accepted entry", () => {
    it("accepted transaction carries importJobId linking to the manual import job", () => {
      const ledger = makeLedger();
      const result = submitManualEntry(validInput, [], ledger);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transaction.importJobId).toBe(result.importJobId);
      expect(ledger.jobs[0]?.id).toBe(result.importJobId);
    });
  });

  describe("validation failures", () => {
    it("returns validation failure without persisting anything", () => {
      const ledger = makeLedger();
      const result = submitManualEntry({ ...validInput, merchantRaw: "" }, [], ledger);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("validation");
      expect(ledger.transactions).toHaveLength(0);
    });

    it("returns validation failure for non-integer amountMinor", () => {
      const ledger = makeLedger();
      const result = submitManualEntry({ ...validInput, amountMinor: 12.5 }, [], ledger);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("validation");
    });
  });
});
