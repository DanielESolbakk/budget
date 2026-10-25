import { describe, expect, it } from "vitest";
import { buildNokMonthlyReport } from "../../src/app/dashboardApi.js";
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
