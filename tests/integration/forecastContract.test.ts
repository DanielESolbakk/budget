import { describe, expect, it } from "vitest";
import { buildDashboardData } from "../../src/app/dashboardApi.js";
import { buildMonthBuckets } from "../../src/domain/forecast/aggregationAdapter.js";
import {
  buildForecastInput,
  buildForecastInputFromMonthSeries,
} from "../../src/domain/forecast/forecastInputAdapter.js";
import type { ForecastInput, MonthlyTotal, MonthSeries, Transaction } from "../../src/domain/types.js";

const threeMonthHistory: MonthlyTotal[] = [
  { yearMonth: "2026-01", totalMinor: 50000 },
  { yearMonth: "2026-02", totalMinor: 60000 },
  { yearMonth: "2026-03", totalMinor: 70000 }
];

const oneMonthHistory: MonthlyTotal[] = [
  { yearMonth: "2026-01", totalMinor: 50000 }
];

const flatTransactions: Transaction[] = [
  {
    id: "tx-1",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-03-20T00:00:00Z",
    amountMinor: 2500,
    merchantRaw: "Kiwi"
  },
  {
    id: "tx-2",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-01-05T00:00:00Z",
    amountMinor: 1000,
    merchantRaw: "Rema 1000"
  },
  {
    id: "tx-3",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-03-01T00:00:00Z",
    amountMinor: -500,
    merchantRaw: "Vy"
  },
];

describe("buildDashboardData – forecast contract", () => {
  it("AC-1: dashboard data includes forecast fields in a stable contract", () => {
    const data = buildDashboardData({ monthlyTotals: threeMonthHistory });

    expect(data).toHaveProperty("monthlyTotals");
    expect(data).toHaveProperty("forecast");
    expect(data.forecast).toHaveProperty("entries");
    expect(data.forecast).toHaveProperty("usedFallback");
    expect(Array.isArray(data.forecast.entries)).toBe(true);
  });

  it("AC-1: each forecast entry has yearMonth, projectedMinor, and method fields", () => {
    const data = buildDashboardData({ monthlyTotals: threeMonthHistory });

    for (const entry of data.forecast.entries) {
      expect(typeof entry.yearMonth).toBe("string");
      expect(entry.yearMonth).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof entry.projectedMinor).toBe("number");
      expect(["moving-average-3m", "fallback-zero"]).toContain(entry.method);
    }
  });

  it("AC-1: forecast entries are projected beyond the last known month", () => {
    const data = buildDashboardData({ monthlyTotals: threeMonthHistory });

    const lastActual = threeMonthHistory[threeMonthHistory.length - 1]?.yearMonth ?? "";
    for (const entry of data.forecast.entries) {
      expect(entry.yearMonth > lastActual).toBe(true);
    }
  });

  it("AC-2: monthly totals are unchanged when forecast is added", () => {
    const data = buildDashboardData({ monthlyTotals: threeMonthHistory });

    expect(data.monthlyTotals).toEqual(threeMonthHistory);
  });

  it("AC-2: default forecast produces three projected periods", () => {
    const data = buildDashboardData({ monthlyTotals: threeMonthHistory });

    expect(data.forecast.entries).toHaveLength(3);
    expect(data.forecast.usedFallback).toBe(false);
  });

  it("AC-2: forecast periods can be overridden without affecting totals", () => {
    const data = buildDashboardData({ monthlyTotals: threeMonthHistory, forecastPeriods: 2 });

    expect(data.forecast.entries).toHaveLength(2);
    expect(data.monthlyTotals).toEqual(threeMonthHistory);
  });

  it("AC-2: moving-average projection uses the correct method label", () => {
    const data = buildDashboardData({ monthlyTotals: threeMonthHistory });

    for (const entry of data.forecast.entries) {
      expect(entry.method).toBe("moving-average-3m");
    }
  });

  it("AC-2: 3-month average is computed correctly from three-month history", () => {
    const data = buildDashboardData({ monthlyTotals: threeMonthHistory });

    const expected = Math.round((50000 + 60000 + 70000) / 3);
    for (const entry of data.forecast.entries) {
      expect(entry.projectedMinor).toBe(expected);
    }
  });

  it("AC-2: sparse history (one month) still produces a forecast without error", () => {
    const data = buildDashboardData({ monthlyTotals: oneMonthHistory });

    expect(data.forecast.usedFallback).toBe(false);
    expect(data.forecast.entries.length).toBeGreaterThan(0);
    expect(data.forecast.entries[0]?.method).toBe("moving-average-3m");
  });

  it("AC-3: empty history triggers explicit fallback with usedFallback true", () => {
    const data = buildDashboardData({ monthlyTotals: [], fallbackStartYearMonth: "2026-04" });

    expect(data.forecast.usedFallback).toBe(true);
    expect(data.forecast.entries.length).toBeGreaterThan(0);
  });

  it("AC-3: fallback entries have projectedMinor of zero and method fallback-zero", () => {
    const data = buildDashboardData({ monthlyTotals: [], fallbackStartYearMonth: "2026-04" });

    for (const entry of data.forecast.entries) {
      expect(entry.projectedMinor).toBe(0);
      expect(entry.method).toBe("fallback-zero");
    }
  });

  it("AC-3: fallback does not affect the monthlyTotals field", () => {
    const data = buildDashboardData({ monthlyTotals: [], fallbackStartYearMonth: "2026-04" });

    expect(data.monthlyTotals).toEqual([]);
  });

  it("AC-3: fallback yearMonths start from the given fallbackStartYearMonth", () => {
    const data = buildDashboardData({ monthlyTotals: [], fallbackStartYearMonth: "2026-04" });

    expect(data.forecast.entries[0]?.yearMonth).toBe("2026-04");
    expect(data.forecast.entries[1]?.yearMonth).toBe("2026-05");
    expect(data.forecast.entries[2]?.yearMonth).toBe("2026-06");
  });
});

describe("MonthSeries – contract compatibility", () => {
  it("buildDashboardData returns a value assignable to MonthSeries", () => {
    const series: MonthSeries = buildDashboardData({ monthlyTotals: threeMonthHistory });

    expect(Array.isArray(series.monthlyTotals)).toBe(true);
    expect(series.forecast).toHaveProperty("entries");
    expect(series.forecast).toHaveProperty("usedFallback");
  });

  it("MonthSeries monthlyTotals are in ascending yearMonth order", () => {
    const series: MonthSeries = buildDashboardData({ monthlyTotals: threeMonthHistory });

    for (let i = 1; i < series.monthlyTotals.length; i++) {
      expect(series.monthlyTotals[i]!.yearMonth > series.monthlyTotals[i - 1]!.yearMonth).toBe(true);
    }
  });

  it("MonthSeries forecast entries are strictly after the last actual month", () => {
    const series: MonthSeries = buildDashboardData({ monthlyTotals: threeMonthHistory });
    const lastActual = series.monthlyTotals[series.monthlyTotals.length - 1]!.yearMonth;

    for (const entry of series.forecast.entries) {
      expect(entry.yearMonth > lastActual).toBe(true);
    }
  });

  it("MonthSeries insufficient-history: empty actuals sets usedFallback true with fallback-zero entries", () => {
    const series: MonthSeries = buildDashboardData({
      monthlyTotals: [],
      fallbackStartYearMonth: "2026-04",
    });

    expect(series.monthlyTotals).toHaveLength(0);
    expect(series.forecast.usedFallback).toBe(true);
    for (const entry of series.forecast.entries) {
      expect(entry.method).toBe("fallback-zero");
      expect(entry.projectedMinor).toBe(0);
    }
  });

  it("MonthSeries insufficient-history: sparse actuals still use moving-average-3m method", () => {
    const series: MonthSeries = buildDashboardData({ monthlyTotals: oneMonthHistory });

    expect(series.forecast.usedFallback).toBe(false);
    for (const entry of series.forecast.entries) {
      expect(entry.method).toBe("moving-average-3m");
    }
  });
});

describe("buildMonthBuckets – MonthSeries adapter compatibility", () => {
  it("AC-3: adapter output is assignable to MonthSeries monthlyTotals", () => {
    const monthlyTotals: MonthSeries["monthlyTotals"] = buildMonthBuckets(flatTransactions);

    expect(monthlyTotals).toEqual([
      { yearMonth: "2026-01", totalMinor: 1000 },
      { yearMonth: "2026-02", totalMinor: 0 },
      { yearMonth: "2026-03", totalMinor: 2000 }
    ]);
  });

  it("AC-3: adapter output composes into buildDashboardData MonthSeries contract", () => {
    const monthlyTotals = buildMonthBuckets(flatTransactions);
    const series: MonthSeries = buildDashboardData({ monthlyTotals });

    expect(series.monthlyTotals).toEqual(monthlyTotals);
    expect(series.forecast.entries[0]!.yearMonth).toBe("2026-04");
    expect(series.forecast.entries[0]!.method).toBe("moving-average-3m");
    expect(series.forecast.usedFallback).toBe(false);
  });
});

describe("ForecastInput – contract shape assertions (AC-4)", () => {
  const threeMonthTotals: MonthlyTotal[] = [
    { yearMonth: "2026-01", totalMinor: 50000 },
    { yearMonth: "2026-02", totalMinor: 60000 },
    { yearMonth: "2026-03", totalMinor: 70000 },
  ];

  it("AC-4: ForecastInput has history, periods, and fallbackStartYearMonth fields", () => {
    const input: ForecastInput = buildForecastInput(threeMonthTotals, {
      fallbackStartYearMonth: "2026-04",
    });

    expect(input).toHaveProperty("history");
    expect(input).toHaveProperty("periods");
    expect(input).toHaveProperty("fallbackStartYearMonth");
  });

  it("AC-4: ForecastInput.history matches the provided MonthlyTotal array", () => {
    const input: ForecastInput = buildForecastInput(threeMonthTotals, {
      fallbackStartYearMonth: "2026-04",
    });

    expect(input.history).toEqual(threeMonthTotals);
  });

  it("AC-4: ForecastInput.periods is a concrete number (3 by default)", () => {
    const input: ForecastInput = buildForecastInput(threeMonthTotals, {
      fallbackStartYearMonth: "2026-04",
    });

    expect(typeof input.periods).toBe("number");
    expect(input.periods).toBe(3);
  });

  it("AC-4: ForecastInput.fallbackStartYearMonth is a concrete YYYY-MM string", () => {
    const input: ForecastInput = buildForecastInput([], { fallbackStartYearMonth: "2026-04" });

    expect(typeof input.fallbackStartYearMonth).toBe("string");
    expect(input.fallbackStartYearMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(input.fallbackStartYearMonth).toBe("2026-04");
  });

  it("AC-4: buildForecastInputFromMonthSeries produces same contract shape as buildForecastInput", () => {
    const series: MonthSeries = buildDashboardData({ monthlyTotals: threeMonthTotals });
    const fromSeries: ForecastInput = buildForecastInputFromMonthSeries(series, {
      fallbackStartYearMonth: "2026-04",
    });
    const fromBuckets: ForecastInput = buildForecastInput(threeMonthTotals, {
      fallbackStartYearMonth: "2026-04",
    });

    expect(fromSeries).toEqual(fromBuckets);
  });

  it("AC-4: empty-history ForecastInput reflects fallback representation explicitly", () => {
    const input: ForecastInput = buildForecastInput([], { fallbackStartYearMonth: "2026-04" });

    expect(input.history).toHaveLength(0);
    expect(input.fallbackStartYearMonth).toBe("2026-04");
    expect(input.periods).toBe(3);
  });

  it("AC-4: month-bucket output from buildMonthBuckets feeds into ForecastInput without type mismatch", () => {
    const monthlyTotals = buildMonthBuckets(flatTransactions);
    const input: ForecastInput = buildForecastInput(monthlyTotals, {
      fallbackStartYearMonth: "2026-04",
    });

    expect(input.history).toEqual(monthlyTotals);
    expect(input.periods).toBe(3);
  });
});
