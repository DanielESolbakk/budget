import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBackupSnapshot,
  createBackupSnapshot,
} from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { createLoanRegistry } from "../../src/app/loanRegistry.js";
import { createPropertyRegistry } from "../../src/app/propertyRegistry.js";

const HOUSEHOLD = {
  id: "household-loan-test",
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

describe("loan registry persistence and backup", () => {
  it("includes loan terms and dated balances in new backup snapshots", () => {
    const loan = {
      id: "loan-home",
      householdId: HOUSEHOLD.id,
      label: "Home mortgage",
      propertyId: "property-home",
      principalMinor: 300_000_000,
      annualInterestRateBasisPoints: 500,
      termMonths: 300,
      paymentAmountMinor: 1_750_000,
      paymentFrequency: "monthly" as const,
      currencyCode: "NOK",
      createdAtIso: "2026-10-01T08:00:00.000Z",
    };
    const balance = {
      id: "balance-home-1",
      loanId: loan.id,
      effectiveDateIso: "2026-10-01",
      amountMinor: 300_000_000,
      currencyCode: "NOK",
      recordedAtIso: "2026-10-02T09:00:00.000Z",
    };
    const data = {
      household: HOUSEHOLD,
      accounts: [],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
      loanRecords: [{ ...loan, responsibilityShareBasisPoints: 10_000 }],
      loanBalanceSnapshots: [balance],
      createdAtIso: "2026-10-03T09:00:00.000Z",
    };

    const snapshot = buildBackupSnapshot(data);

    expect(snapshot).toMatchObject({
      loanRecords: [loan],
      loanBalanceSnapshots: [balance],
      metadata: { version: "9" },
    });
  });

  it("persists linked and unsecured loans with append-only original-currency balances through restart and restore", () => {
      const directory = mkdtempSync(join(tmpdir(), "budget-loan-history-"));
      const sourcePath = join(directory, "source.sqlite");
      const restoredPath = join(directory, "restored.sqlite");
      const snapshotPath = join(directory, "backup.json");
      const propertyTimes = [
        "2026-09-01T08:00:00.000Z",
        "2026-09-02T09:00:00.000Z",
      ];
      let propertyTimeIndex = 0;
      const propertyDatabase = openLedger(sourcePath);
      let source = propertyDatabase;
      const restored = openLedger(restoredPath);
      const propertyRegistry = createPropertyRegistry(propertyDatabase, {
        createId: () => "property-home",
        now: () => new Date(propertyTimes[propertyTimeIndex++]!),
      });
      const home = propertyRegistry.create({ label: "Home" });
      propertyRegistry.appendValuation({
        propertyId: home.id,
        effectiveDateIso: "2026-09-01",
        amountMinor: 45_000_000,
        currencyCode: "NOK",
      });
      const propertyHistoryBeforeLoans = propertyRegistry.list();
      const recordedTimes = [
        "2026-10-01T08:00:00.000Z",
        "2026-10-02T09:00:00.000Z",
        "2026-11-02T09:00:00.000Z",
        "2026-11-03T10:00:00.000Z",
        "2026-11-04T10:00:00.000Z",
      ];
      let recordedTimeIndex = 0;
      let idIndex = 0;

      try {
        const loans = createLoanRegistry(source, {
          createId: () => `loan-entry-${++idIndex}`,
          now: () => new Date(recordedTimes[recordedTimeIndex++]!),
        });
        const mortgage = loans.create({
          label: "Home mortgage",
          principalMinor: 300_000_000,
          annualInterestRateBasisPoints: 500,
          termMonths: 300,
          paymentAmountMinor: 1_750_000,
          paymentFrequency: "monthly",
          currencyCode: "NOK",
          propertyId: home.id,
        });
        loans.appendBalance({
          loanId: mortgage.id,
          effectiveDateIso: "2026-10-01",
          amountMinor: 300_000_000,
        });
        loans.appendBalance({
          loanId: mortgage.id,
          effectiveDateIso: "2026-11-01",
          amountMinor: 299_500_000,
        });
        const personalLoan = loans.create({
          label: "Personal loan",
          principalMinor: 1_000_000,
          annualInterestRateBasisPoints: 400,
          termMonths: 36,
          paymentAmountMinor: 30_000,
          paymentFrequency: "monthly",
          currencyCode: "EUR",
        });
        loans.appendBalance({
          loanId: personalLoan.id,
          effectiveDateIso: "2026-11-01",
          amountMinor: 900_000,
        });
        const expectedLoans = [
          {
            ...mortgage,
            balances: [
              {
                id: "loan-entry-2",
                loanId: mortgage.id,
                effectiveDateIso: "2026-10-01",
                amountMinor: 300_000_000,
                currencyCode: "NOK",
                recordedAtIso: "2026-10-02T09:00:00.000Z",
              },
              {
                id: "loan-entry-3",
                loanId: mortgage.id,
                effectiveDateIso: "2026-11-01",
                amountMinor: 299_500_000,
                currencyCode: "NOK",
                recordedAtIso: "2026-11-02T09:00:00.000Z",
              },
            ],
          },
          {
            ...personalLoan,
            balances: [
              {
                id: "loan-entry-5",
                loanId: personalLoan.id,
                effectiveDateIso: "2026-11-01",
                amountMinor: 900_000,
                currencyCode: "EUR",
                recordedAtIso: "2026-11-04T10:00:00.000Z",
              },
            ],
          },
        ];

        expect(loans.list()).toEqual(expectedLoans);
        expect(source.listExchangeRates()).toEqual([]);
        expect(propertyRegistry.list()).toEqual(propertyHistoryBeforeLoans);

        source.close();
        source = openLedger(sourcePath);
        expect(createLoanRegistry(source).list()).toEqual(expectedLoans);
        expect(source.listExchangeRates()).toEqual([]);

        createBackupSnapshot({
          ...source.loadLedgerSnapshotData(),
          outputPath: snapshotPath,
          createdAtIso: "2026-11-05T10:00:00.000Z",
        });
        const snapshot = restoreBackupSnapshot({ snapshotPath });
        expect(snapshot.loanRecords).toEqual([
          {
            id: "loan-entry-1",
            householdId: HOUSEHOLD.id,
            label: "Home mortgage",
            propertyId: home.id,
            principalMinor: 300_000_000,
            annualInterestRateBasisPoints: 500,
            termMonths: 300,
            paymentAmountMinor: 1_750_000,
            paymentFrequency: "monthly",
            currencyCode: "NOK",
            createdAtIso: "2026-10-01T08:00:00.000Z",
            responsibilityShareBasisPoints: 10_000,
          },
          {
            id: "loan-entry-4",
            householdId: HOUSEHOLD.id,
            label: "Personal loan",
            principalMinor: 1_000_000,
            annualInterestRateBasisPoints: 400,
            termMonths: 36,
            paymentAmountMinor: 30_000,
            paymentFrequency: "monthly",
            currencyCode: "EUR",
            createdAtIso: "2026-11-03T10:00:00.000Z",
            responsibilityShareBasisPoints: 10_000,
          },
        ]);
        expect(snapshot.loanBalanceSnapshots).toEqual([
          ...expectedLoans[0]!.balances,
          ...expectedLoans[1]!.balances,
        ]);
        restored.replaceLedgerSnapshotData(snapshot);
        expect(createLoanRegistry(restored).list()).toEqual(expectedLoans);
        expect(createPropertyRegistry(restored).list()).toEqual(propertyHistoryBeforeLoans);
        expect(restored.listExchangeRates()).toEqual([]);
      } finally {
        source.close();
        restored.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });

  it("treats version-five snapshots without loans as an empty loan registry", () => {
      const directory = mkdtempSync(join(tmpdir(), "budget-loan-legacy-snapshot-"));
      const snapshotPath = join(directory, "version-five.json");

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
        metadata["version"] = "5";
        delete snapshot["loanRecords"];
        delete snapshot["loanBalanceSnapshots"];
        writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

        const restored = restoreBackupSnapshot({ snapshotPath });

        expect(restored.loanRecords).toEqual([]);
        expect(restored.loanBalanceSnapshots).toEqual([]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
  });
});
