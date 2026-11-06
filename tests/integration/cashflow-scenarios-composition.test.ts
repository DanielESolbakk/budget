import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNokMonthlyReport } from "../../src/app/dashboardApi.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { createCashflowScenarioService } from "../../src/app/cashflowScenarioService.js";
import { createLoanRegistry } from "../../src/app/loanRegistry.js";
import { createRecurringCommitmentService } from "../../src/app/recurringCommitmentService.js";
import type {
  AccountBalanceCheckpoint,
  AccountStatementCoveragePeriod,
  Household,
  Transaction,
} from "../../src/domain/types.js";

const household: Household = {
  id: "household-cashflow-scenarios",
  name: "Synthetic household",
  createdAtIso: "2026-01-01T00:00:00.000Z",
};

const account = {
  id: "account-nok",
  householdId: household.id,
  name: "Synthetic current account",
  currencyCode: "NOK",
};

const transactions: Transaction[] = [
  {
    id: "income-january",
    householdId: household.id,
    accountId: account.id,
    bookedAtIso: "2026-01-15T12:00:00.000Z",
    amountMinor: 50_000,
    merchantRaw: "Synthetic January income",
    currencyCode: "NOK",
    sourceType: "manual",
  },
  {
    id: "income-february",
    householdId: household.id,
    accountId: account.id,
    bookedAtIso: "2026-02-15T12:00:00.000Z",
    amountMinor: 40_000,
    merchantRaw: "Synthetic February income",
    currencyCode: "NOK",
    sourceType: "manual",
  },
  {
    id: "income-march",
    householdId: household.id,
    accountId: account.id,
    bookedAtIso: "2026-03-10T12:00:00.000Z",
    amountMinor: 30_000,
    merchantRaw: "Synthetic March income",
    currencyCode: "NOK",
    sourceType: "manual",
  },
];

const period: AccountStatementCoveragePeriod = {
  id: "coverage-february",
  accountId: account.id,
  startDateIso: "2026-02-01",
  endDateIso: "2026-02-28",
  currencyCode: "NOK",
  sourceName: "Synthetic February statement",
  sourceType: "manual",
  confirmed: true,
  confirmedAtIso: "2026-03-01T08:00:00.000Z",
};

const openingBalance: AccountBalanceCheckpoint = {
  id: "balance-opening",
  accountId: account.id,
  dateIso: "2026-02-01",
  currencyCode: "NOK",
  balanceMinor: 160_000,
  source: "Synthetic statement",
  recordedAtIso: "2026-03-01T08:00:00.000Z",
};

const closingBalance: AccountBalanceCheckpoint = {
  id: "balance-closing",
  accountId: account.id,
  dateIso: "2026-02-28",
  currencyCode: "NOK",
  balanceMinor: 200_000,
  source: "Synthetic statement",
  recordedAtIso: "2026-03-01T08:00:00.000Z",
};

const networkFetch = vi.fn(() => {
  throw new Error("Network access is not allowed in cashflow scenario tests.");
});

function openLedger(dbPath: string, ledgerTransactions: Transaction[] = transactions) {
  return createLocalLedgerDatabase({
    dbPath,
    seedData: {
      household,
      accounts: [account],
      transactions: ledgerTransactions,
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });
}

function verifyFebruaryBalance(
  ledger: ReturnType<typeof openLedger>,
  closingBalanceMinor = closingBalance.balanceMinor
): void {
  ledger.saveAccountStatementCoveragePeriod(period);
  ledger.appendAccountBalanceCheckpoint(openingBalance);
  ledger.appendAccountBalanceCheckpoint({ ...closingBalance, balanceMinor: closingBalanceMinor });
}

function addConfirmedRent(ledger: ReturnType<typeof openLedger>): void {
  const service = createRecurringCommitmentService(ledger, {
    createId: () => "commitment-rent",
    now: () => new Date("2026-03-15T08:00:00.000Z"),
  });
  const commitment = service.create({
    description: "Synthetic rent",
    currencyCode: "NOK",
    amountMinor: 20_000,
    isVariable: false,
    cadence: "monthly",
    firstDueDateIso: "2026-04-15",
    activeFromIso: "2026-03-15",
  });
  service.confirm(commitment.id);
}

function historicalMarchReport(ledger: ReturnType<typeof openLedger>) {
  return buildNokMonthlyReport({
    transactions: ledger.getTransactionsForMonth(household.id, "2026-03"),
    accounts: ledger.getAccountsForHousehold(household.id),
    rates: ledger.listExchangeRates(),
    yearMonth: "2026-03",
  });
}

beforeEach(() => {
  networkFetch.mockClear();
  vi.stubGlobal("fetch", networkFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cashflow scenario composition", () => {
  it("compares a dated expense with the same verified balance and confirmed commitments without writes", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-cashflow-scenario-"));
    const ledger = openLedger(join(directory, "ledger.sqlite"));

    try {
      verifyFebruaryBalance(ledger);
      addConfirmedRent(ledger);
      let loanId = 0;
      const loans = createLoanRegistry(ledger, {
        createId: () => `synthetic-loan-${++loanId}`,
        now: () => new Date("2026-03-15T08:00:00.000Z"),
      });
      const loan = loans.create({
        label: "Synthetic mortgage",
        principalMinor: 30_000_000,
        annualInterestRateBasisPoints: 500,
        termMonths: 300,
        paymentAmountMinor: 1_000_000,
        paymentFrequency: "monthly",
        currencyCode: "NOK",
      });
      loans.appendBalance({
        loanId: loan.id,
        effectiveDateIso: "2026-03-01",
        amountMinor: 29_900_000,
      });

      const beforeScenario = ledger.loadLedgerSnapshotData();
      const service = createCashflowScenarioService(ledger, {
        now: () => new Date("2026-03-15T12:00:00.000Z"),
      });
      const result = service.getScenario({
        assumptions: [{
          id: "one-time-cost",
          kind: "one-time-expense",
          amountMinor: 75_000,
          currencyCode: "NOK",
          occurrenceDateIso: "2026-05-15",
        }],
        useLatestRateScenario: false,
      });

      expect(result.state).toBe("complete");
      if (result.state !== "complete") return;
      expect(result.baseline.startingCashNokMinor).toBe(230_000);
      expect(result.baseline.monthlyCashflows).toEqual([
        { yearMonth: "2026-04", netCashflowNokMinor: 20_000, endingCashNokMinor: 250_000 },
        { yearMonth: "2026-05", netCashflowNokMinor: 20_000, endingCashNokMinor: 270_000 },
        { yearMonth: "2026-06", netCashflowNokMinor: 20_000, endingCashNokMinor: 290_000 },
      ]);
      expect(result.months[1]).toMatchObject({
        yearMonth: "2026-05",
        baselineCashflowNokMinor: 20_000,
        scenarioCashflowNokMinor: -55_000,
        differenceNokMinor: -75_000,
        baselineEndingCashNokMinor: 270_000,
        scenarioEndingCashNokMinor: 195_000,
      });
      expect(result.baseline.minimumProjectedCashNokMinor).toBe(210_000);
      expect(result.scenario.minimumProjectedCashNokMinor).toBe(155_000);
      expect(ledger.loadLedgerSnapshotData()).toEqual(beforeScenario);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("removes linked historical commitment payments before projecting future occurrences", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-cashflow-scenario-linked-payment-"));
    const historicalRentPayment: Transaction = {
      id: "rent-payment-february",
      householdId: household.id,
      accountId: account.id,
      bookedAtIso: "2026-02-15T12:00:00.000Z",
      amountMinor: -20_000,
      merchantRaw: "Synthetic rent",
      currencyCode: "NOK",
      sourceType: "manual",
    };
    const historicalUtilityPayment: Transaction = {
      id: "utility-payment-february",
      householdId: household.id,
      accountId: account.id,
      bookedAtIso: "2026-02-20T12:00:00.000Z",
      amountMinor: -5_000,
      merchantRaw: "Synthetic utilities",
      currencyCode: "NOK",
      sourceType: "manual",
    };
    const ledger = openLedger(join(directory, "ledger.sqlite"), [
      ...transactions,
      historicalRentPayment,
      historicalUtilityPayment,
    ]);

    try {
      verifyFebruaryBalance(ledger, 175_000);
      let id = 0;
      const commitments = createRecurringCommitmentService(ledger, {
        createId: () => `linked-rent-${++id}`,
        now: () => new Date("2026-03-16T08:00:00.000Z"),
      });
      const rent = commitments.create({
        description: "Synthetic rent",
        currencyCode: "NOK",
        amountMinor: 20_000,
        isVariable: false,
        cadence: "monthly",
        firstDueDateIso: "2026-02-15",
        activeFromIso: "2026-02-01",
      });
      commitments.confirm(rent.id);
      commitments.linkPayment({
        commitmentId: rent.id,
        transactionId: historicalRentPayment.id,
        occurrenceDateIso: "2026-02-15",
      });

      const beforeScenario = ledger.loadLedgerSnapshotData();
      const result = createCashflowScenarioService(ledger, {
        now: () => new Date("2026-03-16T12:00:00.000Z"),
      }).getScenario({
        assumptions: [],
        useLatestRateScenario: false,
      });

      expect(result.state).toBe("complete");
      if (result.state !== "complete") return;
      expect(result.baseline.startingCashNokMinor).toBe(205_000);
      expect(result.baseline.monthlyCashflows).toEqual([
        { yearMonth: "2026-04", netCashflowNokMinor: 18_333, endingCashNokMinor: 223_333 },
        { yearMonth: "2026-05", netCashflowNokMinor: 18_333, endingCashNokMinor: 241_666 },
        { yearMonth: "2026-06", netCashflowNokMinor: 18_333, endingCashNokMinor: 259_999 },
      ]);
      expect(ledger.loadLedgerSnapshotData()).toEqual(beforeScenario);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps linked historical payments in the baseline when no future commitment occurrence is projected", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-cashflow-scenario-expired-link-"));
    const historicalRentPayment: Transaction = {
      id: "rent-payment-february",
      householdId: household.id,
      accountId: account.id,
      bookedAtIso: "2026-02-15T12:00:00.000Z",
      amountMinor: -20_000,
      merchantRaw: "Synthetic rent",
      currencyCode: "NOK",
      sourceType: "manual",
    };
    const ledger = openLedger(join(directory, "ledger.sqlite"), [
      ...transactions,
      historicalRentPayment,
    ]);

    try {
      verifyFebruaryBalance(ledger, 180_000);
      let id = 0;
      const commitments = createRecurringCommitmentService(ledger, {
        createId: () => `expired-rent-${++id}`,
        now: () => new Date("2026-03-16T08:00:00.000Z"),
      });
      const rent = commitments.create({
        description: "Synthetic rent",
        currencyCode: "NOK",
        amountMinor: 20_000,
        isVariable: false,
        cadence: "monthly",
        firstDueDateIso: "2026-02-15",
        activeFromIso: "2026-02-01",
        activeUntilIso: "2026-03-01",
      });
      commitments.confirm(rent.id);
      commitments.linkPayment({
        commitmentId: rent.id,
        transactionId: historicalRentPayment.id,
        occurrenceDateIso: "2026-02-15",
      });

      const result = createCashflowScenarioService(ledger, {
        now: () => new Date("2026-03-16T12:00:00.000Z"),
      }).getScenario({
        assumptions: [],
        useLatestRateScenario: false,
      });

      expect(result.state).toBe("complete");
      if (result.state !== "complete") return;
      expect(result.baseline.monthlyCashflows).toEqual([
        { yearMonth: "2026-04", netCashflowNokMinor: 33_333, endingCashNokMinor: 243_333 },
        { yearMonth: "2026-05", netCashflowNokMinor: 33_333, endingCashNokMinor: 276_666 },
        { yearMonth: "2026-06", netCashflowNokMinor: 33_333, endingCashNokMinor: 309_999 },
      ]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses a selected latest rate only for scenario inputs and leaves historical reports unchanged", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-cashflow-scenario-fx-"));
    const ledger = openLedger(join(directory, "ledger.sqlite"));

    try {
      verifyFebruaryBalance(ledger);
      addConfirmedRent(ledger);
      ledger.upsertExchangeRate({
        id: "eur-latest",
        currencyCode: "EUR",
        rateNokPerUnit: "11.5",
        effectiveDate: "2026-07-01",
        kind: "dated",
        source: "Synthetic scenario rate",
        provenance: "manual",
      });
      const historicalReportBefore = historicalMarchReport(ledger);
      const beforeScenario = ledger.loadLedgerSnapshotData();
      const ratesBefore = ledger.listExchangeRates();

      const result = createCashflowScenarioService(ledger, {
        now: () => new Date("2026-03-15T12:00:00.000Z"),
      }).getScenario({
        assumptions: [{
          id: "foreign-expense",
          kind: "one-time-expense",
          amountMinor: 10_000,
          currencyCode: "EUR",
          occurrenceDateIso: "2026-05-15",
        }],
        useLatestRateScenario: true,
      });

      expect(result.state).toBe("complete");
      if (result.state !== "complete") return;
      expect(result.appliedAssumptions).toEqual([expect.objectContaining({
        id: "foreign-expense",
        amountNokMinor: -115_000,
        isScenarioRestatement: true,
        exchangeRate: expect.objectContaining({ id: "eur-latest" }),
      })]);
      expect(result.months[1]).toMatchObject({
        baselineCashflowNokMinor: 20_000,
        scenarioCashflowNokMinor: -95_000,
        differenceNokMinor: -115_000,
      });
      expect(ledger.loadLedgerSnapshotData()).toEqual(beforeScenario);
      expect(ledger.listExchangeRates()).toEqual(ratesBefore);
      expect(historicalMarchReport(ledger)).toEqual(historicalReportBefore);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns an incomplete scenario when an account has no verified balance", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-cashflow-scenario-balance-"));
    const ledger = openLedger(join(directory, "ledger.sqlite"));

    try {
      const result = createCashflowScenarioService(ledger, {
        now: () => new Date("2026-03-15T12:00:00.000Z"),
      }).getScenario({
        assumptions: [],
        useLatestRateScenario: false,
      });

      expect(result).toMatchObject({
        state: "incomplete",
        baseline: null,
        scenario: null,
        incompleteReasons: [expect.objectContaining({
          code: "missing-balance",
        })],
      });
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns an incomplete scenario for a confirmed variable commitment with no known amount", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-cashflow-scenario-variable-"));
    const ledger = openLedger(join(directory, "ledger.sqlite"));

    try {
      verifyFebruaryBalance(ledger);
      const service = createRecurringCommitmentService(ledger, {
        createId: () => "commitment-variable",
        now: () => new Date("2026-03-15T08:00:00.000Z"),
      });
      const commitment = service.create({
        description: "Synthetic variable bill",
        currencyCode: "NOK",
        amountMinor: null,
        isVariable: true,
        cadence: "monthly",
        firstDueDateIso: "2026-04-15",
        activeFromIso: "2026-03-15",
      });
      service.confirm(commitment.id);

      const result = createCashflowScenarioService(ledger, {
        now: () => new Date("2026-03-15T12:00:00.000Z"),
      }).getScenario({
        assumptions: [],
        useLatestRateScenario: false,
      });

      expect(result).toMatchObject({
        state: "incomplete",
        baseline: null,
        scenario: null,
        incompleteReasons: [expect.objectContaining({
          code: "unknown-variable-commitment",
          dateIso: "2026-04-15",
        })],
      });
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns an incomplete scenario when a confirmed commitment has no eligible local rate", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-cashflow-scenario-missing-rate-"));
    const ledger = openLedger(join(directory, "ledger.sqlite"));

    try {
      verifyFebruaryBalance(ledger);
      const commitments = createRecurringCommitmentService(ledger, {
        createId: () => "commitment-eur",
        now: () => new Date("2026-03-15T08:00:00.000Z"),
      });
      const commitment = commitments.create({
        description: "Synthetic euro rent",
        currencyCode: "EUR",
        amountMinor: 10_000,
        isVariable: false,
        cadence: "monthly",
        firstDueDateIso: "2026-04-15",
        activeFromIso: "2026-03-15",
      });
      commitments.confirm(commitment.id);

      const result = createCashflowScenarioService(ledger, {
        now: () => new Date("2026-03-15T12:00:00.000Z"),
      }).getScenario({
        assumptions: [],
        useLatestRateScenario: false,
      });

      expect(result).toMatchObject({
        state: "incomplete",
        baseline: null,
        scenario: null,
        incompleteReasons: [expect.objectContaining({
          code: "missing-exchange-rate",
          currencyCode: "EUR",
          dateIso: "2026-04-15",
        })],
      });
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
