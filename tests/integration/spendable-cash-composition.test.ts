import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpendableCashService } from "../../src/app/spendableCashService.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { createHoldingRegistry } from "../../src/app/holdingRegistry.js";
import { createLoanRegistry } from "../../src/app/loanRegistry.js";
import { createPropertyRegistry } from "../../src/app/propertyRegistry.js";
import { createRecurringCommitmentService } from "../../src/app/recurringCommitmentService.js";
import type {
  AccountBalanceCheckpoint,
  AccountStatementCoveragePeriod,
  Household,
  ImportJob,
  PendingTransactionObservation,
  RecurringCommitment,
  RecurringCommitmentPaymentLink,
  Transaction,
} from "../../src/domain/types.js";

const household: Household = {
  id: "household-spendable",
  name: "Synthetic household",
  createdAtIso: "2026-05-01T00:00:00.000Z",
};

const account = {
  id: "account-nok",
  householdId: household.id,
  name: "Synthetic current account",
  currencyCode: "NOK",
};

const period: AccountStatementCoveragePeriod = {
  id: "coverage-may",
  accountId: account.id,
  startDateIso: "2026-05-01",
  endDateIso: "2026-05-31",
  currencyCode: "NOK",
  sourceName: "synthetic-may.csv",
  sourceType: "manual",
  confirmed: true,
  confirmedAtIso: "2026-06-01T08:00:00.000Z",
};

const openingBalance: AccountBalanceCheckpoint = {
  id: "balance-opening",
  accountId: account.id,
  dateIso: "2026-05-01",
  currencyCode: "NOK",
  balanceMinor: 500_000,
  source: "Synthetic statement",
  recordedAtIso: "2026-06-01T08:00:00.000Z",
};

const closingBalance: AccountBalanceCheckpoint = {
  id: "balance-closing",
  accountId: account.id,
  dateIso: "2026-05-31",
  currencyCode: "NOK",
  balanceMinor: 500_000,
  source: "Synthetic statement",
  recordedAtIso: "2026-06-01T08:00:00.000Z",
};

const pendingElectricity: PendingTransactionObservation = {
  id: "pending-electricity",
  householdId: household.id,
  accountId: account.id,
  transactionDateIso: "2026-06-10",
  amountMinor: -40_000,
  merchantRaw: "Synthetic electricity",
  sourceRowIndex: 1,
  currencyCode: "NOK",
  sourceType: "csv",
  status: "confirmed",
  sourceStatus: "Bekreftet",
};

const networkFetch = vi.fn(() => {
  throw new Error("Network access is not allowed in spendable cash integration tests.");
});

beforeEach(() => {
  networkFetch.mockClear();
  vi.stubGlobal("fetch", networkFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("spendable cash composition", () => {
  it("composes verified cash, pending debits, and confirmed commitments without mutating the ledger", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-spendable-cash-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household,
        accounts: [account],
        transactions: [],
        pendingObservations: [pendingElectricity],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      ledger.saveAccountStatementCoveragePeriod(period);
      ledger.appendAccountBalanceCheckpoint(openingBalance);
      ledger.appendAccountBalanceCheckpoint(closingBalance);

      const commitmentService = createRecurringCommitmentService(ledger, {
        createId: () => "commitment-rent",
        now: () => new Date("2026-06-01T08:00:00.000Z"),
      });
      const suggested = commitmentService.create({
        description: "Synthetic rent",
        currencyCode: "NOK",
        amountMinor: 60_000,
        isVariable: false,
        cadence: "monthly",
        firstDueDateIso: "2026-06-15",
        activeFromIso: "2026-06-01",
      });
      commitmentService.confirm(suggested.id);

      const beforeEstimate = ledger.loadLedgerSnapshotData();
      const spendableCashService = createSpendableCashService(ledger, {
        now: () => new Date("2026-06-01T12:00:00.000Z"),
      });
      const result = spendableCashService.getEstimate({
        selectedAccountIds: [account.id],
        nextIncomeDateIso: "2026-06-20",
        reserveMinor: 50_000,
      });

      expect(result).toMatchObject({
        state: "complete",
        lowestProjectedCashNokMinor: 400_000,
        spendableCashNokMinor: 350_000,
        selectedAccounts: [{
          accountId: account.id,
          balanceDateIso: closingBalance.dateIso,
          balanceMinor: 500_000,
        }],
      });
      expect(ledger.loadLedgerSnapshotData()).toEqual(beforeEstimate);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns an incomplete estimate when the latest confirmed period has only a stale checkpoint", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-spendable-cash-stale-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household,
        accounts: [account],
        transactions: [],
        pendingObservations: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      ledger.saveAccountStatementCoveragePeriod({
        ...period,
        id: "coverage-june",
        startDateIso: "2026-06-01",
        endDateIso: "2026-06-30",
      });
      ledger.appendAccountBalanceCheckpoint({
        ...closingBalance,
        id: "balance-old",
      });

      const spendableCashService = createSpendableCashService(ledger, {
        now: () => new Date("2026-07-01T12:00:00.000Z"),
      });
      const result = spendableCashService.getEstimate({
        selectedAccountIds: [account.id],
        nextIncomeDateIso: "2026-07-20",
        reserveMinor: 50_000,
      });

      expect(result).toMatchObject({
        state: "incomplete",
        spendableCashNokMinor: null,
        incompleteReasons: [expect.objectContaining({
          code: "stale-balance",
          accountId: account.id,
        })],
      });
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("counts a matched pending-to-booked commitment payment once", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-spendable-cash-matched-"));
    const pending: PendingTransactionObservation = {
      ...pendingElectricity,
      sourceReference: "electricity-next-payment",
      transactionDateIso: "2026-06-10",
    };
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household,
        accounts: [account],
        transactions: [],
        pendingObservations: [pending],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      ledger.saveAccountStatementCoveragePeriod(period);
      ledger.appendAccountBalanceCheckpoint(openingBalance);
      ledger.appendAccountBalanceCheckpoint(closingBalance);

      const commitment: RecurringCommitment = {
        id: "commitment-electricity",
        householdId: household.id,
        description: "Synthetic electricity",
        currencyCode: "NOK",
        amountMinor: 40_000,
        isVariable: false,
        cadence: "monthly",
        firstDueDateIso: "2026-06-10",
        activeFromIso: "2026-06-01",
        status: "active",
        createdAtIso: "2026-06-01T08:00:00.000Z",
        updatedAtIso: "2026-06-01T08:00:00.000Z",
      };
      const paymentLink: RecurringCommitmentPaymentLink = {
        id: "link-electricity",
        commitmentId: commitment.id,
        occurrenceDateIso: "2026-06-10",
        pendingObservationId: pending.id,
        linkedAtIso: "2026-06-01T08:00:00.000Z",
      };
      const initialSnapshot = ledger.loadLedgerSnapshotData();
      ledger.replaceLedgerSnapshotData({
        ...initialSnapshot,
        recurringCommitments: [commitment],
        recurringCommitmentPaymentLinks: [paymentLink],
      });

      const importJob: ImportJob = {
        id: "job-booked-electricity",
        householdId: household.id,
        sourceType: "csv",
        sourceName: "synthetic-booked.csv",
        startedAtIso: "2026-06-10T12:00:00.000Z",
      };
      const transaction: Transaction = {
        id: "transaction-electricity",
        householdId: household.id,
        accountId: account.id,
        bookedAtIso: "2026-06-10T12:00:00.000Z",
        amountMinor: -40_000,
        merchantRaw: "Synthetic electricity",
        currencyCode: "NOK",
        sourceType: "csv",
        sourceReference: "electricity-next-payment",
        importJobId: importJob.id,
      };
      ledger.appendImportJobAndTransactions(importJob, [transaction]);

      const beforeEstimate = ledger.loadLedgerSnapshotData();
      const spendableCashService = createSpendableCashService(ledger, {
        now: () => new Date("2026-06-01T12:00:00.000Z"),
      });
      const result = spendableCashService.getEstimate({
        selectedAccountIds: [account.id],
        nextIncomeDateIso: "2026-06-20",
        reserveMinor: 0,
      });

      expect(result).toMatchObject({
        state: "complete",
        lowestProjectedCashNokMinor: 460_000,
        spendableCashNokMinor: 460_000,
        lineItems: [{
          id: transaction.id,
          kind: "booked-transaction",
          amountMinor: -40_000,
          amountNokMinor: -40_000,
        }],
      });
      expect(result.lineItems).toHaveLength(1);
      expect(ledger.loadLedgerSnapshotData()).toEqual(beforeEstimate);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not treat property, holding, or loan values as spendable cash", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-spendable-cash-assets-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household,
        accounts: [account],
        transactions: [],
        pendingObservations: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      let id = 0;
      const registryOptions = {
        createId: () => `asset-record-${++id}`,
        now: () => new Date("2026-06-01T08:00:00.000Z"),
      };
      const properties = createPropertyRegistry(ledger, registryOptions);
      const home = properties.create({ label: "Synthetic home" });
      properties.appendValuation({
        propertyId: home.id,
        effectiveDateIso: "2026-06-01",
        amountMinor: 45_000_000,
        currencyCode: "NOK",
      });

      const holdings = createHoldingRegistry(ledger, registryOptions);
      const fund = holdings.create({
        label: "Synthetic fund",
        quantity: 10,
        costBasisMinor: 5_000_000,
        currencyCode: "NOK",
      });
      holdings.appendValuation({
        holdingId: fund.id,
        effectiveDateIso: "2026-06-01",
        amountMinor: 50_000_000,
        currencyCode: "NOK",
      });

      const loans = createLoanRegistry(ledger, registryOptions);
      const mortgage = loans.create({
        label: "Synthetic mortgage",
        principalMinor: 30_000_000,
        annualInterestRateBasisPoints: 500,
        termMonths: 300,
        paymentAmountMinor: 1_000_000,
        paymentFrequency: "monthly",
        currencyCode: "NOK",
      });
      loans.appendBalance({
        loanId: mortgage.id,
        effectiveDateIso: "2026-06-01",
        amountMinor: 28_000_000,
      });

      ledger.saveAccountStatementCoveragePeriod(period);
      ledger.appendAccountBalanceCheckpoint(openingBalance);
      ledger.appendAccountBalanceCheckpoint(closingBalance);

      expect(properties.list()).toHaveLength(1);
      expect(holdings.list()).toHaveLength(1);
      expect(loans.list()).toHaveLength(1);

      const result = createSpendableCashService(ledger, {
        now: () => new Date("2026-06-01T12:00:00.000Z"),
      }).getEstimate({
        selectedAccountIds: [account.id],
        nextIncomeDateIso: "2026-06-20",
        reserveMinor: 0,
      });

      expect(result).toMatchObject({
        state: "complete",
        lowestProjectedCashNokMinor: 500_000,
        spendableCashNokMinor: 500_000,
        selectedAccounts: [{ accountId: account.id }],
        lineItems: [],
      });
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
