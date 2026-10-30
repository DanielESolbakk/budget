import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { createLoanRegistry } from "../../src/app/loanRegistry.js";
import { createPropertyRegistry } from "../../src/app/propertyRegistry.js";
import type { BackupSnapshot } from "../../src/domain/backup/snapshotContract.js";

describe("household share defaults", () => {
  it("defaults new property ownership and loan responsibility independently to 10000 basis points", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-share-story-"));
    const household = {
      id: "household-share",
      name: "Synthetic household",
      createdAtIso: "2026-01-01T00:00:00.000Z",
    };
    const database = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household,
        accounts: [],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const properties = createPropertyRegistry(database);
      const loans = createLoanRegistry(database);
      const property = properties.create({ label: "Home" });
      const loan = loans.create({
        label: "Mortgage",
        principalMinor: 300_000_000,
        annualInterestRateBasisPoints: 500,
        termMonths: 300,
        paymentAmountMinor: 1_750_000,
        paymentFrequency: "monthly",
        currencyCode: "NOK",
        propertyId: property.id,
      });

      expect(property).toHaveProperty("ownershipShareBasisPoints", 10_000);
      expect(loan).toHaveProperty("responsibilityShareBasisPoints", 10_000);
      expect(properties.list()[0]).toHaveProperty("ownershipShareBasisPoints", 10_000);
      expect(loans.list()[0]).toHaveProperty("responsibilityShareBasisPoints", 10_000);
      expect(properties).toHaveProperty("updateOwnershipShare", expect.any(Function));
      expect(loans).toHaveProperty("updateResponsibilityShare", expect.any(Function));
      properties.updateOwnershipShare({ propertyId: property.id, ownershipShareBasisPoints: 7_500 });
      loans.updateResponsibilityShare({ loanId: loan.id, responsibilityShareBasisPoints: 5_000 });
      properties.updateOwnershipShare({ propertyId: property.id, ownershipShareBasisPoints: 6_000 });
      expect(properties.list()[0]).toHaveProperty("ownershipShareBasisPoints", 6_000);
      expect(loans.list()[0]).toHaveProperty("responsibilityShareBasisPoints", 5_000);
      for (const invalid of [-1, 10_001, 5_000.5]) {
        expect(() => properties.updateOwnershipShare({
          propertyId: property.id,
          ownershipShareBasisPoints: invalid,
        })).toThrow();
        expect(() => loans.updateResponsibilityShare({
          loanId: loan.id,
          responsibilityShareBasisPoints: invalid,
        })).toThrow();
      }
      expect(properties.list()[0]).toHaveProperty("ownershipShareBasisPoints", 6_000);
      expect(loans.list()[0]).toHaveProperty("responsibilityShareBasisPoints", 5_000);
      expect(loans.list()[0]).toMatchObject({ principalMinor: 300_000_000, currencyCode: "NOK" });
      database.createPropertyRecord({ ...property, id: "another-property", ownershipShareBasisPoints: 0 });
      database.createLoanRecord({ ...loan, id: "another-loan", responsibilityShareBasisPoints: 7_500 });
      expect(database.listPropertyRecords(household.id).find((record) => record.id === "another-property"))
        .toHaveProperty("ownershipShareBasisPoints", 0);
      expect(database.listLoanRecords(household.id).find((record) => record.id === "another-loan"))
        .toHaveProperty("responsibilityShareBasisPoints", 7_500);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves independent shares and original values after restart and backup restore", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-share-recovery-"));
    const sourcePath = join(directory, "source.sqlite");
    const restoredPath = join(directory, "restored.sqlite");
    const snapshotPath = join(directory, "snapshot.json");
    const household = {
      id: "household-share",
      name: "Synthetic household",
      createdAtIso: "2026-01-01T00:00:00.000Z",
    };
    const seedData = { household, accounts: [], transactions: [], importJobs: [], monthlyCategoryTargets: [] };
    let source = createLocalLedgerDatabase({ dbPath: sourcePath, seedData });
    const restored = createLocalLedgerDatabase({ dbPath: restoredPath, seedData });
    try {
      const properties = createPropertyRegistry(source);
      const loans = createLoanRegistry(source);
      const property = properties.create({ label: "Home" });
      properties.appendValuation({
        propertyId: property.id, effectiveDateIso: "2026-10-01", amountMinor: 500_000_000, currencyCode: "NOK",
      });
      const loan = loans.create({
        label: "Mortgage", principalMinor: 300_000_000, annualInterestRateBasisPoints: 500,
        termMonths: 300, paymentAmountMinor: 1_750_000, paymentFrequency: "monthly",
        currencyCode: "NOK", propertyId: property.id,
      });
      loans.appendBalance({ loanId: loan.id, effectiveDateIso: "2026-10-01", amountMinor: 300_000_000 });
      properties.updateOwnershipShare({ propertyId: property.id, ownershipShareBasisPoints: 7_500 });
      loans.updateResponsibilityShare({ loanId: loan.id, responsibilityShareBasisPoints: 5_000 });
      expect(properties.list()[0]?.ownershipShareBasisPoints).toBe(7_500);
      properties.updateOwnershipShare({ propertyId: property.id, ownershipShareBasisPoints: 6_000 });
      expect(loans.list()[0]?.responsibilityShareBasisPoints).toBe(5_000);
      const expectedProperties = properties.list();
      const expectedLoans = loans.list();
      expect(expectedProperties[0]?.valuations[0]).toMatchObject({
        amountMinor: 500_000_000, currencyCode: "NOK",
      });
      expect(expectedLoans[0]).toMatchObject({ principalMinor: 300_000_000, currencyCode: "NOK" });
      expect(expectedLoans[0]?.balances[0]).toMatchObject({
        amountMinor: 300_000_000, currencyCode: "NOK",
      });
      source.close();
      source = createLocalLedgerDatabase({ dbPath: sourcePath, seedData });
      expect(createPropertyRegistry(source).list()).toEqual(expectedProperties);
      expect(createLoanRegistry(source).list()).toEqual(expectedLoans);
      createBackupSnapshot({ ...source.loadLedgerSnapshotData(), outputPath: snapshotPath });
      restored.replaceLedgerSnapshotData(restoreBackupSnapshot({ snapshotPath }));
      expect(createPropertyRegistry(restored).list()).toEqual(expectedProperties);
      expect(createLoanRegistry(restored).list()).toEqual(expectedLoans);
      const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
      expect(snapshot.metadata.version).toBe("9");
      snapshot.properties[0].ownershipShareBasisPoints = 10_001;
      writeFileSync(snapshotPath, JSON.stringify(snapshot));
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow();
      expect(createPropertyRegistry(restored).list()).toEqual(expectedProperties);
      snapshot.properties[0].ownershipShareBasisPoints = 6_000;
      snapshot.loanRecords[0].responsibilityShareBasisPoints = 5_000.5;
      writeFileSync(snapshotPath, JSON.stringify(snapshot));
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow();
      expect(createLoanRegistry(restored).list()).toEqual(expectedLoans);
      snapshot.metadata.version = "8";
      delete snapshot.properties[0].ownershipShareBasisPoints;
      delete snapshot.loanRecords[0].responsibilityShareBasisPoints;
      writeFileSync(snapshotPath, JSON.stringify(snapshot));
      const legacy = restoreBackupSnapshot({ snapshotPath });
      expect(legacy.properties[0]).toHaveProperty("ownershipShareBasisPoints", 10_000);
      expect(legacy.loanRecords[0]).toHaveProperty("responsibilityShareBasisPoints", 10_000);
      restored.replaceLedgerSnapshotData(legacy);
      expect(createPropertyRegistry(restored).list()[0]?.valuations).toEqual(expectedProperties[0]?.valuations);
      expect(createLoanRegistry(restored).list()[0]?.balances).toEqual(expectedLoans[0]?.balances);
    } finally {
      source.close();
      restored.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(["property", "loan"] as const)(
    "rejects a version 9 snapshot missing its %s share without changing the ledger",
    (missingShare) => {
      const directory = mkdtempSync(join(tmpdir(), "budget-share-incomplete-backup-"));
      const snapshotPath = join(directory, "snapshot.json");
      const household = {
        id: "household-share",
        name: "Synthetic household",
        createdAtIso: "2026-01-01T00:00:00.000Z",
      };
      const database = createLocalLedgerDatabase({
        dbPath: join(directory, "ledger.sqlite"),
        seedData: { household, accounts: [], transactions: [], importJobs: [], monthlyCategoryTargets: [] },
      });

      try {
        const properties = createPropertyRegistry(database);
        const loans = createLoanRegistry(database);
        const property = properties.create({ label: "Home" });
        const loan = loans.create({
          label: "Mortgage", principalMinor: 300_000_000, annualInterestRateBasisPoints: 500,
          termMonths: 300, paymentAmountMinor: 1_750_000, paymentFrequency: "monthly",
          currencyCode: "NOK", propertyId: property.id,
        });
        properties.updateOwnershipShare({ propertyId: property.id, ownershipShareBasisPoints: 7_500 });
        loans.updateResponsibilityShare({ loanId: loan.id, responsibilityShareBasisPoints: 5_000 });
        createBackupSnapshot({ ...database.loadLedgerSnapshotData(), outputPath: snapshotPath });
        const snapshot: BackupSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
        expect(snapshot.metadata.version).toBe("9");
        if (missingShare === "property") {
          delete snapshot.properties[0]!.ownershipShareBasisPoints;
        } else {
          delete snapshot.loanRecords[0]!.responsibilityShareBasisPoints;
        }
        writeFileSync(snapshotPath, JSON.stringify(snapshot));

        expect(() => database.replaceLedgerSnapshotData(restoreBackupSnapshot({ snapshotPath })))
          .toThrow(/Invalid snapshot/);
        expect(properties.list()[0]?.ownershipShareBasisPoints).toBe(7_500);
        expect(loans.list()[0]?.responsibilityShareBasisPoints).toBe(5_000);
      } finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it("migrates existing property and loan tables without shares to 10000", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-share-migration-"));
    const dbPath = join(directory, "ledger.sqlite");
    const seedData = {
      household: { id: "legacy-household", name: "Synthetic household", createdAtIso: "2026-01-01T00:00:00.000Z" },
      accounts: [], transactions: [], importJobs: [], monthlyCategoryTargets: [],
    };
    let database = createLocalLedgerDatabase({ dbPath, seedData });
    try {
      const property = createPropertyRegistry(database).create({ label: "Legacy home" });
      createLoanRegistry(database).create({
        label: "Legacy mortgage", principalMinor: 300_000_000, annualInterestRateBasisPoints: 500,
        termMonths: 300, paymentAmountMinor: 1_750_000, paymentFrequency: "monthly",
        currencyCode: "NOK", propertyId: property.id,
      });
      database.close();
      const legacy = new DatabaseSync(dbPath);
      try {
        legacy.exec("ALTER TABLE properties DROP COLUMN ownership_share_basis_points");
        legacy.exec("ALTER TABLE loan_records DROP COLUMN responsibility_share_basis_points");
      } finally {
        legacy.close();
      }
      database = createLocalLedgerDatabase({ dbPath, seedData });
      expect(createPropertyRegistry(database).list()[0]).toHaveProperty("ownershipShareBasisPoints", 10_000);
      expect(createLoanRegistry(database).list()[0]).toHaveProperty("responsibilityShareBasisPoints", 10_000);
      const migratedProperty = createPropertyRegistry(database).list()[0]!;
      const migratedLoan = createLoanRegistry(database).list()[0]!;
      expect(() => createPropertyRegistry(database).updateOwnershipShare({
        propertyId: migratedProperty.id, ownershipShareBasisPoints: 10_001,
      })).toThrow();
      expect(() => createLoanRegistry(database).updateResponsibilityShare({
        loanId: migratedLoan.id, responsibilityShareBasisPoints: -1,
      })).toThrow();
      database.close();
      database = createLocalLedgerDatabase({ dbPath, seedData });
      expect(createPropertyRegistry(database).list()[0]?.ownershipShareBasisPoints).toBe(10_000);
      expect(createLoanRegistry(database).list()[0]?.responsibilityShareBasisPoints).toBe(10_000);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
