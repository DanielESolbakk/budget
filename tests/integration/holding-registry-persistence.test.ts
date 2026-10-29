import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  it("preserves corrected holding details and valuation history across restart and backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-holding-correction-"));
    const dbPath = join(directory, "ledger.sqlite");
    const restoredPath = join(directory, "restored.sqlite");
    const snapshotPath = join(directory, "backup.json");
    let idIndex = 0;
    let ledger = openLedger(dbPath);
    const restored = openLedger(restoredPath);
    try {
      const registry = createHoldingRegistry(ledger, {
        createId: () => `record-${++idIndex}`,
        now: () => new Date(`2026-10-0${idIndex}T12:00:00.000Z`),
      });
      const original = registry.create({
        label: "Global fund",
        quantity: 10,
        costBasisMinor: 1_000_000,
        currencyCode: "EUR",
      });
      const valuation = registry.appendValuation({
        holdingId: original.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 1_100_000,
        currencyCode: "EUR",
      });
      expect(registry).toHaveProperty("correctHolding");
      expect(registry).toHaveProperty("correctValuation");
      registry.correctHolding({
        holdingId: original.id,
        label: "Global fund corrected",
        quantity: 12,
        costBasisMinor: 1_200_000,
        currencyCode: "EUR",
      });
      registry.correctValuation({
        holdingId: original.id,
        targetValuationId: valuation.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 1_250_000,
        currencyCode: "EUR",
      });
      const expected = registry.list();
      expect(expected[0]).toMatchObject({
        label: "Global fund corrected",
        quantity: 12,
        costBasisMinor: 1_200_000,
        revisions: [expect.objectContaining({
          label: "Global fund",
          quantity: 10,
          costBasisMinor: 1_000_000,
        })],
        valuations: [
          expect.objectContaining({ id: valuation.id, amountMinor: 1_100_000 }),
          expect.objectContaining({
            amountMinor: 1_250_000,
            correction: { targetValuationId: valuation.id },
          }),
        ],
      });
      expect(() => registry.correctValuation({
        holdingId: original.id,
        targetValuationId: valuation.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 1_300_000,
        currencyCode: "EUR",
      })).toThrow();
      ledger.close();
      ledger = openLedger(dbPath);
      expect(createHoldingRegistry(ledger).list()).toEqual(expected);
      createBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(),
        outputPath: snapshotPath,
        createdAtIso: "2026-10-10T12:00:00.000Z",
      });
      restored.replaceLedgerSnapshotData(restoreBackupSnapshot({ snapshotPath }));
      expect(createHoldingRegistry(restored).list()).toEqual(expected);
    } finally {
      ledger.close();
      restored.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

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

  it("migrates version-7 holdings and valuations without losing their original data", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-holding-version7-"));
    const dbPath = join(directory, "ledger.sqlite");
    const snapshotPath = join(directory, "version7.json");
    let ledger = openLedger(dbPath);
    try {
      const registry = createHoldingRegistry(ledger);
      const original = registry.create({
        label: "Legacy fund", quantity: 3, costBasisMinor: 45_000, currencyCode: "NOK",
      });
      registry.appendValuation({
        holdingId: original.id, effectiveDateIso: "2026-10-01", amountMinor: 50_000, currencyCode: "NOK",
      });
      const expected = registry.list();
      const snapshot = buildBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(), createdAtIso: "2026-11-03T09:00:00.000Z",
      });
      snapshot.metadata.version = "7";
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
      ledger.close();
      const oldDatabase = new DatabaseSync(dbPath);
      try {
        oldDatabase.exec("ALTER TABLE investment_holdings DROP COLUMN revisions_json");
        oldDatabase.exec("ALTER TABLE holding_valuation_snapshots DROP COLUMN correction_json");
      } finally {
        oldDatabase.close();
      }
      ledger = openLedger(dbPath);
      expect(createHoldingRegistry(ledger).list()).toEqual(expected);
      ledger.replaceLedgerSnapshotData(restoreBackupSnapshot({ snapshotPath }));
      expect(createHoldingRegistry(ledger).list()).toEqual(expected);
      createHoldingRegistry(ledger).correctHolding({
        holdingId: original.id, label: "Corrected fund", quantity: 3,
        costBasisMinor: 45_000, currencyCode: "NOK",
      });
      expect(createHoldingRegistry(ledger).list()[0]?.revisions?.[0]?.label).toBe("Legacy fund");
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("leaves all records unchanged when a correction is invalid", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-holding-invalid-correction-"));
    const ledger = openLedger(join(directory, "ledger.sqlite"));
    try {
      const registry = createHoldingRegistry(ledger);
      const original = registry.create({
        label: "Fund", quantity: 3, costBasisMinor: 45_000, currencyCode: "NOK",
      });
      const value = registry.appendValuation({
        holdingId: original.id, effectiveDateIso: "2026-10-01", amountMinor: 50_000, currencyCode: "NOK",
      });
      const before = registry.list();
      expect(() => registry.correctHolding({
        holdingId: original.id, label: "", quantity: 3, costBasisMinor: 45_000, currencyCode: "NOK",
      })).toThrow(/label/i);
      expect(() => registry.correctValuation({
        holdingId: original.id, targetValuationId: value.id,
        effectiveDateIso: "2026-02-30", amountMinor: 50_000, currencyCode: "NOK",
      })).toThrow(/date/i);
      expect(registry.list()).toEqual(before);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["malformed revision", [{ id: "revision", label: "old" }], []],
    ["malformed correction", undefined, [{ id: "a", correction: {} }]],
    ["missing target", undefined, [{ id: "a", correction: { targetValuationId: "missing" } }]],
    ["cross-holding target", undefined, [
      { id: "a", correction: { targetValuationId: "b" } }, { id: "b", holdingId: "holding-2" },
    ]],
    ["duplicate target", undefined, [
      { id: "a", correction: { targetValuationId: "b" } },
      { id: "b" }, { id: "c", correction: { targetValuationId: "b" } },
    ]],
    ["self-reference", undefined, [{ id: "a", correction: { targetValuationId: "a" } }]],
    ["correction cycle", undefined, [
      { id: "a", correction: { targetValuationId: "b" } },
      { id: "b", correction: { targetValuationId: "a" } },
    ]],
  ])("rejects a snapshot containing a %s", (_name, revisions, valuations) => {
    const directory = mkdtempSync(join(tmpdir(), "budget-holding-invalid-backup-"));
    const snapshotPath = join(directory, "invalid.json");
    try {
      const snapshot: Record<string, unknown> = {
        ...buildBackupSnapshot({
          household: HOUSEHOLD, accounts: [], transactions: [], importJobs: [],
          monthlyCategoryTargets: [], createdAtIso: "2026-11-03T09:00:00.000Z",
        }),
        holdings: ["holding-1", "holding-2"].map((id) => ({
          id, householdId: HOUSEHOLD.id, label: "Fund", quantity: 1,
          costBasisMinor: 100, currencyCode: "NOK", createdAtIso: "2026-10-01T10:00:00.000Z",
          ...(id === "holding-1" && revisions !== undefined ? { revisions } : {}),
        })),
        holdingValuations: valuations.map((value) => ({
          holdingId: "holding-1", effectiveDateIso: "2026-10-01",
          amountMinor: 100, currencyCode: "NOK", recordedAtIso: "2026-10-01T11:00:00.000Z",
          ...value,
        })),
      };
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/holding revision|holding valuation/i);
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
