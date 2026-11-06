import { describe, expect, it } from "vitest";
import {
  calculateCashflowScenario,
  type CashflowScenarioCalculationInput,
  validateCashflowScenarioRequest,
} from "../../src/domain/forecast/cashflowScenarios.js";

const baselineInput: CashflowScenarioCalculationInput = {
  evaluatedAtIso: "2026-05-31T12:00:00.000Z",
  startingCashNokMinor: 200_000,
  baselineMonthlyCashflows: [
    { yearMonth: "2026-06", netCashflowNokMinor: 50_000 },
    { yearMonth: "2026-07", netCashflowNokMinor: 40_000 },
    { yearMonth: "2026-08", netCashflowNokMinor: 30_000 },
  ],
  baselineCashEvents: [],
  assumptions: [],
  rates: [],
  useLatestRateScenario: false,
};

describe("cashflow scenario calculation", () => {
  it("applies a temporary income reduction only during its dated months", () => {
    const result = calculateCashflowScenario({
      ...baselineInput,
      assumptions: [{
        id: "income-reduction",
        kind: "income-change",
        direction: "reduction",
        amountMinor: 10_000,
        currencyCode: "NOK",
        startDateIso: "2026-07-15",
        durationMonths: 2,
      }],
    });

    expect(result.state).toBe("complete");
    if (result.state !== "complete") return;
    expect(result.months).toEqual([
      {
        yearMonth: "2026-06",
        baselineCashflowNokMinor: 50_000,
        scenarioCashflowNokMinor: 50_000,
        differenceNokMinor: 0,
        baselineEndingCashNokMinor: 250_000,
        scenarioEndingCashNokMinor: 250_000,
      },
      {
        yearMonth: "2026-07",
        baselineCashflowNokMinor: 40_000,
        scenarioCashflowNokMinor: 30_000,
        differenceNokMinor: -10_000,
        baselineEndingCashNokMinor: 290_000,
        scenarioEndingCashNokMinor: 280_000,
      },
      {
        yearMonth: "2026-08",
        baselineCashflowNokMinor: 30_000,
        scenarioCashflowNokMinor: 20_000,
        differenceNokMinor: -10_000,
        baselineEndingCashNokMinor: 320_000,
        scenarioEndingCashNokMinor: 300_000,
      },
    ]);
  });

  it("keeps cash unchanged before a one-time expense and reports the projected shortfall", () => {
    const result = calculateCashflowScenario({
      ...baselineInput,
      assumptions: [{
        id: "one-time-cost",
        kind: "one-time-expense",
        amountMinor: 75_000,
        currencyCode: "NOK",
        occurrenceDateIso: "2026-07-15",
      }],
    });

    expect(result.state).toBe("complete");
    if (result.state !== "complete") return;
    expect(result.months).toEqual([
      {
        yearMonth: "2026-06",
        baselineCashflowNokMinor: 50_000,
        scenarioCashflowNokMinor: 50_000,
        differenceNokMinor: 0,
        baselineEndingCashNokMinor: 250_000,
        scenarioEndingCashNokMinor: 250_000,
      },
      {
        yearMonth: "2026-07",
        baselineCashflowNokMinor: 40_000,
        scenarioCashflowNokMinor: -35_000,
        differenceNokMinor: -75_000,
        baselineEndingCashNokMinor: 290_000,
        scenarioEndingCashNokMinor: 215_000,
      },
      {
        yearMonth: "2026-08",
        baselineCashflowNokMinor: 30_000,
        scenarioCashflowNokMinor: 30_000,
        differenceNokMinor: 0,
        baselineEndingCashNokMinor: 320_000,
        scenarioEndingCashNokMinor: 245_000,
      },
    ]);
    expect(result.scenario.minimumProjectedCashNokMinor).toBe(175_000);
    expect(result.minimumDifferenceNokMinor).toBe(-25_000);
    expect(result.scenario.projectedCashPath).toContainEqual({
      dateIso: "2026-06-30",
      description: "Forecast monthly net cashflow",
      amountNokMinor: 50_000,
      projectedCashNokMinor: 250_000,
    });
  });

  it("produces the same result when equivalent baseline and assumption inputs are reordered", () => {
    const assumptions = [
      {
        id: "income-reduction",
        kind: "income-change" as const,
        direction: "reduction" as const,
        amountMinor: 10_000,
        currencyCode: "NOK",
        startDateIso: "2026-07-15",
        durationMonths: 2,
      },
      {
        id: "one-time-cost",
        kind: "one-time-expense" as const,
        amountMinor: 5_000,
        currencyCode: "NOK",
        occurrenceDateIso: "2026-06-10",
      },
    ];
    const baselineCashEvents = [
      {
        id: "electricity",
        dateIso: "2026-07-20",
        description: "Electricity",
        amountNokMinor: -2_000,
      },
      {
        id: "rent",
        dateIso: "2026-06-05",
        description: "Rent",
        amountNokMinor: -8_000,
      },
    ];

    const forward = calculateCashflowScenario({
      ...baselineInput,
      assumptions,
      baselineCashEvents,
    });
    const reversed = calculateCashflowScenario({
      ...baselineInput,
      baselineMonthlyCashflows: [...baselineInput.baselineMonthlyCashflows].reverse(),
      assumptions: [...assumptions].reverse(),
      baselineCashEvents: [...baselineCashEvents].reverse(),
    });

    expect(reversed).toEqual(forward);
  });

  it("uses an explicitly selected latest rate only for scenario inputs", () => {
    const result = calculateCashflowScenario({
      ...baselineInput,
      assumptions: [{
        id: "foreign-expense",
        kind: "one-time-expense",
        amountMinor: 10_000,
        currencyCode: "EUR",
        occurrenceDateIso: "2026-06-15",
      }],
      rates: [{
        id: "eur-latest",
        currencyCode: "EUR",
        rateNokPerUnit: "11.5",
        effectiveDate: "2026-08-31",
        kind: "dated",
        source: "Synthetic latest rate",
        provenance: "manual",
      }],
      useLatestRateScenario: true,
    });

    expect(result.state).toBe("complete");
    if (result.state !== "complete") return;
    expect(result.baseline.monthlyCashflows[0]).toMatchObject({
      yearMonth: "2026-06",
      netCashflowNokMinor: 50_000,
    });
    expect(result.months[0]).toMatchObject({
      baselineCashflowNokMinor: 50_000,
      scenarioCashflowNokMinor: -65_000,
      differenceNokMinor: -115_000,
    });
    expect(result.appliedAssumptions).toEqual([expect.objectContaining({
      id: "foreign-expense",
      dateIso: "2026-06-15",
      amountNokMinor: -115_000,
      isScenarioRestatement: true,
      exchangeRate: expect.objectContaining({ id: "eur-latest" }),
    })]);
  });

  it("keeps the baseline visible but leaves scenario values incomplete when an input rate is missing", () => {
    const result = calculateCashflowScenario({
      ...baselineInput,
      assumptions: [{
        id: "foreign-expense",
        kind: "one-time-expense",
        amountMinor: 10_000,
        currencyCode: "EUR",
        occurrenceDateIso: "2026-06-15",
      }],
    });

    expect(result.state).toBe("incomplete");
    if (result.state !== "incomplete") return;
    expect(result.baseline?.monthlyCashflows[0]).toMatchObject({
      yearMonth: "2026-06",
      netCashflowNokMinor: 50_000,
    });
    expect(result.scenario).toBeNull();
    expect(result.incompleteReasons).toEqual([expect.objectContaining({
      code: "missing-exchange-rate",
      assumptionId: "foreign-expense",
      currencyCode: "EUR",
      dateIso: "2026-06-15",
    })]);
  });

  it("keeps all projection values incomplete when the shared baseline is incomplete", () => {
    const result = calculateCashflowScenario({
      ...baselineInput,
      baselineIncompleteReasons: [{
        code: "unknown-variable-commitment",
        message: "An active commitment has an unknown amount.",
      }],
    });

    expect(result).toMatchObject({
      state: "incomplete",
      baseline: null,
      scenario: null,
      incompleteReasons: [{
        code: "unknown-variable-commitment",
        message: "An active commitment has an unknown amount.",
      }],
    });
  });

  it("rejects malformed dates, currencies, and durations at the scenario contract boundary", () => {
    expect(() => validateCashflowScenarioRequest({
      assumptions: [{
        id: "invalid-expense",
        kind: "one-time-expense",
        amountMinor: 5_000,
        currencyCode: "NOK",
        occurrenceDateIso: "2026-02-30",
      }],
      useLatestRateScenario: false,
    })).toThrow("occurrenceDateIso must be a valid YYYY-MM-DD date.");

    expect(() => validateCashflowScenarioRequest({
      assumptions: [{
        id: "too-long",
        kind: "recurring-expense",
        amountMinor: 5_000,
        currencyCode: "NOK",
        startDateIso: "2026-06-01",
        durationMonths: 4,
      }],
      useLatestRateScenario: false,
    })).toThrow("durationMonths must be between 1 and 3.");
  });

  it("rejects duplicate assumption identifiers", () => {
    const assumption = {
      id: "duplicate",
      kind: "one-time-expense" as const,
      amountMinor: 5_000,
      currencyCode: "NOK",
      occurrenceDateIso: "2026-06-01",
    };

    expect(() => validateCashflowScenarioRequest({
      assumptions: [assumption, { ...assumption }],
      useLatestRateScenario: false,
    })).toThrow("Scenario assumption id must be unique: duplicate");
  });
});
