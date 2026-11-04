import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { parseExchangeRateCsv } from "../../src/app/exchangeRateImport.js";
import * as dashboardApi from "../../src/app/dashboardApi.js";
import { queryNokValuationReport } from "../../src/app/dashboardApi.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import type { Account, ExchangeRate, Transaction } from "../../src/domain/types.js";

const networkFetch = vi.fn(() => {
  throw new Error("Network access is not allowed in exchange-rate integration tests.");
});

beforeEach(() => {
  networkFetch.mockClear();
  vi.stubGlobal("fetch", networkFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const accounts: Account[] = [
  { id: "acc-eur", householdId: "hh-rates", name: "Euro account", currencyCode: "EUR" },
  { id: "acc-sek", householdId: "hh-rates", name: "Krona account", currencyCode: "SEK" },
];

const transactions: Transaction[] = [
  {
    id: "tx-eur-income",
    householdId: "hh-rates",
    accountId: "acc-eur",
    bookedAtIso: "2026-05-10T00:00:00Z",
    amountMinor: 10_000,
    merchantRaw: "Synthetic EUR income",
    currencyCode: "EUR",
  },
  {
    id: "tx-sek-expense",
    householdId: "hh-rates",
    accountId: "acc-sek",
    bookedAtIso: "2026-05-12T00:00:00Z",
    amountMinor: -5_000,
    merchantRaw: "Synthetic SEK expense",
    currencyCode: "SEK",
  },
];

interface ExchangeRateLedger {
  upsertExchangeRate: (rate: ExchangeRate) => void;
  upsertExchangeRates: (rates: ExchangeRate[]) => void;
  listExchangeRates: (currencyCode?: string) => ExchangeRate[];
}

interface NokMonthlyReport {
  yearMonth: string;
  nativeSubtotals: Array<{ currencyCode: string; totalMinor: number }>;
  nokSubtotalMinor: number | null;
  partialNokSubtotalMinor: number;
  incompleteCurrencies: string[];
  transactions: Array<{
    transactionId: string;
    nativeAmountMinor: number;
    nativeCurrencyCode: string;
    nokAmountMinor: number | null;
    exchangeRate: ExchangeRate | null;
    isEstimate: boolean;
    isScenarioRestatement: boolean;
  }>;
}

interface NokMonthlyReportBuilder {
  buildNokMonthlyReport: (input: {
    transactions: Transaction[];
    accounts: Account[];
    rates: ExchangeRate[];
    yearMonth: string;
    monthlyReferenceRateIds?: Record<string, string>;
    useLatestRateScenario?: boolean;
  }) => NokMonthlyReport;
}

function exchangeRateLedger(
  ledger: ReturnType<typeof createLocalLedgerDatabase>
): ReturnType<typeof createLocalLedgerDatabase> & ExchangeRateLedger {
  const result = ledger as ReturnType<typeof createLocalLedgerDatabase> & ExchangeRateLedger;
  expect(typeof result.upsertExchangeRate).toBe("function");
  expect(typeof result.upsertExchangeRates).toBe("function");
  expect(typeof result.listExchangeRates).toBe("function");
  return result;
}

function getNokMonthlyReportBuilder(): NokMonthlyReportBuilder {
  const result = dashboardApi as typeof dashboardApi & Partial<NokMonthlyReportBuilder>;
  expect(typeof result.buildNokMonthlyReport).toBe("function");
  if (result.buildNokMonthlyReport === undefined) {
    throw new Error("The converted monthly report builder is unavailable.");
  }
  return result as NokMonthlyReportBuilder;
}

function createLedger(dbPath: string) {
  return createLocalLedgerDatabase({
    dbPath,
    seedData: {
      household: {
        id: "hh-rates",
        name: "Synthetic household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts,
      transactions,
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });
}

describe("exchange-rate local persistence and reports", () => {
  it("imports local CSV rates, preserves provenance after reopen, and restores rate history from backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-exchange-rates-"));
    const databasePath = join(directory, "ledger.sqlite");
    const backupPath = join(directory, "rates-backup.json");
    const ledger = createLedger(databasePath);
    let isClosed = false;

    try {
      const importedRates = parseExchangeRateCsv(
        "currencyCode,rateNokPerUnit,effectiveDate,kind\nEUR,11.50,2026-05-01,dated\n",
        "synthetic-rates.csv"
      );
      exchangeRateLedger(ledger).upsertExchangeRates(importedRates);
      expect(importedRates[0]?.provenance).toBe("local-file");
      const manualRate: ExchangeRate = {
        id: "manual-sek-may",
        currencyCode: "SEK",
        rateNokPerUnit: "1.05",
        effectiveDate: "2026-05-01",
        kind: "dated",
        source: "Synthetic manual SEK rate",
        provenance: "manual",
      };
      exchangeRateLedger(ledger).upsertExchangeRate(manualRate);

      ledger.close();
      isClosed = true;
      const reopened = createLedger(databasePath);
      try {
        const reopenedRates = exchangeRateLedger(reopened).listExchangeRates();
        expect(reopenedRates).toEqual([...importedRates, manualRate]);

        createBackupSnapshot({
          ...reopened.loadLedgerSnapshotData(),
          createdAtIso: "2026-06-01T00:00:00Z",
          outputPath: backupPath,
        });
        const restored = restoreBackupSnapshot({ snapshotPath: backupPath });
        expect(restored.exchangeRates).toEqual(reopenedRates);
        expect(restored.transactions).toEqual(transactions);

        const restoredLedger = createLedger(join(directory, "restored.sqlite"));
        try {
          restoredLedger.replaceLedgerSnapshotData(restored);
          const restoredRates = exchangeRateLedger(restoredLedger).listExchangeRates();
          expect(restoredRates).toEqual(reopenedRates);

          const restoredSnapshot = restoredLedger.loadLedgerSnapshotData();
          const restoredReport = getNokMonthlyReportBuilder().buildNokMonthlyReport({
            transactions: restoredSnapshot.transactions,
            accounts: restoredSnapshot.accounts,
            rates: restoredRates,
            yearMonth: "2026-05",
          });
          expect(restoredReport.nativeSubtotals).toEqual([
            { currencyCode: "EUR", totalMinor: 10_000 },
            { currencyCode: "SEK", totalMinor: -5_000 },
          ]);
          expect(restoredReport.nokSubtotalMinor).toBe(109_750);
          expect(restoredReport.transactions).toMatchObject([
            {
              transactionId: "tx-eur-income",
              nativeAmountMinor: 10_000,
              nativeCurrencyCode: "EUR",
              nokAmountMinor: 115_000,
              exchangeRate: {
                currencyCode: "EUR",
                rateNokPerUnit: "11.50",
                effectiveDate: "2026-05-01",
                kind: "dated",
                source: "synthetic-rates.csv",
                provenance: "local-file",
              },
              isEstimate: false,
              isScenarioRestatement: false,
            },
            {
              transactionId: "tx-sek-expense",
              nativeAmountMinor: -5_000,
              nativeCurrencyCode: "SEK",
              nokAmountMinor: -5_250,
              exchangeRate: manualRate,
              isEstimate: false,
              isScenarioRestatement: false,
            },
          ]);
        } finally {
          restoredLedger.close();
        }
      } finally {
        reopened.close();
      }
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      if (!isClosed) ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("queries persisted property, holding, and loan valuations using each valuation date", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-valuation-report-"));
    const databasePath = join(directory, "ledger.sqlite");
    const ledger = createLedger(databasePath);
    let activeLedger: ReturnType<typeof createLedger> | undefined = ledger;

    try {
      ledger.createPropertyRecord({
        id: "property-home",
        householdId: "hh-rates",
        label: "Synthetic home",
        createdAtIso: "2026-01-01T00:00:00Z",
      });
      ledger.appendPropertyValuationSnapshot({
        id: "property-home-april",
        propertyId: "property-home",
        effectiveDateIso: "2026-04-15",
        amountMinor: 100_000,
        currencyCode: "EUR",
        recordedAtIso: "2026-04-15T12:00:00Z",
      });
      ledger.createPropertyRecord({
        id: "property-zmissing",
        householdId: "hh-rates",
        label: "Synthetic missing-rate property",
        createdAtIso: "2026-01-01T00:00:00Z",
      });
      ledger.appendPropertyValuationSnapshot({
        id: "property-zmissing-may",
        propertyId: "property-zmissing",
        effectiveDateIso: "2026-05-10",
        amountMinor: 20_000,
        currencyCode: "GBP",
        recordedAtIso: "2026-05-10T12:00:00Z",
      });
      ledger.createHoldingRecord({
        id: "holding-fund",
        householdId: "hh-rates",
        label: "Synthetic fund",
        quantity: 1,
        costBasisMinor: 40_000,
        currencyCode: "USD",
        createdAtIso: "2026-01-01T00:00:00Z",
      });
      ledger.appendHoldingValuationSnapshot({
        id: "holding-fund-may",
        holdingId: "holding-fund",
        effectiveDateIso: "2026-05-20",
        amountMinor: 50_000,
        currencyCode: "USD",
        recordedAtIso: "2026-05-20T12:00:00Z",
      });
      ledger.createLoanRecord({
        id: "loan-mortgage",
        householdId: "hh-rates",
        label: "Synthetic mortgage",
        principalMinor: 100_000,
        annualInterestRateBasisPoints: 400,
        termMonths: 240,
        paymentAmountMinor: 5_000,
        paymentFrequency: "monthly",
        currencyCode: "SEK",
        createdAtIso: "2026-01-01T00:00:00Z",
      });
      ledger.appendLoanBalanceSnapshot({
        id: "loan-mortgage-may",
        loanId: "loan-mortgage",
        effectiveDateIso: "2026-05-31",
        amountMinor: 30_000,
        currencyCode: "SEK",
        recordedAtIso: "2026-05-31T12:00:00Z",
      });
      exchangeRateLedger(ledger).upsertExchangeRates([
        {
          id: "eur-april",
          currencyCode: "EUR",
          rateNokPerUnit: "11.25",
          effectiveDate: "2026-04-01",
          kind: "dated",
          source: "Synthetic April rate",
          provenance: "manual",
        },
        {
          id: "eur-may",
          currencyCode: "EUR",
          rateNokPerUnit: "12.50",
          effectiveDate: "2026-05-01",
          kind: "dated",
          source: "Synthetic May rate",
          provenance: "manual",
        },
        {
          id: "usd-may",
          currencyCode: "USD",
          rateNokPerUnit: "11.00",
          effectiveDate: "2026-05-01",
          kind: "dated",
          source: "Synthetic May USD rate",
          provenance: "manual",
        },
        {
          id: "sek-may",
          currencyCode: "SEK",
          rateNokPerUnit: "1.05",
          effectiveDate: "2026-05-01",
          kind: "dated",
          source: "Synthetic May SEK rate",
          provenance: "manual",
        },
      ]);
      ledger.close();
      activeLedger = undefined;
      activeLedger = createLedger(databasePath);

      const report = queryNokValuationReport(activeLedger, "2026-05-31");

      expect(report.properties[0]).toMatchObject({
        id: "property-home",
        valuationDateIso: "2026-04-15",
        nativeAmountMinor: 100_000,
        nativeCurrencyCode: "EUR",
        nokAmountMinor: 1_125_000,
        exchangeRate: {
          id: "eur-april",
          effectiveDate: "2026-04-01",
          source: "Synthetic April rate",
        },
      });
      expect(report).toHaveProperty("subtotals.properties", {
        nativeSubtotals: [
          { currencyCode: "EUR", totalMinor: 100_000 },
          { currencyCode: "GBP", totalMinor: 20_000 },
        ],
        nokSubtotalMinor: null,
        partialNokSubtotalMinor: 1_125_000,
        incompleteCurrencies: ["GBP"],
      });
      expect(report.holdings[0]).toMatchObject({
        id: "holding-fund",
        valuationDateIso: "2026-05-20",
        nativeAmountMinor: 50_000,
        nativeCurrencyCode: "USD",
        nokAmountMinor: 550_000,
        exchangeRate: {
          id: "usd-may",
          effectiveDate: "2026-05-01",
        },
      });
      expect(report.liabilities[0]).toMatchObject({
        id: "loan-mortgage",
        valuationDateIso: "2026-05-31",
        nativeAmountMinor: 30_000,
        nativeCurrencyCode: "SEK",
        nokAmountMinor: 31_500,
        exchangeRate: {
          id: "sek-may",
          effectiveDate: "2026-05-01",
        },
      });
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      activeLedger?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps native subtotals and marks the NOK subtotal incomplete when any rate is missing", () => {
    const builder = getNokMonthlyReportBuilder();
    const result = builder.buildNokMonthlyReport({
      transactions,
      accounts,
      rates: [{
        id: "eur-may",
        currencyCode: "EUR",
        rateNokPerUnit: "11.50",
        effectiveDate: "2026-05-01",
        kind: "dated",
        source: "Manual entry",
        provenance: "manual",
      }],
      yearMonth: "2026-05",
    });

    expect(result.nativeSubtotals).toEqual([
      { currencyCode: "EUR", totalMinor: 10_000 },
      { currencyCode: "SEK", totalMinor: -5_000 },
    ]);
    expect(result.partialNokSubtotalMinor).toBe(115_000);
    expect(result.nokSubtotalMinor).toBeNull();
    expect(result.incompleteCurrencies).toEqual(["SEK"]);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("uses an explicitly selected monthly estimate and confines latest-rate restatement to scenarios", () => {
    const builder = getNokMonthlyReportBuilder();
    const rates: ExchangeRate[] = [
      {
        id: "eur-may",
        currencyCode: "EUR",
        rateNokPerUnit: "11.50",
        effectiveDate: "2026-05-01",
        kind: "dated",
        source: "Manual entry",
        provenance: "manual",
      },
      {
        id: "eur-june",
        currencyCode: "EUR",
        rateNokPerUnit: "12.00",
        effectiveDate: "2026-06-01",
        kind: "dated",
        source: "Manual entry",
        provenance: "manual",
      },
      {
        id: "sek-may-reference",
        currencyCode: "SEK",
        rateNokPerUnit: "1.05",
        effectiveDate: "2026-05-01",
        kind: "monthly-reference",
        source: "User-selected monthly reference",
        provenance: "manual",
      },
    ];
    const selectedEstimate = builder.buildNokMonthlyReport({
      transactions: [transactions[1]!],
      accounts,
      rates,
      yearMonth: "2026-05",
      monthlyReferenceRateIds: { SEK: "sek-may-reference" },
    });
    const historical = builder.buildNokMonthlyReport({
      transactions: [transactions[0]!],
      accounts,
      rates,
      yearMonth: "2026-05",
    });
    const scenario = builder.buildNokMonthlyReport({
      transactions: [transactions[0]!],
      accounts,
      rates,
      yearMonth: "2026-05",
      useLatestRateScenario: true,
    });

    expect(selectedEstimate.transactions[0]).toMatchObject({
      nokAmountMinor: -5_250,
      isEstimate: true,
      isScenarioRestatement: false,
    });
    expect(historical.transactions[0]?.nokAmountMinor).toBe(115_000);
    expect(scenario.transactions[0]).toMatchObject({
      nokAmountMinor: 120_000,
      isScenarioRestatement: true,
    });
    expect(networkFetch).not.toHaveBeenCalled();
  });
});