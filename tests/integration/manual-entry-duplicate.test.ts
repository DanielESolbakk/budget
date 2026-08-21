import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import type { LocalLedgerDatabase, ManualTransactionInput } from "../../src/app/backup/localLedgerSqlite.js";
import type { Household, Account } from "../../src/domain/types.js";

const SAMPLE_HOUSEHOLD: Household = {
  id: "hh-test",
  name: "Test Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const SAMPLE_ACCOUNTS: Account[] = [
  { id: "acc-test", householdId: "hh-test", name: "Brukskonto", currencyCode: "NOK" },
];

const MANUAL_TX: ManualTransactionInput = {
  id: "tx-manual-001",
  householdId: "hh-test",
  accountId: "acc-test",
  bookedAtIso: "2026-05-15T00:00:00Z",
  amountMinor: -15000,
  merchantRaw: "Meny Stavanger",
  categoryId: "groceries",
  importJobId: "job-manual-01",
};

/** An equivalent transaction: same identity fields, different id. */
const DUPLICATE_TX: ManualTransactionInput = {
  ...MANUAL_TX,
  id: "tx-manual-002",
};

let tmpDir: string;
let ledger: LocalLedgerDatabase;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "manual-entry-test-"));
  ledger = createLocalLedgerDatabase({
    dbPath: join(tmpDir, "test.sqlite"),
    seedData: {
      household: SAMPLE_HOUSEHOLD,
      accounts: SAMPLE_ACCOUNTS,
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });
});

afterEach(() => {
  ledger.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("manual entry and duplicate detection integration", () => {
  describe("AC-1: a valid manually entered transaction is persisted once", () => {
    it("accepts a manual transaction and returns ok: true with its id and fingerprint", () => {
      const result = ledger.submitManualTransaction(MANUAL_TX);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transactionId).toBe(MANUAL_TX.id);
      expect(typeof result.fingerprint).toBe("string");
      expect(result.fingerprint.length).toBeGreaterThan(0);
    });

    it("persists the transaction so it appears in the ledger snapshot", () => {
      ledger.submitManualTransaction(MANUAL_TX);

      const snapshot = ledger.loadLedgerSnapshotData();
      const persisted = snapshot.transactions.find((t) => t.id === MANUAL_TX.id);

      expect(persisted).toBeDefined();
      expect(persisted?.accountId).toBe(MANUAL_TX.accountId);
      expect(persisted?.bookedAtIso).toBe(MANUAL_TX.bookedAtIso);
      expect(persisted?.amountMinor).toBe(MANUAL_TX.amountMinor);
      expect(persisted?.merchantRaw).toBe(MANUAL_TX.merchantRaw);
      expect(persisted?.categoryId).toBe(MANUAL_TX.categoryId);
      expect(persisted?.importJobId).toBe(MANUAL_TX.importJobId);
    });
  });

  describe("AC-2: re-submitting an equivalent transaction is rejected as a duplicate", () => {
    it("returns ok: false with duplicate: true when the same identity fields are submitted again", () => {
      ledger.submitManualTransaction(MANUAL_TX);
      const result = ledger.submitManualTransaction(DUPLICATE_TX);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.duplicate).toBe(true);
    });

    it("leaves the ledger row count unchanged after a duplicate submission", () => {
      ledger.submitManualTransaction(MANUAL_TX);

      const countBefore = ledger.loadLedgerSnapshotData().transactions.length;
      ledger.submitManualTransaction(DUPLICATE_TX);
      const countAfter = ledger.loadLedgerSnapshotData().transactions.length;

      expect(countAfter).toBe(countBefore);
    });
  });

  describe("AC-3: duplicate detection records expected provenance for the submitted transaction", () => {
    it("returns the fingerprint and the existing transaction id in the duplicate result", () => {
      const first = ledger.submitManualTransaction(MANUAL_TX);
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const second = ledger.submitManualTransaction(DUPLICATE_TX);
      expect(second.ok).toBe(false);
      if (second.ok) return;

      expect(second.fingerprint).toBe(first.fingerprint);
      expect(second.existingTransactionId).toBe(MANUAL_TX.id);
    });

    it("returns a stable fingerprint for equivalent merchant name variants", () => {
      // buildTransactionFingerprint normalizes casing and whitespace so these are equivalent.
      const withExtraSpaces: ManualTransactionInput = {
        ...MANUAL_TX,
        id: "tx-manual-003",
        merchantRaw: "  meny  stavanger  ",
      };

      const original = ledger.submitManualTransaction(MANUAL_TX);
      expect(original.ok).toBe(true);
      if (!original.ok) return;

      const duplicate = ledger.submitManualTransaction(withExtraSpaces);
      expect(duplicate.ok).toBe(false);
      if (duplicate.ok) return;
      expect(duplicate.fingerprint).toBe(original.fingerprint);
    });
  });
});
