import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBackupSnapshot,
  createBackupSnapshot,
} from "../../src/app/backup/createBackupSnapshot.js";
import { createPropertyRegistry } from "../../src/app/propertyRegistry.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import type { Transaction } from "../../src/domain/types.js";

const HOUSEHOLD = {
  id: "household-property-test",
  name: "Synthetic household",
  createdAtIso: "2026-01-01T00:00:00.000Z",
};

function openLedger(dbPath: string) {
  return createLocalLedgerDatabase({
    dbPath,
    seedData: {
      household: HOUSEHOLD,
      accounts: [{ id: "account-nok", householdId: HOUSEHOLD.id, name: "Current", currencyCode: "NOK" }],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });
}

describe("property value history persistence", () => {
  it("includes properties and valuation snapshots in new backup snapshots", () => {
    const property = {
      id: "property-home",
      householdId: HOUSEHOLD.id,
      label: "Home",
      createdAtIso: "2026-09-01T09:00:00.000Z",
    };
    const valuation = {
      id: "valuation-home-nok",
      propertyId: property.id,
      effectiveDateIso: "2026-10-01",
      amountMinor: 500_000_000,
      currencyCode: "NOK",
      recordedAtIso: "2026-10-02T09:00:00.000Z",
    };
    const data = {
      household: HOUSEHOLD,
      accounts: [],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
      properties: [property],
      propertyValuations: [valuation],
      createdAtIso: "2026-10-03T09:00:00.000Z",
    };
    const built = JSON.parse(JSON.stringify(buildBackupSnapshot(data))) as Record<string, unknown>;

    expect(built["properties"]).toEqual([{ ...property, ownershipShareBasisPoints: 10_000 }]);
    expect(built["propertyValuations"]).toEqual([valuation]);
  });

  it("uses a new snapshot version for append-only valuation corrections", () => {
    expect(buildBackupSnapshot({
      household: HOUSEHOLD,
      accounts: [],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
      createdAtIso: "2026-10-03T09:00:00.000Z",
    }).metadata.version).toBe("9");
  });

  it("restores property records and valuation snapshots unchanged", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-property-snapshot-"));
    const snapshotPath = join(directory, "backup.json");
    const property = {
      id: "property-home",
      householdId: HOUSEHOLD.id,
      label: "Home",
      createdAtIso: "2026-09-01T09:00:00.000Z",
    };
    const valuation = {
      id: "valuation-home-eur",
      propertyId: property.id,
      effectiveDateIso: "2026-11-01",
      amountMinor: 45_000_000,
      currencyCode: "EUR",
      recordedAtIso: "2026-11-02T09:00:00.000Z",
    };

    try {
      createBackupSnapshot({
        household: HOUSEHOLD,
        accounts: [],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
        properties: [property],
        propertyValuations: [valuation],
        createdAtIso: "2026-11-03T12:00:00.000Z",
        outputPath: snapshotPath,
      });

      const restored = restoreBackupSnapshot({ snapshotPath });

      expect(restored.properties).toEqual([{ ...property, ownershipShareBasisPoints: 10_000 }]);
      expect(restored.propertyValuations).toEqual([valuation]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates version-3 snapshots without property collections to empty history", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-property-legacy-snapshot-"));
    const snapshotPath = join(directory, "legacy.json");

    try {
      const snapshot = JSON.parse(JSON.stringify(buildBackupSnapshot({
        household: HOUSEHOLD,
        accounts: [],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
        createdAtIso: "2026-10-03T09:00:00.000Z",
      }))) as Record<string, unknown>;
      const metadata = snapshot["metadata"] as Record<string, unknown>;
      metadata["version"] = "3";
      delete snapshot["properties"];
      delete snapshot["propertyValuations"];
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      const restored = restoreBackupSnapshot({ snapshotPath });

      expect(restored.properties).toEqual([]);
      expect(restored.propertyValuations).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores version-4 valuation snapshots without correction metadata", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-property-version-four-"));
    const snapshotPath = join(directory, "version-four.json");
    const property = {
      id: "property-home",
      householdId: HOUSEHOLD.id,
      label: "Home",
      createdAtIso: "2026-09-01T09:00:00.000Z",
    };
    const valuation = {
      id: "valuation-home",
      propertyId: property.id,
      effectiveDateIso: "2026-10-01",
      amountMinor: 500_000_000,
      currencyCode: "NOK",
      recordedAtIso: "2026-10-02T09:00:00.000Z",
    };

    try {
      const snapshot = JSON.parse(JSON.stringify(buildBackupSnapshot({
        household: HOUSEHOLD,
        accounts: [],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
        properties: [property],
        propertyValuations: [valuation],
        createdAtIso: "2026-10-03T09:00:00.000Z",
      }))) as Record<string, unknown>;
      const metadata = snapshot["metadata"] as Record<string, unknown>;
      metadata["version"] = "4";
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

      const restored = restoreBackupSnapshot({ snapshotPath });

      expect(restored.properties).toEqual([{ ...property, ownershipShareBasisPoints: 10_000 }]);
      expect(restored.propertyValuations).toEqual([valuation]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps dated original-currency valuations append-only after reopening SQLite", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-property-history-"));
    const dbPath = join(directory, "ledger.sqlite");
    let timestampIndex = 0;
    const recordedTimes = [
      "2026-09-01T09:00:00.000Z",
      "2026-10-02T09:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ];
    let idIndex = 0;
    let ledger = openLedger(dbPath);

    try {
      const registry = createPropertyRegistry(ledger, {
        createId: () => `property-record-${++idIndex}`,
        now: () => new Date(recordedTimes[timestampIndex++]!),
      });
      const property = registry.create({ label: "Home" });

      registry.appendValuation({
        propertyId: property.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 500_000_000,
        currencyCode: "NOK",
      });
      registry.appendValuation({
        propertyId: property.id,
        effectiveDateIso: "2026-11-01",
        amountMinor: 45_000_000,
        currencyCode: "EUR",
      });

      ledger.close();
      ledger = openLedger(dbPath);
      const reopened = createPropertyRegistry(ledger);
      const [restoredProperty] = reopened.list();

      expect(restoredProperty?.label).toBe("Home");
      expect(restoredProperty?.valuations).toEqual([
        {
          id: "property-record-2",
          propertyId: property.id,
          effectiveDateIso: "2026-10-01",
          amountMinor: 500_000_000,
          currencyCode: "NOK",
          recordedAtIso: "2026-10-02T09:00:00.000Z",
        },
        {
          id: "property-record-3",
          propertyId: property.id,
          effectiveDateIso: "2026-11-01",
          amountMinor: 45_000_000,
          currencyCode: "EUR",
          recordedAtIso: "2026-11-02T09:00:00.000Z",
        },
      ]);
      expect(ledger.listExchangeRates()).toEqual([]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores property valuations and preserves existing accounts and transactions", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-property-backup-"));
    const sourcePath = join(directory, "source.sqlite");
    const restoredPath = join(directory, "restored.sqlite");
    const snapshotPath = join(directory, "backup.json");
    let idIndex = 0;
    let timestampIndex = 0;
    const recordedTimes = [
      "2026-09-01T09:00:00.000Z",
      "2026-10-02T09:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ];
    const source = openLedger(sourcePath);
    const restored = openLedger(restoredPath);

    try {
      const transaction: Transaction = {
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
        transactions: [transaction],
      });
      const existingLedgerData = source.loadLedgerSnapshotData();
      const registry = createPropertyRegistry(source, {
        createId: () => `property-record-${++idIndex}`,
        now: () => new Date(recordedTimes[timestampIndex++]!),
      });
      const property = registry.create({ label: "Home" });
      registry.appendValuation({
        propertyId: property.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 500_000_000,
        currencyCode: "NOK",
      });
      registry.appendValuation({
        propertyId: property.id,
        effectiveDateIso: "2026-11-01",
        amountMinor: 45_000_000,
        currencyCode: "EUR",
      });

      createBackupSnapshot({
        ...source.loadLedgerSnapshotData(),
        outputPath: snapshotPath,
        createdAtIso: "2026-11-03T12:00:00.000Z",
      });
      const snapshot = restoreBackupSnapshot({ snapshotPath });
      restored.replaceLedgerSnapshotData(snapshot);
      const [restoredProperty] = createPropertyRegistry(restored).list();
      const restoredLedgerData = restored.loadLedgerSnapshotData();

      expect(restoredProperty).toMatchObject(property);
      expect(restoredProperty?.label).toBe("Home");
      expect(restoredProperty?.valuations).toHaveLength(2);
      expect(restoredProperty?.valuations).toEqual([
        {
          id: "property-record-2",
          propertyId: property.id,
          effectiveDateIso: "2026-10-01",
          amountMinor: 500_000_000,
          currencyCode: "NOK",
          recordedAtIso: "2026-10-02T09:00:00.000Z",
        },
        {
          id: "property-record-3",
          propertyId: property.id,
          effectiveDateIso: "2026-11-01",
          amountMinor: 45_000_000,
          currencyCode: "EUR",
          recordedAtIso: "2026-11-02T09:00:00.000Z",
        },
      ]);
      expect(restoredLedgerData.accounts).toEqual(existingLedgerData.accounts);
      expect(restoredLedgerData.transactions).toEqual(existingLedgerData.transactions);
      expect(restored.listExchangeRates()).toEqual([]);
    } finally {
      source.close();
      restored.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("appends supersede and void correction records and preserves their links in backup recovery", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-property-corrections-"));
    const sourcePath = join(directory, "source.sqlite");
    const restoredPath = join(directory, "restored.sqlite");
    const snapshotPath = join(directory, "backup.json");
    const recordedTimes = [
      "2026-09-01T09:00:00.000Z",
      "2026-10-02T09:00:00.000Z",
      "2026-10-03T09:00:00.000Z",
      "2026-10-04T09:00:00.000Z",
    ];
    let timestampIndex = 0;
    let idIndex = 0;
    let source = openLedger(sourcePath);
    const restored = openLedger(restoredPath);

    try {
      const registry = createPropertyRegistry(source, {
        createId: () => `property-record-${++idIndex}`,
        now: () => new Date(recordedTimes[timestampIndex++]!),
      });
      const property = registry.create({ label: "Home" });
      const original = registry.appendValuation({
        propertyId: property.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 500_000_000,
        currencyCode: "NOK",
      });
      const corrected = registry.appendCorrection({
        action: "supersede",
        propertyId: property.id,
        targetValuationId: original.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 480_000_000,
        currencyCode: "NOK",
      });
      expect(() => registry.appendCorrection({
        action: "void",
        propertyId: property.id,
        targetValuationId: original.id,
      })).toThrow("Property valuation has already been corrected");
      const voidRecord = registry.appendCorrection({
        action: "void",
        propertyId: property.id,
        targetValuationId: corrected.id,
      });
      const expectedValuations = [
        original,
        {
          ...corrected,
          correction: { action: "supersede", targetValuationId: original.id },
        },
        {
          ...voidRecord,
          correction: { action: "void", targetValuationId: corrected.id },
        },
      ];

      expect(registry.list()[0]?.valuations).toEqual(expectedValuations);
      expect(original).toMatchObject({
        amountMinor: 500_000_000,
        currencyCode: "NOK",
        recordedAtIso: "2026-10-02T09:00:00.000Z",
      });

      source.close();
      source = openLedger(sourcePath);
      expect(createPropertyRegistry(source).list()[0]?.valuations).toEqual(expectedValuations);

      createBackupSnapshot({
        ...source.loadLedgerSnapshotData(),
        outputPath: snapshotPath,
        createdAtIso: "2026-10-05T12:00:00.000Z",
      });
      const snapshot = restoreBackupSnapshot({ snapshotPath });
      restored.replaceLedgerSnapshotData(snapshot);
      expect(createPropertyRegistry(restored).list()[0]?.valuations).toEqual(expectedValuations);
      expect(restored.listExchangeRates()).toEqual([]);
    } finally {
      source.close();
      restored.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renames a property without changing its dated valuation history", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-property-rename-"));
    const dbPath = join(directory, "ledger.sqlite");
    let idIndex = 0;
    let timestampIndex = 0;
    const recordedTimes = [
      "2026-09-01T09:00:00.000Z",
      "2026-10-02T09:00:00.000Z",
    ];
    const ledger = openLedger(dbPath);

    try {
      const registry = createPropertyRegistry(ledger, {
        createId: () => `property-record-${++idIndex}`,
        now: () => new Date(recordedTimes[timestampIndex++]!),
      });
      const property = registry.create({ label: "Home" });
      const valuation = registry.appendValuation({
        propertyId: property.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 500_000_000,
        currencyCode: "NOK",
      });

      const renamed = registry.renameProperty({ propertyId: property.id, label: "Primary home" });

      expect(renamed).toMatchObject({ ...property, label: "Primary home" });
      expect(registry.list()).toEqual([
        { ...property, label: "Primary home", valuations: [valuation] },
      ]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates an existing valuation table to store correction metadata", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-property-correction-migration-"));
    const dbPath = join(directory, "ledger.sqlite");
    let idIndex = 0;
    let timestampIndex = 0;
    const recordedTimes = [
      "2026-09-01T09:00:00.000Z",
      "2026-10-02T09:00:00.000Z",
    ];
    let ledger = openLedger(dbPath);

    try {
      const registry = createPropertyRegistry(ledger, {
        createId: () => `property-record-${++idIndex}`,
        now: () => new Date(recordedTimes[timestampIndex++]!),
      });
      const property = registry.create({ label: "Home" });
      const valuation = registry.appendValuation({
        propertyId: property.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 500_000_000,
        currencyCode: "NOK",
      });
      ledger.close();

      const legacyDatabase = new DatabaseSync(dbPath);
      try {
        legacyDatabase.exec("ALTER TABLE property_valuation_snapshots DROP COLUMN correction_json");
      } finally {
        legacyDatabase.close();
      }

      ledger = openLedger(dbPath);
      expect(createPropertyRegistry(ledger).list()[0]?.valuations).toEqual([valuation]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
