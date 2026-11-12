import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountLifecycleService } from "../../src/app/accountLifecycleService.js";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { exportLedgerCsvToFile } from "../../src/app/exportCsv.js";
import { createSpendableCashService } from "../../src/app/spendableCashService.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { submitManualEntry } from "../../src/app/import/manualEntry.js";
import { selectActiveAccounts } from "../../src/shared/accountLifecycle.js";
import type {
  AccountBalanceCheckpoint,
  AccountStatementCoveragePeriod,
  ImportJob,
  ManualEntryInput,
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

describe("account archiving persistence", () => {
  it("retains account history and archive state across restart and backup restore", () => {
    const { dbPath, ledger, household, account } = createAccountWithHistory();
    const savings = ledger.createAccount({
      householdId: household.id,
      accountName: "Savings",
      currencyCode: "NOK",
    });
    const lifecycle = createAccountLifecycleService(ledger);
    const archivedAtIso = "2026-11-12T10:00:00.000Z";
    const beforeArchive = ledger.loadLedgerSnapshotData();
    expect(lifecycle.archiveAccount(account.id, archivedAtIso)).toEqual({
      ...account,
      archivedAtIso,
    });

    const archivedSnapshot = ledger.loadLedgerSnapshotData();
    expect(selectActiveAccounts(archivedSnapshot.accounts)).toEqual([savings]);
    expect(archivedSnapshot.accounts).toHaveLength(2);
    expect(archivedSnapshot.accounts).toEqual(
      expect.arrayContaining([{ ...account, archivedAtIso }, savings])
    );
    expect(archivedSnapshot.transactions).toEqual(beforeArchive.transactions);
    expect(archivedSnapshot.importJobs).toEqual(beforeArchive.importJobs);
    expect(archivedSnapshot.accountStatementCoveragePeriods)
      .toEqual(beforeArchive.accountStatementCoveragePeriods);
    expect(archivedSnapshot.accountBalanceCheckpoints)
      .toEqual(beforeArchive.accountBalanceCheckpoints);
    expect(networkFetch).not.toHaveBeenCalled();

    const manualEntryInput: ManualEntryInput = {
      householdId: household.id,
      accountId: account.id,
      bookedAtIso: "2026-11-12",
      amountMinor: -2500,
      merchantRaw: "Synthetic archived-account entry",
      categoryId: "groceries",
    };
    expect(submitManualEntry(manualEntryInput, archivedSnapshot.transactions, ledger))
      .toMatchObject({
        ok: false,
        reason: "validation",
        code: "INVALID_ACCOUNT_ID",
      });

    expect(createSpendableCashService(ledger, {
      now: () => new Date("2026-11-12T10:00:00.000Z"),
    }).getEstimate({
      selectedAccountIds: [account.id],
      nextIncomeDateIso: "2026-11-20",
      reserveMinor: 0,
    })).toMatchObject({
      state: "incomplete",
      incompleteReasons: [{
        code: "unknown-account",
        message: "A selected account is no longer available.",
      }],
    });

    const ledgerCloserIndex = closeLedgers.indexOf(ledger.close);
    if (ledgerCloserIndex < 0) throw new Error("Ledger cleanup registration is missing.");
    const closeLedger = closeLedgers.splice(ledgerCloserIndex, 1)[0];
    if (closeLedger === undefined) throw new Error("Ledger cleanup registration is missing.");
    closeLedger();

    const reopenedLedger = createLocalLedgerDatabase({ dbPath });
    closeLedgers.push(reopenedLedger.close);
    expect(reopenedLedger.loadLedgerSnapshotData().accounts).toEqual(archivedSnapshot.accounts);
    expect(reopenedLedger.loadLedgerSnapshotData().transactions).toEqual(beforeArchive.transactions);
    expect(reopenedLedger.loadLedgerSnapshotData().accountStatementCoveragePeriods)
      .toEqual(beforeArchive.accountStatementCoveragePeriods);
    expect(reopenedLedger.loadLedgerSnapshotData().accountBalanceCheckpoints)
      .toEqual(beforeArchive.accountBalanceCheckpoints);
    expect(reopenedLedger.getTransactionsForAccount(account.id))
      .toEqual(beforeArchive.transactions);

    let exportedCsv = "";
    const exportResult = exportLedgerCsvToFile({
      ledger: reopenedLedger,
      outputPath: "synthetic-archive-export.csv",
      writeFile: (_path, content) => {
        exportedCsv = content;
      },
    });
    expect(exportResult.rowCount).toBe(1);
    expect(exportedCsv).toContain("Synthetic grocery");
    expect(exportedCsv).toContain(account.id);

    const snapshotDirectory = mkdtempSync(join(tmpdir(), "budget-account-archive-backup-"));
    temporaryDirectories.push(snapshotDirectory);
    const snapshotPath = join(snapshotDirectory, "snapshot.json");
    createBackupSnapshot({
      ...reopenedLedger.loadLedgerSnapshotData(),
      createdAtIso: "2026-11-12T10:01:00.000Z",
      outputPath: snapshotPath,
    });
    const restored = restoreBackupSnapshot({ snapshotPath });
    expect(restored.accounts).toEqual(archivedSnapshot.accounts);
    expect(restored.transactions).toEqual(beforeArchive.transactions);
    expect(restored.accountStatementCoveragePeriods)
      .toEqual(beforeArchive.accountStatementCoveragePeriods);
    expect(restored.accountBalanceCheckpoints)
      .toEqual(beforeArchive.accountBalanceCheckpoints);

    const restoredLedger = createLocalLedgerDatabase({
      dbPath: join(snapshotDirectory, "restored.sqlite"),
    });
    closeLedgers.push(restoredLedger.close);
    restoredLedger.replaceLedgerSnapshotData(restored);
    expect(restoredLedger.loadLedgerSnapshotData().accounts).toEqual(archivedSnapshot.accounts);
    expect(restoredLedger.loadLedgerSnapshotData().transactions).toEqual(beforeArchive.transactions);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("leaves the ledger unchanged when archiving its only active account", () => {
    const { ledger, account } = createAccountWithHistory();
    const lifecycle = createAccountLifecycleService(ledger);
    const before = ledger.loadLedgerSnapshotData();

    expect(() => lifecycle.archiveAccount(account.id, "2026-11-12T10:00:00.000Z"))
      .toThrow("Keep at least one active account. Add another account before archiving this one.");
    expect(ledger.loadLedgerSnapshotData()).toEqual(before);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("rejects statement coverage and checkpoint changes after account archival", () => {
    const { ledger, household, account } = createAccountWithHistory();
    ledger.createAccount({
      householdId: household.id,
      accountName: "Savings",
      currencyCode: "NOK",
    });
    const lifecycle = createAccountLifecycleService(ledger);
    const beforeArchive = ledger.loadLedgerSnapshotData();
    const existingPeriod = beforeArchive.accountStatementCoveragePeriods?.find(
      (period) => period.accountId === account.id
    );
    if (existingPeriod === undefined) throw new Error("Synthetic statement period is missing.");

    lifecycle.archiveAccount(account.id, "2026-11-12T10:00:00.000Z");

    expect(() => ledger.saveAccountStatementCoveragePeriod({
      id: "period-after-archive",
      accountId: account.id,
      startDateIso: "2026-06-01",
      endDateIso: "2026-06-30",
      currencyCode: "NOK",
      sourceName: "synthetic-june-statement",
      sourceType: "manual",
      confirmed: false,
    })).toThrow("Archived accounts are read-only. Restore this account to add or change records.");
    expect(() => ledger.saveAccountStatementCoveragePeriod({
      ...existingPeriod,
      sourceName: "synthetic-edited-statement",
    })).toThrow("Archived accounts are read-only. Restore this account to add or change records.");
    expect(() => ledger.appendAccountBalanceCheckpoint({
      id: "checkpoint-after-archive",
      accountId: account.id,
      dateIso: "2026-06-30",
      currencyCode: "NOK",
      balanceMinor: 92_500,
      source: "synthetic June statement",
      recordedAtIso: "2026-07-01T00:00:00.000Z",
    })).toThrow("Archived accounts are read-only. Restore this account to add or change records.");

    const afterAttempts = ledger.loadLedgerSnapshotData();
    expect(afterAttempts.accountStatementCoveragePeriods)
      .toEqual(beforeArchive.accountStatementCoveragePeriods);
    expect(afterAttempts.accountBalanceCheckpoints)
      .toEqual(beforeArchive.accountBalanceCheckpoints);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("restores an archived account without losing its history", () => {
    const { ledger, household, account } = createAccountWithHistory();
    ledger.createAccount({
      householdId: household.id,
      accountName: "Savings",
      currencyCode: "NOK",
    });
    const lifecycle = createAccountLifecycleService(ledger);
    const historyBefore = ledger.loadLedgerSnapshotData();
    lifecycle.archiveAccount(account.id, "2026-11-12T10:00:00.000Z");

    expect(lifecycle.restoreAccount(account.id)).toEqual(account);
    const afterRestore = ledger.loadLedgerSnapshotData();
    expect(afterRestore.accountStatementCoveragePeriods)
      .toEqual(historyBefore.accountStatementCoveragePeriods);
    expect(afterRestore.accountBalanceCheckpoints)
      .toEqual(historyBefore.accountBalanceCheckpoints);
    expect(ledger.loadRuntimeMetadata()?.accounts).toContainEqual(account);
    expect(networkFetch).not.toHaveBeenCalled();
  });
});
