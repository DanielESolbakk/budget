import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBackupSnapshot, buildBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { createHoldingRegistry } from "../../src/app/holdingRegistry.js";
import type { Transaction } from "../../src/domain/types.js";

const HOUSEHOLD = {
  id: "household-holding-test",
  name: "Synthetic household",
  createdAtIso: "2026-01-01T00:00:00.000Z",
};

function openLedger(dbPath: string) {
  return createLocalLedgerDatabase({
    dbPath,
    seedData: {
      household: HOUSEHOLD,
      accounts: [
        {
          id: "account-nok",
          householdId: HOUSEHOLD.id,
          name: "Current",
          currencyCode: "NOK",
        },
      ],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });
}

describe("holding registry persistence and backup", () => {
  it("keeps dated original-currency valuations append-only after reopening SQLite", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-holding-history-"));
    const dbPath = join(directory, "ledger.sqlite");
    const recordedTimes = [
      "2026-10-01T08:00:00.000Z",
      "2026-10-02T09:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
      "2026-10-03T10:00:00.000Z",
    ];
    let recordedTimeIndex = 0;
    let idIndex = 0;
    let ledger = openLedger(dbPath);

    try {
      const registry = createHoldingRegistry(ledger, {
        createId: () => `holding-record-${++idIndex}`,
        now: () => new Date(recordedTimes[recordedTimeIndex++]!),
      });
      registry.create({
        label: "Global fund",
        quantity: 10,
        costBasisMinor: 1_000_000,
        currencyCode: "EUR",
      });
      registry.appendValuation({
        holdingId: "holding-record-1",
        effectiveDateIso: "2026-10-01",
        amountMinor: 1_100_000,
        currencyCode: "EUR",
      });
      registry.appendValuation({
        holdingId: "holding-record-1",
        effectiveDateIso: "2026-11-01",
        amountMinor: 1_150_000,
        currencyCode: "EUR",
      });
      registry.appendValuation({
        holdingId: "holding-record-1",
        effectiveDateIso: "2026-10-01",
        amountMinor: 1_125_000,
        currencyCode: "EUR",
      });

      const expected = [
        {
          id: "holding-record-1",
          householdId: HOUSEHOLD.id,
          label: "Global fund",
          quantity: 10,
          costBasisMinor: 1_000_000,
          currencyCode: "EUR",
          createdAtIso: "2026-10-01T08:00:00.000Z",
          valuations: [
            {
              id: "holding-record-2",
              holdingId: "holding-record-1",
              effectiveDateIso: "2026-10-01",
              amountMinor: 1_100_000,
              currencyCode: "EUR",
              recordedAtIso: "2026-10-02T09:00:00.000Z",
            },
            {
              id: "holding-record-4",
              holdingId: "holding-record-1",
              effectiveDateIso: "2026-10-01",
              amountMinor: 1_125_000,
              currencyCode: "EUR",
              recordedAtIso: "2026-10-03T10:00:00.000Z",
            },
            {
              id: "holding-record-3",
              holdingId: "holding-record-1",
              effectiveDateIso: "2026-11-01",
              amountMinor: 1_150_000,
              currencyCode: "EUR",
              recordedAtIso: "2026-11-02T09:00:00.000Z",
            },
          ],
        },
      ];

      expect(registry.list()).toEqual(expected);
      expect(ledger.listExchangeRates()).toEqual([]);
      ledger.close();
      ledger = openLedger(dbPath);

      expect(createHoldingRegistry(ledger).list()).toEqual(expected);
      expect(ledger.listExchangeRates()).toEqual([]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores holdings and complete history without changing existing ledger records", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-holding-backup-"));
    const sourcePath = join(directory, "source.sqlite");
    const restoredPath = join(directory, "restored.sqlite");
    const snapshotPath = join(directory, "backup.json");
    const recordedTimes = [
      "2026-10-01T08:00:00.000Z",
      "2026-10-02T09:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
      "2026-10-03T10:00:00.000Z",
    ];
    let recordedTimeIndex = 0;
    let idIndex = 0;
    const source = openLedger(sourcePath);
    const restored = openLedger(restoredPath);

    try {
      const existingTransaction: Transaction = {
        id: "transaction-existing",
        householdId: HOUSEHOLD.id,
        accountId: "account-nok",
        bookedAtIso: "2026-09-15T00:00:00.000Z",
        amountMinor: -12_500,
        merchantRaw: "SYNTHETIC EXISTING TRANSACTION",
        currencyCode: "NOK",
        sourceType: "manual",
      };
      source.replaceLedgerSnapshotData({
        ...source.loadLedgerSnapshotData(),
        transactions: [existingTransaction],
      });
      const accountsBefore = source.loadLedgerSnapshotData().accounts;
      const transactionsBefore = source.loadLedgerSnapshotData().transactions;
      const registry = createHoldingRegistry(source, {
        createId: () => `holding-record-${++idIndex}`,
        now: () => new Date(recordedTimes[recordedTimeIndex++]!),
      });
      registry.create({
        label: "Global fund",
        quantity: 10,
        costBasisMinor: 1_000_000,
        currencyCode: "EUR",
      });
      registry.appendValuation({
        holdingId: "holding-record-1",
        effectiveDateIso: "2026-10-01",
        amountMinor: 1_100_000,
        currencyCode: "EUR",
      });
      registry.appendValuation({
        holdingId: "holding-record-1",
        effectiveDateIso: "2026-11-01",
        amountMinor: 1_150_000,
        currencyCode: "EUR",
      });
      registry.appendValuation({
        holdingId: "holding-record-1",
        effectiveDateIso: "2026-10-01",
        amountMinor: 1_125_000,
        currencyCode: "EUR",
      });
      createBackupSnapshot({
        ...source.loadLedgerSnapshotData(),
        outputPath: snapshotPath,
        createdAtIso: "2026-11-03T12:00:00.000Z",
      });

      const snapshot = restoreBackupSnapshot({ snapshotPath });
      restored.replaceLedgerSnapshotData(snapshot);

      expect(createHoldingRegistry(restored).list()).toEqual([
        {
          id: "holding-record-1",
          householdId: HOUSEHOLD.id,
          label: "Global fund",
          quantity: 10,
          costBasisMinor: 1_000_000,
          currencyCode: "EUR",
          createdAtIso: "2026-10-01T08:00:00.000Z",
          valuations: [
            {
              id: "holding-record-2",
              holdingId: "holding-record-1",
              effectiveDateIso: "2026-10-01",
              amountMinor: 1_100_000,
              currencyCode: "EUR",
              recordedAtIso: "2026-10-02T09:00:00.000Z",
            },
            {
              id: "holding-record-4",
              holdingId: "holding-record-1",
              effectiveDateIso: "2026-10-01",
              amountMinor: 1_125_000,
              currencyCode: "EUR",
              recordedAtIso: "2026-10-03T10:00:00.000Z",
            },
            {
              id: "holding-record-3",
              holdingId: "holding-record-1",
              effectiveDateIso: "2026-11-01",
              amountMinor: 1_150_000,
              currencyCode: "EUR",
              recordedAtIso: "2026-11-02T09:00:00.000Z",
            },
          ],
        },
      ]);
      const restoredData = restored.loadLedgerSnapshotData();
      expect(restoredData.accounts).toEqual(accountsBefore);
      expect(restoredData.transactions).toEqual(transactionsBefore);
      expect(restoredData.exchangeRates).toEqual([]);
    } finally {
      source.close();
      restored.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores version-6 snapshots without holding collections as empty history", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-holding-legacy-snapshot-"));
    const snapshotPath = join(directory, "legacy.json");

    try {
      const snapshot = JSON.parse(JSON.stringify(buildBackupSnapshot({
        household: HOUSEHOLD,
        accounts: [],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
        createdAtIso: "2026-11-03T09:00:00.000Z",
      }))) as Record<string, unknown>;
      const metadata = snapshot["metadata"] as Record<string, unknown>;
      metadata["version"] = "6";
      delete snapshot["holdings"];
      delete snapshot["holdingValuations"];
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      const restored = restoreBackupSnapshot({ snapshotPath });

      expect(restored.holdings).toEqual([]);
      expect(restored.holdingValuations).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports missing holding collections in a current-version snapshot", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-holding-invalid-snapshot-"));
    const snapshotPath = join(directory, "missing-holdings.json");

    try {
      const snapshot = JSON.parse(JSON.stringify(buildBackupSnapshot({
        household: HOUSEHOLD,
        accounts: [],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
        createdAtIso: "2026-11-03T09:00:00.000Z",
      }))) as Record<string, unknown>;
      delete snapshot["holdings"];
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/holding collections/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
