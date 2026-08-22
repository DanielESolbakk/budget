import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalLedgerDatabase, type LocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { submitManualEntry } from "../../src/app/import/manualEntry.js";
import type { Account, Household, ImportJob, ManualEntryInput, Transaction } from "../../src/domain/types.js";

const sampleHousehold: Household = {
  id: "hh-test",
  name: "Test Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const sampleAccounts: Account[] = [
  { id: "acc-test", householdId: sampleHousehold.id, name: "Brukskonto", currencyCode: "NOK" },
];

const validInput: ManualEntryInput = {
  householdId: sampleHousehold.id,
  accountId: sampleAccounts[0]!.id,
  bookedAtIso: "2026-05-23",
  amountMinor: -1250,
  merchantRaw: "Kiwi Stavanger",
  categoryId: "groceries",
};

let temporaryDirectory: string;
let ledger: LocalLedgerDatabase;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "manual-entry-test-"));
  ledger = createLocalLedgerDatabase({
    dbPath: join(temporaryDirectory, "budget.sqlite"),
    seedData: {
      household: sampleHousehold,
      accounts: sampleAccounts,
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });
});

afterEach(() => {
  ledger.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("manual-entry-duplicate integration", () => {
  describe("AC-1: valid manual transaction is persisted with correct fields", () => {
    it("persists the transaction and manual import job in SQLite", () => {
      const result = submitManualEntry(validInput, ledger.loadLedgerSnapshotData().transactions, ledger);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const snapshot = ledger.loadLedgerSnapshotData();
      expect(snapshot.transactions).toHaveLength(1);
      expect(snapshot.transactions[0]).toMatchObject({
        householdId: validInput.householdId,
        accountId: validInput.accountId,
        bookedAtIso: validInput.bookedAtIso,
        amountMinor: validInput.amountMinor,
        merchantRaw: validInput.merchantRaw,
        categoryId: validInput.categoryId,
        importJobId: result.importJobId,
      });
      expect(snapshot.importJobs).toHaveLength(1);
      expect(snapshot.importJobs[0]).toMatchObject({
        id: result.importJobId,
        householdId: validInput.householdId,
        sourceType: "manual",
        sourceName: "manual-entry",
      });
    });
  });

  describe("AC-2: duplicate submission leaves ledger row count unchanged", () => {
    it("returns duplicate result and does not persist a second SQLite row", () => {
      const first = submitManualEntry(validInput, ledger.loadLedgerSnapshotData().transactions, ledger);
      expect(first.ok).toBe(true);

      const beforeDuplicate = ledger.loadLedgerSnapshotData();
      const second = submitManualEntry(validInput, beforeDuplicate.transactions, ledger);

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.reason).toBe("duplicate");
      const afterDuplicate = ledger.loadLedgerSnapshotData();
      expect(afterDuplicate.transactions).toHaveLength(beforeDuplicate.transactions.length);
      expect(afterDuplicate.importJobs).toHaveLength(beforeDuplicate.importJobs.length);
    });
  });

  describe("AC-3: provenance is recorded for accepted and duplicate entries", () =>
    it("returns explainable duplicate data for normalized merchant variants", () => {
      const first = submitManualEntry(validInput, ledger.loadLedgerSnapshotData().transactions, ledger);
      expect(first.ok).toBe(true);

      const duplicate = submitManualEntry(
        { ...validInput, merchantRaw: "  kiwi   stavanger  " },
        ledger.loadLedgerSnapshotData().transactions,
        ledger
      );
      expect(duplicate.ok).toBe(false);
      if (duplicate.ok) return;
      expect(duplicate.reason).toBe("duplicate");
      if (duplicate.reason !== "duplicate" || !first.ok) return;
      expect(duplicate.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(duplicate.matchingTransactionId).toBe(first.transaction.id);
    });
  });

  it("rejects invalid input without changing the SQLite ledger", () => {
    const result = submitManualEntry(
      { ...validInput, merchantRaw: "" },
      ledger.loadLedgerSnapshotData().transactions,
      ledger
    );

    expect(result.ok).toBe(false);
    expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(0);
    expect(ledger.loadLedgerSnapshotData().importJobs).toHaveLength(0);
  });

  it("rejects an account that does not belong to the household", () => {
    const result = submitManualEntry(
      { ...validInput, accountId: "unknown-account" },
      ledger.loadLedgerSnapshotData().transactions,
      ledger
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "validation",
      code: "INVALID_ACCOUNT_ID",
    });
    expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(0);
    expect(ledger.loadLedgerSnapshotData().importJobs).toHaveLength(0);
  });

  it("rolls back the import job when transaction persistence fails", () => {
    const importJob: ImportJob = {
      id: "job-atomicity",
      householdId: sampleHousehold.id,
      sourceType: "manual",
      sourceName: "manual-entry",
      startedAtIso: "2026-05-23T00:00:00Z",
    };
    const transaction: Transaction = {
      id: "tx-atomicity",
      householdId: sampleHousehold.id,
      accountId: sampleAccounts[0]!.id,
      bookedAtIso: "2026-05-23T00:00:00Z",
      amountMinor: -1,
      merchantRaw: "Atomicity probe",
      importJobId: importJob.id,
    };

    ledger.appendManualEntry(importJob, transaction);

    expect(() =>
      ledger.appendManualEntry(
        { ...importJob, id: "job-atomicity-2" },
        transaction
      )
    ).toThrow();
    const snapshot = ledger.loadLedgerSnapshotData();
    expect(snapshot.importJobs).toHaveLength(1);
    expect(snapshot.transactions).toHaveLength(1);
    expect(snapshot.transactions[0]?.id).toBe("tx-atomicity");
  });
});
