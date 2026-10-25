import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import type {
  AccountBalanceCheckpoint,
  AccountCoverageAssessment,
  AccountStatementCoveragePeriod,
  Household,
  ImportJob,
  PendingTransactionObservation,
  Transaction,
} from "../../src/domain/types.js";

const household: Household = {
  id: "hh-coverage",
  name: "Synthetic household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const period: AccountStatementCoveragePeriod = {
  id: "period-may",
  accountId: "acc-coverage",
  startDateIso: "2026-05-01",
  endDateIso: "2026-05-31",
  currencyCode: "NOK",
  sourceName: "synthetic-may.csv",
  sourceType: "csv",
  importJobId: "job-coverage",
  importedAtIso: "2026-06-01T09:00:00Z",
  confirmed: true,
  confirmedAtIso: "2026-06-02T09:00:00Z",
};

const openingCheckpoint: AccountBalanceCheckpoint = {
  id: "checkpoint-opening",
  accountId: "acc-coverage",
  dateIso: "2026-05-01",
  currencyCode: "NOK",
  balanceMinor: 100_000,
  source: "Synthetic statement",
  recordedAtIso: "2026-06-02T09:00:00Z",
};

const closingCheckpoint: AccountBalanceCheckpoint = {
  id: "checkpoint-closing",
  accountId: "acc-coverage",
  dateIso: "2026-05-31",
  currencyCode: "NOK",
  balanceMinor: 87_500,
  source: "Synthetic statement",
  recordedAtIso: "2026-06-02T09:00:00Z",
};

const pendingObservation: PendingTransactionObservation = {
  id: "pending-bill",
  householdId: household.id,
  accountId: "acc-coverage",
  transactionDateIso: "2026-05-12",
  amountMinor: -12_500,
  merchantRaw: "Synthetic bill",
  sourceRowIndex: 1,
  currencyCode: "NOK",
  sourceType: "csv",
  sourceReference: "bank-ref-1",
  importJobId: "job-pending",
  status: "confirmed",
  sourceStatus: "Bekreftet",
};

const coverageImportJob: ImportJob = {
  id: "job-coverage",
  householdId: household.id,
  sourceType: "csv",
  sourceName: "synthetic-may.csv",
  startedAtIso: "2026-06-01T09:00:00Z",
};

interface AccountCoverageLedger {
  saveAccountStatementCoveragePeriod: (value: AccountStatementCoveragePeriod) => void;
  appendAccountBalanceCheckpoint: (value: AccountBalanceCheckpoint) => void;
  listAccountStatementCoveragePeriods: (accountId: string) => AccountStatementCoveragePeriod[];
  listAccountBalanceCheckpoints: (accountId: string) => AccountBalanceCheckpoint[];
  getAccountCoverageAssessment: (
    periodId: string,
    evaluatedAtIso: string
  ) => AccountCoverageAssessment;
}

function accountCoverageLedger(
  ledger: ReturnType<typeof createLocalLedgerDatabase>
): ReturnType<typeof createLocalLedgerDatabase> & AccountCoverageLedger {
  const result = ledger as ReturnType<typeof createLocalLedgerDatabase> & AccountCoverageLedger;
  expect(typeof result.saveAccountStatementCoveragePeriod).toBe("function");
  expect(typeof result.appendAccountBalanceCheckpoint).toBe("function");
  expect(typeof result.getAccountCoverageAssessment).toBe("function");
  return result;
}

function createLedger(dbPath: string, initialPending: PendingTransactionObservation[] = []) {
  return createLocalLedgerDatabase({
    dbPath,
    seedData: {
      household,
      accounts: [{
        id: "acc-coverage",
        householdId: household.id,
        name: "Synthetic current account",
        currencyCode: "NOK",
      }],
      transactions: [],
      pendingObservations: initialPending,
      importJobs: initialPending.length === 0
        ? [coverageImportJob]
        : [
            coverageImportJob,
            {
              id: "job-pending",
              householdId: household.id,
              sourceType: "csv",
              sourceName: "synthetic-pending.csv",
              startedAtIso: "2026-05-12T09:00:00Z",
            },
          ],
      monthlyCategoryTargets: [],
    },
  });
}

describe("account coverage local persistence", () => {
  it("persists confirmed periods and appends checkpoints across reopen and backup restore", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-account-coverage-"));
    const databasePath = join(directory, "ledger.sqlite");
    const backupPath = join(directory, "coverage-backup.json");
    const ledger = createLedger(databasePath);
    let isClosed = false;

    try {
      const database = accountCoverageLedger(ledger);
      database.saveAccountStatementCoveragePeriod(period);
      database.appendAccountBalanceCheckpoint(openingCheckpoint);
      database.appendAccountBalanceCheckpoint(closingCheckpoint);
      const revisedClosing = {
        ...closingCheckpoint,
        id: "checkpoint-closing-revised",
        balanceMinor: 100_500,
        recordedAtIso: "2026-06-03T09:00:00Z",
      };
      database.appendAccountBalanceCheckpoint(revisedClosing);
      expect(database.listAccountBalanceCheckpoints("acc-coverage")).toHaveLength(3);

      ledger.close();
      isClosed = true;
      const reopened = createLedger(databasePath);
      try {
        const reopenedCoverage = accountCoverageLedger(reopened);
        expect(reopenedCoverage.listAccountStatementCoveragePeriods("acc-coverage")).toEqual([period]);
        expect(reopenedCoverage.listAccountBalanceCheckpoints("acc-coverage")).toHaveLength(3);
        expect(reopenedCoverage.getAccountCoverageAssessment(
          period.id,
          "2026-06-04T00:00:00Z"
        )).toMatchObject({
          coverageStatus: "confirmed",
          differenceMinor: 500,
          reconciliationStatus: "mismatch",
        });

        createBackupSnapshot({
          ...reopened.loadLedgerSnapshotData(),
          createdAtIso: "2026-06-04T00:00:00Z",
          outputPath: backupPath,
        });
        const restored = restoreBackupSnapshot({ snapshotPath: backupPath });
        expect(restored.accountStatementCoveragePeriods).toEqual([period]);
        expect(restored.accountBalanceCheckpoints).toHaveLength(3);
      } finally {
        reopened.close();
      }
    } finally {
      if (!isClosed) ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("excludes a pending observation before booking and counts the matched transaction exactly once", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-account-coverage-pending-"));
    const ledger = createLedger(join(directory, "ledger.sqlite"), [pendingObservation]);

    try {
      const database = accountCoverageLedger(ledger);
      database.saveAccountStatementCoveragePeriod(period);
      database.appendAccountBalanceCheckpoint(openingCheckpoint);
      database.appendAccountBalanceCheckpoint(closingCheckpoint);

      expect(database.getAccountCoverageAssessment(
        period.id,
        "2026-06-03T00:00:00Z"
      ).differenceMinor).toBe(-12_500);

      const importJob: ImportJob = {
        id: "job-matched",
        householdId: household.id,
        sourceType: "csv",
        sourceName: "synthetic-may.csv",
        startedAtIso: "2026-06-03T09:00:00Z",
      };
      const bookedTransaction: Transaction = {
        id: "booked-bill",
        householdId: household.id,
        accountId: "acc-coverage",
        bookedAtIso: "2026-05-12T00:00:00Z",
        amountMinor: -12_500,
        merchantRaw: "Synthetic bill",
        currencyCode: "NOK",
        sourceType: "csv",
        sourceReference: "bank-ref-1",
        importJobId: importJob.id,
      };

      ledger.appendImportJobAndTransactions(importJob, [bookedTransaction]);
      expect(database.getAccountCoverageAssessment(
        period.id,
        "2026-06-04T00:00:00Z"
      ).differenceMinor).toBe(0);
      expect(ledger.loadLedgerSnapshotData().pendingObservations?.[0]?.reconciledTransactionId)
        .toBe("booked-bill");
      expect(database.getAccountCoverageAssessment(
        period.id,
        "2026-06-04T00:00:00Z"
      ).differenceMinor).toBe(0);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps coverage arithmetic isolated by account and currency", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-account-coverage-isolation-"));
    const ledger = createLedger(join(directory, "ledger.sqlite"));

    try {
      const database = accountCoverageLedger(ledger);
      const sqlite = new DatabaseSync(join(directory, "ledger.sqlite"));
      try {
        sqlite.prepare(`
          INSERT INTO accounts (id, household_id, name, currency_code)
          VALUES (?, ?, ?, ?)
        `).run("acc-eur", household.id, "Synthetic euro account", "EUR");
      } finally {
        sqlite.close();
      }

      const nokPeriod: AccountStatementCoveragePeriod = {
        ...period,
        id: "period-nok",
        confirmedAtIso: "2026-06-02T09:00:00Z",
      };
      const eurPeriod: AccountStatementCoveragePeriod = {
        ...period,
        id: "period-eur",
        accountId: "acc-eur",
        currencyCode: "EUR",
        confirmedAtIso: "2026-06-02T09:00:00Z",
      };
      database.saveAccountStatementCoveragePeriod(nokPeriod);
      database.saveAccountStatementCoveragePeriod(eurPeriod);
      database.appendAccountBalanceCheckpoint({
        ...openingCheckpoint,
        id: "nok-opening",
        balanceMinor: 0,
      });
      database.appendAccountBalanceCheckpoint({
        ...closingCheckpoint,
        id: "nok-closing",
        balanceMinor: 0,
      });
      database.appendAccountBalanceCheckpoint({
        ...openingCheckpoint,
        id: "eur-opening",
        accountId: "acc-eur",
        currencyCode: "EUR",
        balanceMinor: 0,
      });
      database.appendAccountBalanceCheckpoint({
        ...closingCheckpoint,
        id: "eur-closing",
        accountId: "acc-eur",
        currencyCode: "EUR",
        balanceMinor: 0,
      });
      ledger.appendTransactions([{
        id: "tx-eur",
        householdId: household.id,
        accountId: "acc-eur",
        bookedAtIso: "2026-05-12T00:00:00Z",
        amountMinor: -5_000,
        merchantRaw: "Synthetic euro bill",
        currencyCode: "EUR",
      }]);

      expect(database.getAccountCoverageAssessment(
        nokPeriod.id,
        "2026-06-04T00:00:00Z"
      ).differenceMinor).toBe(0);
      expect(database.getAccountCoverageAssessment(
        eurPeriod.id,
        "2026-06-04T00:00:00Z"
      ).differenceMinor).toBe(5_000);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
