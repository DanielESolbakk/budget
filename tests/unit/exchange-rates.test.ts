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
      subtotals: {
        properties: {
          nativeSubtotals: [{ currencyCode: "EUR", totalMinor: 100_000 }],
          nokSubtotalMinor: 1_125_000,
          partialNokSubtotalMinor: 1_125_000,
          incompleteCurrencies: [],
        },
        holdings: {
          nativeSubtotals: [{ currencyCode: "USD", totalMinor: 50_000 }],
          nokSubtotalMinor: 550_000,
          partialNokSubtotalMinor: 550_000,
          incompleteCurrencies: [],
        },
        liabilities: {
          nativeSubtotals: [{ currencyCode: "SEK", totalMinor: 30_000 }],
          nokSubtotalMinor: 31_500,
          partialNokSubtotalMinor: 31_500,
          incompleteCurrencies: [],
        },
      },
    });
  });

  it("marks valuation subtotals incomplete without dropping native amounts when a rate is missing", () => {
    const report = buildNokValuationReport({
      valuationDateIso: "2026-05-31",
      properties: [
        {
          id: "property-eur",
          householdId: "hh-rates",
          label: "Synthetic euro property",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        {
          id: "property-nok",
          householdId: "hh-rates",
          label: "Synthetic NOK property",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        {
          id: "property-gbp",
          householdId: "hh-rates",
          label: "Synthetic pound property",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
      ],
      propertyValuations: [
        {
          id: "valuation-eur",
          propertyId: "property-eur",
          effectiveDateIso: "2026-04-15",
          amountMinor: 100_000,
          currencyCode: "EUR",
          recordedAtIso: "2026-04-15T12:00:00Z",
        },
        {
          id: "valuation-nok",
          propertyId: "property-nok",
          effectiveDateIso: "2026-05-15",
          amountMinor: 500_000,
          currencyCode: "NOK",
          recordedAtIso: "2026-05-15T12:00:00Z",
        },
        {
          id: "valuation-gbp",
          propertyId: "property-gbp",
          effectiveDateIso: "2026-05-20",
          amountMinor: 20_000,
          currencyCode: "GBP",
          recordedAtIso: "2026-05-20T12:00:00Z",
        },
      ],
      holdings: [],
      holdingValuations: [],
      loans: [],
      loanBalanceSnapshots: [],
      rates: [{
        ...datedRate,
        effectiveDate: "2026-04-01",
        rateNokPerUnit: "11.25",
      }],
    });

    expect(report).toHaveProperty("subtotals.properties", {
      nativeSubtotals: [
        { currencyCode: "EUR", totalMinor: 100_000 },
        { currencyCode: "GBP", totalMinor: 20_000 },
        { currencyCode: "NOK", totalMinor: 500_000 },
      ],
      nokSubtotalMinor: null,
      partialNokSubtotalMinor: 1_625_000,
      incompleteCurrencies: ["GBP"],
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

  it("rejects a combined NOK subtotal overflow when native currency subtotals are safe", () => {
    const transaction = {
      id: "eur", householdId: "hh-rates", accountId: "account",
      bookedAtIso: "2026-05-10", amountMinor: 4_000_000_000_000_000,
      merchantRaw: "Synthetic amount", currencyCode: "EUR",
    };
    const report = (amountMinor: number) => buildNokMonthlyReport({
      transactions: [
        { ...transaction, amountMinor },
        { ...transaction, id: "usd", currencyCode: "USD", amountMinor },
      ],
      accounts: [{ id: "account", householdId: "hh-rates", name: "Synthetic account", currencyCode: "NOK" }],
      rates: [
        { ...datedRate, rateNokPerUnit: "2" },
        { ...datedRate, id: "usd", currencyCode: "USD", rateNokPerUnit: "2" },
      ],
      yearMonth: "2026-05",
    });

    expect(report(2_000_000_000_000_000).nokSubtotalMinor).toBe(8_000_000_000_000_000);
    expect(() => report(4_000_000_000_000_000)).toThrow(
      new RangeError("NOK report subtotal exceeds the safe integer range.")
    );
    expect(() => report(-4_000_000_000_000_000)).toThrow(
      new RangeError("NOK report subtotal exceeds the safe integer range.")
    );
  });

  it.each([
    { action: "supersede" as const, expectedAmount: 300_000, expectedDate: "2026-05-01" },
    { action: "void" as const, expectedAmount: 100_000, expectedDate: "2026-04-01" },
  ])("excludes the corrected valuation from reports when a $action takes effect", ({
    action, expectedAmount, expectedDate,
  }) => {
    const original = {
      id: "original", propertyId: "property", effectiveDateIso: "2026-05-10",
      recordedAtIso: "2026-05-10T00:00:00Z", amountMinor: 200_000, currencyCode: "NOK",
    };
    const correctionDate = action === "supersede" ? "2026-05-01" : "2026-05-10";
    const correction = {
      ...original, id: "correction", effectiveDateIso: correctionDate,
      recordedAtIso: "2026-06-01T00:00:00Z",
      amountMinor: action === "supersede" ? 300_000 : 200_000,
      correction: { action, targetValuationId: "original" },
    };
    const reportAt = (valuationDateIso: string) => buildNokValuationReport({
      valuationDateIso,
      properties: [{
        id: "property", householdId: "hh-rates", label: "Synthetic home",
        createdAtIso: "2026-01-01T00:00:00Z",
      }],
      propertyValuations: [
        original, correction,
        { ...original, id: "earlier", effectiveDateIso: "2026-04-01", amountMinor: 100_000 },
      ],
      holdings: [], holdingValuations: [], loans: [], loanBalanceSnapshots: [], rates: [],
    });

    expect(reportAt("2026-04-30").subtotals.properties.nokSubtotalMinor).toBe(100_000);
    for (const date of [correctionDate, "2026-05-31"]) {
      const report = reportAt(date);
      expect(report.properties).toEqual([{
        id: "property", label: "Synthetic home", valuationDateIso: expectedDate,
        nativeAmountMinor: expectedAmount, nativeCurrencyCode: "NOK",
        nokAmountMinor: expectedAmount, exchangeRate: null, isEstimate: false,
      }]);
      expect(report.subtotals.properties.nokSubtotalMinor).toBe(expectedAmount);
    }
  });

  it.each([
    { order: [0, 1, 2, 3, 4], label: "forward" },
    { order: [4, 3, 2, 1, 0], label: "reversed" },
  ])("selects valuations by effective date, recorded time, then ID ($label input)", ({ order }) => {
    const base = {
      id: "0-older-date", propertyId: "property", effectiveDateIso: "2026-04-30",
      recordedAtIso: "2026-06-01T00:00:00Z", amountMinor: 100, currencyCode: "NOK",
    };
    const valuations = [
      base,
      { ...base, id: "0-older-recording", effectiveDateIso: "2026-05-01",
        recordedAtIso: "2026-05-01T00:00:00Z", amountMinor: 200 },
      { ...base, id: "z-tied", effectiveDateIso: "2026-05-01",
        recordedAtIso: "2026-05-02T00:00:00Z", amountMinor: 300 },
      { ...base, id: "a-tied", effectiveDateIso: "2026-05-01",
        recordedAtIso: "2026-05-02T00:00:00Z", amountMinor: 400 },
      { ...base, id: "future", effectiveDateIso: "2026-06-01", amountMinor: 500 },
    ];
    const report = buildNokValuationReport({
      valuationDateIso: "2026-05-31",
      properties: [{ id: "property", householdId: "hh-rates", label: "Synthetic home",
        createdAtIso: "2026-01-01T00:00:00Z" }],
      propertyValuations: order.map(index => valuations[index]!),
      holdings: [], holdingValuations: [], loans: [], loanBalanceSnapshots: [], rates: [],
    });
    expect(report.properties).toEqual([{
      id: "property", label: "Synthetic home", valuationDateIso: "2026-05-01",
      nativeAmountMinor: 400, nativeCurrencyCode: "NOK", nokAmountMinor: 400,
      exchangeRate: null, isEstimate: false,
    }]);
    expect(report.subtotals.properties.nokSubtotalMinor).toBe(400);
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
