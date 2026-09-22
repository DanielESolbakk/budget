import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import type { LedgerSnapshotData } from "../../src/domain/backup/snapshotContract.js";

const HOUSEHOLD = {
  id: "hh-recovery",
  name: "Recovery Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};
const ACCOUNT = {
  id: "acc-recovery",
  householdId: HOUSEHOLD.id,
  name: "Brukskonto",
  currencyCode: "NOK" as const,
};

function createSnapshotData(): LedgerSnapshotData {
  return {
    household: HOUSEHOLD,
    accounts: [ACCOUNT],
    transactions: [
      {
        id: "tx-restored",
        householdId: HOUSEHOLD.id,
        accountId: ACCOUNT.id,
        bookedAtIso: "2026-05-20T00:00:00Z",
        amountMinor: -12500,
        merchantRaw: "Restored merchant",
        categoryId: "restored",
      },
    ],
    importJobs: [],
    monthlyCategoryTargets: [
      { yearMonth: "2026-05", categoryId: "restored", targetMinor: 15000 },
    ],
  };
}

describe("ledger recovery runtime contracts", () => {
  it("replaces the SQLite ledger and preserves restored state after reopening", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-ledger-replace-"));
    const dbPath = join(tempDir, "ledger.sqlite");
    const initialState = { ...createSnapshotData(), household: { ...HOUSEHOLD, name: "Initial Household" } };
    const restoredState = createSnapshotData();

    try {
      const database = createLocalLedgerDatabase({ dbPath, seedData: initialState });
      database.replaceLedgerSnapshotData(restoredState);
      expect(database.loadLedgerSnapshotData()).toEqual(restoredState);
      database.close();

      const reopened = createLocalLedgerDatabase({ dbPath, seedData: restoredState });
      expect(reopened.loadLedgerSnapshotData()).toEqual(restoredState);
      reopened.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects inconsistent snapshot metadata before persistence is attempted", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-invalid-restore-"));
    const snapshotPath = join(tempDir, "invalid-snapshot.json");

    try {
      const snapshot = buildBackupSnapshot({
        ...createSnapshotData(),
        createdAtIso: "2026-09-22T10:00:00Z",
      });
      snapshot.metadata.transactionCount = 999;
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(
        "Snapshot transaction count does not match"
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a transaction that references an account outside the snapshot", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-invalid-reference-"));
    const snapshotPath = join(tempDir, "invalid-reference.json");

    try {
      const snapshot = buildBackupSnapshot({
        ...createSnapshotData(),
        transactions: [
          {
            ...createSnapshotData().transactions[0]!,
            accountId: "missing-account",
          },
        ],
        createdAtIso: "2026-09-22T10:00:00Z",
      });
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(
        "Invalid snapshot transactions"
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects malformed transaction fields before replacement", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-invalid-record-"));
    const snapshotPath = join(tempDir, "invalid-record.json");

    try {
      const snapshot = buildBackupSnapshot({
        ...createSnapshotData(),
        transactions: [
          {
            ...createSnapshotData().transactions[0]!,
            amountMinor: Number.NaN,
          },
        ],
        createdAtIso: "2026-09-22T10:00:00Z",
      });
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(
        "Invalid snapshot transactions"
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps the existing database unchanged when replacement insertion fails", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-rollback-restore-"));
    const dbPath = join(tempDir, "ledger.sqlite");
    const initialState = createSnapshotData();
    const invalidState: LedgerSnapshotData = {
      ...createSnapshotData(),
      accounts: [ACCOUNT, ACCOUNT],
    };

    try {
      const database = createLocalLedgerDatabase({ dbPath, seedData: initialState });

      expect(() => database.replaceLedgerSnapshotData(invalidState)).toThrow();
      expect(database.loadLedgerSnapshotData()).toEqual(initialState);
      database.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("hydrates monthly targets from the reopened local ledger", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-target-reopen-"));
    const dbPath = join(tempDir, "ledger.sqlite");
    const seedData = { ...createSnapshotData(), transactions: [], monthlyCategoryTargets: [] };

    try {
      const firstDatabase = createLocalLedgerDatabase({ dbPath, seedData });
      firstDatabase.upsertMonthlyCategoryTarget({
        yearMonth: "2026-05",
        categoryId: "groceries",
        targetMinor: 9500,
      });
      firstDatabase.close();

      const reopenedDatabase = createLocalLedgerDatabase({ dbPath, seedData });
      expect(reopenedDatabase.loadLedgerSnapshotData().monthlyCategoryTargets).toEqual([
        { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 9500 },
      ]);
      reopenedDatabase.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves a non-NOK account currency through replacement and reopen", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-currency-reopen-"));
    const dbPath = join(tempDir, "ledger.sqlite");
    const currencyState: LedgerSnapshotData = {
      ...createSnapshotData(),
      accounts: [{ ...ACCOUNT, id: "acc-usd", currencyCode: "USD" }],
      transactions: [],
    };

    try {
      const database = createLocalLedgerDatabase({ dbPath, seedData: createSnapshotData() });
      database.replaceLedgerSnapshotData(currencyState);
      expect(database.loadLedgerSnapshotData().accounts[0]?.currencyCode).toBe("USD");
      expect(database.getAccountsForHousehold(HOUSEHOLD.id)[0]?.currencyCode).toBe("USD");
      database.close();

      const reopened = createLocalLedgerDatabase({ dbPath, seedData: currencyState });
      expect(reopened.loadLedgerSnapshotData().accounts[0]?.currencyCode).toBe("USD");
      reopened.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});