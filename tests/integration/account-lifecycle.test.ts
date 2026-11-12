import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountLifecycleService } from "../../src/app/accountLifecycleService.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import type {
  AccountBalanceCheckpoint,
  AccountStatementCoveragePeriod,
  ImportJob,
  Transaction,
} from "../../src/domain/types.js";

const temporaryDirectories: string[] = [];
const closeLedgers: Array<() => void> = [];
const networkFetch = vi.fn(() => {
  throw new Error("Network access is not allowed in account lifecycle integration tests.");
});

beforeEach(() => {
  networkFetch.mockClear();
  vi.stubGlobal("fetch", networkFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const closeLedger of closeLedgers.splice(0)) closeLedger();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createEmptyLedger() {
  const directory = mkdtempSync(join(tmpdir(), "budget-account-lifecycle-"));
  temporaryDirectories.push(directory);
  const dbPath = join(directory, "ledger.sqlite");
  const ledger = createLocalLedgerDatabase({ dbPath });
  closeLedgers.push(ledger.close);
  return { dbPath, ledger };
}

function createAccountWithHistory() {
  const { dbPath, ledger } = createEmptyLedger();
  const initial = ledger.createInitialHouseholdAndAccount({
    householdName: "Test Household",
    accountName: "Checking",
    currencyCode: "NOK",
  });
  const importJob: ImportJob = {
    id: "job-existing",
    householdId: initial.household.id,
    sourceType: "csv",
    sourceName: "synthetic-may-statement.csv",
    startedAtIso: "2026-05-01T00:00:00Z",
    finishedAtIso: "2026-05-01T00:01:00Z",
    provenance: {
      sourceIdentity: "synthetic-may-statement",
      accountId: initial.account.id,
    },
  };
  const transaction: Transaction = {
    id: "tx-existing",
    householdId: initial.household.id,
    accountId: initial.account.id,
    bookedAtIso: "2026-05-12T00:00:00Z",
    amountMinor: -12_500,
    merchantRaw: "Synthetic grocery",
    currencyCode: "NOK",
    sourceType: "csv",
    sourceReference: "synthetic-row-1",
    importJobId: importJob.id,
  };
  const coveragePeriod: AccountStatementCoveragePeriod = {
    id: "period-existing",
    accountId: initial.account.id,
    startDateIso: "2026-05-01",
    endDateIso: "2026-05-31",
    currencyCode: "NOK",
    sourceName: "synthetic-may-statement.csv",
    sourceType: "csv",
    importJobId: importJob.id,
    importedAtIso: "2026-05-01T00:01:00Z",
    confirmed: true,
    confirmedAtIso: "2026-06-01T00:00:00Z",
  };
  const checkpoint: AccountBalanceCheckpoint = {
    id: "checkpoint-existing",
    accountId: initial.account.id,
    dateIso: "2026-05-31",
    currencyCode: "NOK",
    balanceMinor: 87_500,
    source: "synthetic statement",
    sourceReference: "synthetic-may-statement.csv",
    recordedAtIso: "2026-06-01T00:00:00Z",
  };
  ledger.appendImportJobAndTransactions(importJob, [transaction]);
  ledger.saveAccountStatementCoveragePeriod(coveragePeriod);
  ledger.appendAccountBalanceCheckpoint(checkpoint);

  return { dbPath, ledger, household: initial.household, account: initial.account };
}

describe("additional account persistence", () => {
  it("rejects invalid account details without changing the existing account", () => {
    const { ledger } = createEmptyLedger();
    const initial = ledger.createInitialHouseholdAndAccount({
      householdName: "Test Household",
      accountName: "Checking",
      currencyCode: "NOK",
    });

    expect(() =>
      ledger.createAccount({
        householdId: initial.household.id,
        accountName: " ",
        currencyCode: "NOK",
      })
    ).toThrow("Enter an account name.");
    expect(ledger.getAccountsForHousehold(initial.household.id)).toEqual([initial.account]);

    expect(() =>
      ledger.createAccount({
        householdId: initial.household.id,
        accountName: "Savings",
        currencyCode: "N!",
      })
    ).toThrow("Enter a three-letter currency code, such as NOK.");
    expect(ledger.getAccountsForHousehold(initial.household.id)).toEqual([initial.account]);
  });

  it("adds a normalized account to the existing household and preserves it after reopening", () => {
    const { dbPath, ledger } = createEmptyLedger();
    const initial = ledger.createInitialHouseholdAndAccount({
      householdName: "Test Household",
      accountName: "Checking",
      currencyCode: "NOK",
    });
    const transaction: Transaction = {
      id: "tx-existing",
      householdId: initial.household.id,
      accountId: initial.account.id,
      bookedAtIso: "2026-05-12T00:00:00Z",
      amountMinor: -12_500,
      merchantRaw: "Synthetic grocery",
      currencyCode: "NOK",
      sourceType: "manual",
    };
    const coveragePeriod: AccountStatementCoveragePeriod = {
      id: "period-existing",
      accountId: initial.account.id,
      startDateIso: "2026-05-01",
      endDateIso: "2026-05-31",
      currencyCode: "NOK",
      sourceName: "synthetic-may-statement",
      sourceType: "manual",
      confirmed: true,
      confirmedAtIso: "2026-06-01T00:00:00Z",
    };
    const checkpoint: AccountBalanceCheckpoint = {
      id: "checkpoint-existing",
      accountId: initial.account.id,
      dateIso: "2026-05-31",
      currencyCode: "NOK",
      balanceMinor: 87_500,
      source: "synthetic statement",
      recordedAtIso: "2026-06-01T00:00:00Z",
    };
    ledger.appendTransactions([transaction]);
    ledger.saveAccountStatementCoveragePeriod(coveragePeriod);
    ledger.appendAccountBalanceCheckpoint(checkpoint);

    const additional = ledger.createAccount({
      householdId: initial.household.id,
      accountName: "  Savings  ",
      currencyCode: "sek",
    });

    expect(additional).toMatchObject({
      householdId: initial.household.id,
      name: "Savings",
      currencyCode: "SEK",
    });
    expect(ledger.getAccountsForHousehold(initial.household.id)).toEqual(
      expect.arrayContaining([initial.account, additional])
    );
    expect(ledger.getAccountsForHousehold(initial.household.id)).toHaveLength(2);
    expect(ledger.getTransactionsForAccount(initial.account.id)).toEqual([transaction]);
    expect(ledger.listAccountStatementCoveragePeriods(initial.account.id)).toEqual([coveragePeriod]);
    expect(ledger.listAccountBalanceCheckpoints(initial.account.id)).toEqual([checkpoint]);
    expect(networkFetch).not.toHaveBeenCalled();

    const reopenedLedger = createLocalLedgerDatabase({ dbPath });
    closeLedgers.push(reopenedLedger.close);
    expect(reopenedLedger.getAccountsForHousehold(initial.household.id)).toEqual(
      expect.arrayContaining([initial.account, additional])
    );
    expect(reopenedLedger.getTransactionsForAccount(initial.account.id)).toEqual([transaction]);
    expect(reopenedLedger.listAccountStatementCoveragePeriods(initial.account.id)).toEqual([coveragePeriod]);
    expect(reopenedLedger.listAccountBalanceCheckpoints(initial.account.id)).toEqual([checkpoint]);
  });
});

describe("account editing persistence", () => {
  it("persists a rename without changing transaction, import, coverage, or checkpoint history", () => {
    const { dbPath, ledger, household, account } = createAccountWithHistory();
    const accountLifecycle = createAccountLifecycleService(ledger);
    const before = ledger.loadLedgerSnapshotData();

    expect(accountLifecycle.getHistorySummary(account.id)).toEqual({
      transactionCount: 1,
      coveragePeriodCount: 1,
      checkpointCount: 1,
    });
    expect(accountLifecycle.updateAccount({
      accountId: account.id,
      accountName: "  Main account  ",
      currencyCode: "NOK",
    })).toEqual({ ...account, name: "Main account" });

    const updated = ledger.loadLedgerSnapshotData();
    expect(updated.transactions).toEqual(before.transactions);
    expect(updated.importJobs).toEqual(before.importJobs);
    expect(updated.accountStatementCoveragePeriods).toEqual(before.accountStatementCoveragePeriods);
    expect(updated.accountBalanceCheckpoints).toEqual(before.accountBalanceCheckpoints);
    expect(networkFetch).not.toHaveBeenCalled();

    const reopenedLedger = createLocalLedgerDatabase({ dbPath });
    closeLedgers.push(reopenedLedger.close);
    expect(reopenedLedger.getAccountsForHousehold(household.id))
      .toEqual([{ ...account, name: "Main account" }]);
    const reopened = reopenedLedger.loadLedgerSnapshotData();
    expect(reopened.transactions).toEqual(before.transactions);
    expect(reopened.importJobs).toEqual(before.importJobs);
    expect(reopened.accountStatementCoveragePeriods).toEqual(before.accountStatementCoveragePeriods);
    expect(reopened.accountBalanceCheckpoints).toEqual(before.accountBalanceCheckpoints);
  });

  it("rejects a currency change when any account history exists without changing the ledger", () => {
    const { ledger, account } = createAccountWithHistory();
    const accountLifecycle = createAccountLifecycleService(ledger);
    const before = ledger.loadLedgerSnapshotData();

    expect(() => accountLifecycle.updateAccount({
      accountId: account.id,
      accountName: account.name,
      currencyCode: "SEK",
    })).toThrow("Create another account instead.");

    expect(ledger.loadLedgerSnapshotData()).toEqual(before);
    expect(networkFetch).not.toHaveBeenCalled();
  });
});
