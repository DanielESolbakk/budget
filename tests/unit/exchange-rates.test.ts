import { describe, expect, it } from "vitest";
import { buildNokMonthlyReport, buildNokValuationReport } from "../../src/app/dashboardApi.js";
import { parseExchangeRateCsv } from "../../src/app/exchangeRateImport.js";
import { convertCurrencyAmount } from "../../src/domain/money/convertCurrencyAmount.js";
import { selectExchangeRate, validateExchangeRate } from "../../src/domain/money/exchangeRates.js";

const datedRate = {
  id: "eur-may-rate",
  currencyCode: "EUR",
  rateNokPerUnit: "11.50",
  effectiveDate: "2026-05-01",
  kind: "dated" as const,
  source: "Manual entry",
  provenance: "manual" as const,
};

describe("dated local exchange rates", () => {
  it("selects the latest dated rate not later than the report date", () => {
    const laterRate = { ...datedRate, id: "eur-june-rate", effectiveDate: "2026-06-01" };

    expect(selectExchangeRate([laterRate, datedRate], "EUR", "2026-05-20")).toEqual({
      state: "selected",
      rate: datedRate,
      isEstimate: false,
    });
  });

  it("uses a monthly reference rate only when the user selects it explicitly", () => {
    const monthlyRate = {
      ...datedRate,
      id: "eur-monthly-rate",
      effectiveDate: "2026-05-01",
      kind: "monthly-reference" as const,
    };

    expect(selectExchangeRate([monthlyRate], "EUR", "2026-05-20")).toEqual({
      state: "missing",
    });
    expect(
      selectExchangeRate([monthlyRate], "EUR", "2026-05-20", "eur-monthly-rate")
    ).toEqual({
      state: "selected",
      rate: monthlyRate,
      isEstimate: true,
    });
  });

  it("rejects a non-positive or malformed NOK-per-unit quote", () => {
    expect(() =>
      validateExchangeRate({ ...datedRate, rateNokPerUnit: "0" })
    ).toThrow();
    expect(() =>
      validateExchangeRate({ ...datedRate, rateNokPerUnit: "1,25" })
    ).toThrow();
  });

  it("parses local rate CSV rows with source provenance", () => {
    expect(parseExchangeRateCsv(
      "currencyCode,rateNokPerUnit,effectiveDate,kind\nEUR,11.50,2026-05-01,dated\n",
      "rates.csv"
    )).toEqual([
      {
        id: "rate-EUR-2026-05-01-dated",
        currencyCode: "EUR",
        rateNokPerUnit: "11.50",
        effectiveDate: "2026-05-01",
        kind: "dated",
        source: "rates.csv",
        provenance: "local-file",
      },
    ]);
  });

  it("rejects invalid dates, quotes, and duplicate currency/date/kind rows in a local CSV", () => {
    expect(() =>
      parseExchangeRateCsv(
        "currencyCode,rateNokPerUnit,effectiveDate,kind\nEUR,11.50,2026-02-30,dated\n",
        "rates.csv"
      )
    ).toThrow();
    expect(() =>
      parseExchangeRateCsv(
        "currencyCode,rateNokPerUnit,effectiveDate,kind\nEUR,0,2026-05-01,dated\n",
        "rates.csv"
      )
    ).toThrow();
    expect(() =>
      parseExchangeRateCsv(
        "currencyCode,rateNokPerUnit,effectiveDate,kind\nEUR,11.50,2026-05-01,dated\nEUR,11.60,2026-05-01,dated\n",
        "rates.csv"
      )
    ).toThrow();
  });

  it("converts to NOK while preserving the original amount and rate provenance", () => {
    const result = convertCurrencyAmount({
      amountMinor: 10_000,
      currencyCode: "EUR",
      asOfDateIso: "2026-05-20",
      rates: [datedRate],
    });

    expect(result).toMatchObject({
      state: "converted",
      nativeAmountMinor: 10_000,
      nativeCurrencyCode: "EUR",
      nokAmountMinor: 115_000,
      isEstimate: false,
      exchangeRate: datedRate,
    });
  });

  it("passes NOK amounts through unchanged without requiring a stored rate", () => {
    for (const amountMinor of [10_000, -5_000]) {
      expect(convertCurrencyAmount({
        amountMinor,
        currencyCode: "NOK",
        asOfDateIso: "2026-05-20",
        rates: [],
      })).toMatchObject({
        state: "converted",
        nativeAmountMinor: amountMinor,
        nativeCurrencyCode: "NOK",
        nokAmountMinor: amountMinor,
        exchangeRate: null,
        isEstimate: false,
      });
    }
  });

  it("returns an incomplete result instead of a zero or one-to-one fallback when no rate exists", () => {
    const result = convertCurrencyAmount({
      amountMinor: 10_000,
      currencyCode: "SEK",
      asOfDateIso: "2026-05-20",
      rates: [],
    });

    expect(result).toMatchObject({
      state: "incomplete",
      nativeAmountMinor: 10_000,
      nativeCurrencyCode: "SEK",
      nokAmountMinor: null,
    });
  });

  it("includes only transactions from the requested report month", () => {
    const mayTransaction = {
      id: "tx-may",
      householdId: "hh-rates",
      accountId: "acc-eur",
      bookedAtIso: "2026-05-10T00:00:00Z",
      amountMinor: 10_000,
      merchantRaw: "Synthetic May income",
      currencyCode: "EUR",
    };
    const report = buildNokMonthlyReport({
      transactions: [
        { ...mayTransaction, id: "tx-april", bookedAtIso: "2026-04-30T23:59:59Z", amountMinor: 50_000 },
        mayTransaction,
        { ...mayTransaction, id: "tx-june", bookedAtIso: "2026-06-01T00:00:00Z", amountMinor: -30_000 },
      ],
      accounts: [{
        id: "acc-eur",
        householdId: "hh-rates",
        name: "Synthetic euro account",
        currencyCode: "EUR",
      }],
      rates: [datedRate],
      yearMonth: "2026-05",
    });

    expect(report.transactions.map(({ transactionId }) => transactionId)).toEqual(["tx-may"]);
    expect(report.nativeSubtotals).toEqual([{ currencyCode: "EUR", totalMinor: 10_000 }]);
    expect(report.nokSubtotalMinor).toBe(115_000);
  });

  it("uses each asset and liability valuation date while preserving native values and rate provenance", () => {
    const eurAprilRate = {
      ...datedRate,
      id: "eur-april-rate",
      effectiveDate: "2026-04-01",
      rateNokPerUnit: "11.25",
    };
    const eurMayRate = {
      ...datedRate,
      id: "eur-may-rate",
      effectiveDate: "2026-05-01",
      rateNokPerUnit: "12.50",
    };
    const usdAprilRate = {
      ...datedRate,
      id: "usd-april-rate",
      currencyCode: "USD",
      effectiveDate: "2026-04-01",
      rateNokPerUnit: "10.00",
    };
    const usdMayRate = {
      ...datedRate,
      id: "usd-may-rate",
      currencyCode: "USD",
      effectiveDate: "2026-05-01",
      rateNokPerUnit: "11.00",
    };
    const sekMayRate = {
      ...datedRate,
      id: "sek-may-rate",
      currencyCode: "SEK",
      effectiveDate: "2026-05-01",
      rateNokPerUnit: "1.05",
    };
    const report = buildNokValuationReport({
      valuationDateIso: "2026-05-31",
      rates: [eurAprilRate, eurMayRate, usdAprilRate, usdMayRate, sekMayRate],
      properties: [{
        id: "property-home",
        householdId: "hh-rates",
        label: "Home",
        createdAtIso: "2026-01-01T00:00:00Z",
      }],
      propertyValuations: [{
        id: "property-home-april",
        propertyId: "property-home",
        effectiveDateIso: "2026-04-15",
        amountMinor: 100_000,
        currencyCode: "EUR",
        recordedAtIso: "2026-04-15T12:00:00Z",
      }],
      holdings: [{
        id: "holding-fund",
        householdId: "hh-rates",
        label: "Index fund",
        quantity: 1,
        costBasisMinor: 40_000,
        currencyCode: "USD",
        createdAtIso: "2026-01-01T00:00:00Z",
      }],
      holdingValuations: [{
        id: "holding-fund-may",
        holdingId: "holding-fund",
        effectiveDateIso: "2026-05-20",
        amountMinor: 50_000,
        currencyCode: "USD",
        recordedAtIso: "2026-05-20T12:00:00Z",
      }],
      loans: [{
        id: "loan-mortgage",
        householdId: "hh-rates",
        label: "Mortgage",
        principalMinor: 100_000,
        annualInterestRateBasisPoints: 400,
        termMonths: 240,
        paymentAmountMinor: 5_000,
        paymentFrequency: "monthly",
        currencyCode: "SEK",
        createdAtIso: "2026-01-01T00:00:00Z",
      }],
      loanBalanceSnapshots: [{
        id: "loan-mortgage-may",
        loanId: "loan-mortgage",
        effectiveDateIso: "2026-05-31",
        amountMinor: 30_000,
        currencyCode: "SEK",
        recordedAtIso: "2026-05-31T12:00:00Z",
      }],
    });

    expect(report).toEqual({
      valuationDateIso: "2026-05-31",
      properties: [{
        id: "property-home",
        label: "Home",
        valuationDateIso: "2026-04-15",
        nativeAmountMinor: 100_000,
        nativeCurrencyCode: "EUR",
        nokAmountMinor: 1_125_000,
        exchangeRate: eurAprilRate,
        isEstimate: false,
      }],
      holdings: [{
        id: "holding-fund",
        label: "Index fund",
        valuationDateIso: "2026-05-20",
        nativeAmountMinor: 50_000,
        nativeCurrencyCode: "USD",
        nokAmountMinor: 550_000,
        exchangeRate: usdMayRate,
        isEstimate: false,
      }],
      liabilities: [{
        id: "loan-mortgage",
        label: "Mortgage",
        valuationDateIso: "2026-05-31",
        nativeAmountMinor: 30_000,
        nativeCurrencyCode: "SEK",
        nokAmountMinor: 31_500,
        exchangeRate: sekMayRate,
        isEstimate: false,
      }],
    });
  });

  it("does not apply a future valuation correction to an earlier report date", () => {
    const earlyRate = { ...datedRate, effectiveDate: "2026-04-01" };
    const originalValuation = {
      id: "property-home-april",
      propertyId: "property-home",
      effectiveDateIso: "2026-04-15",
      amountMinor: 100_000,
      currencyCode: "EUR",
      recordedAtIso: "2026-04-15T12:00:00Z",
    };
    const report = buildNokValuationReport({
      valuationDateIso: "2026-05-31",
      properties: [{
        id: "property-home",
        householdId: "hh-rates",
        label: "Home",
        createdAtIso: "2026-01-01T00:00:00Z",
      }],
      propertyValuations: [
        originalValuation,
        {
          ...originalValuation,
          id: "property-home-june-correction",
          effectiveDateIso: "2026-06-15",
          amountMinor: 120_000,
          recordedAtIso: "2026-06-15T12:00:00Z",
          correction: {
            action: "supersede" as const,
            targetValuationId: originalValuation.id,
          },
        },
      ],
      holdings: [],
      holdingValuations: [],
      loans: [],
      loanBalanceSnapshots: [],
      rates: [earlyRate],
    });

    expect(report.properties).toEqual([{
      id: "property-home",
      label: "Home",
      valuationDateIso: "2026-04-15",
      nativeAmountMinor: 100_000,
      nativeCurrencyCode: "EUR",
      nokAmountMinor: 1_150_000,
      exchangeRate: earlyRate,
      isEstimate: false,
    }]);
  });

  it("rounds positive and negative NOK minor units symmetrically at half-unit boundaries", () => {
    const halfMinorRate = { ...datedRate, rateNokPerUnit: "0.5" };
    const input = {
      currencyCode: "EUR",
      asOfDateIso: "2026-05-20",
      rates: [halfMinorRate],
    };

    expect(convertCurrencyAmount({ ...input, amountMinor: 1 }).nokAmountMinor).toBe(1);
    expect(convertCurrencyAmount({ ...input, amountMinor: -1 }).nokAmountMinor).toBe(-1);
  });

  it("limits latest-rate restatement to an explicit scenario result", () => {
    const latestRate = { ...datedRate, id: "eur-june-rate", rateNokPerUnit: "12.00", effectiveDate: "2026-06-01" };
    const input = {
      amountMinor: 10_000,
      currencyCode: "EUR",
      asOfDateIso: "2026-05-20",
      rates: [datedRate, latestRate],
    };

    const historical = convertCurrencyAmount(input);
    const scenario = convertCurrencyAmount({ ...input, useLatestRateScenario: true });

    expect(historical.nokAmountMinor).toBe(115_000);
    expect(scenario.nokAmountMinor).toBe(120_000);
    expect(scenario.isScenarioRestatement).toBe(true);
  });

  it("rejects a native-currency subtotal outside the safe minor-unit range", () => {
    expect(() => buildNokMonthlyReport({
      transactions: [
        {
          id: "tx-large-1",
          householdId: "hh-rates",
          accountId: "acc-sek",
          bookedAtIso: "2026-05-01T00:00:00Z",
          amountMinor: Number.MAX_SAFE_INTEGER,
          merchantRaw: "Synthetic large balance",
          currencyCode: "SEK",
        },
        {
          id: "tx-large-2",
          householdId: "hh-rates",
          accountId: "acc-sek",
          bookedAtIso: "2026-05-02T00:00:00Z",
          amountMinor: 1,
          merchantRaw: "Synthetic additional unit",
          currencyCode: "SEK",
        },
      ],
      accounts: [{
        id: "acc-sek",
        householdId: "hh-rates",
        name: "Synthetic SEK account",
        currencyCode: "SEK",
      }],
      rates: [],
      yearMonth: "2026-05",
    })).toThrow(/safe integer/);
  });
});
