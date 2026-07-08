import { describe, expect, it } from "vitest";
import { buildDashboardData } from "../../src/app/dashboardApi.js";
import type { MonthlyTotal, MonthSeries } from "../../src/domain/types.js";

const threeMonthHistory: MonthlyTotal[] = [
  { yearMonth: "2026-01", totalMinor: 50000 },
  { yearMonth: "2026-02", totalMinor: 60000 },
  { yearMonth: "2026-03", totalMinor: 70000 }
];

const oneMonthHistory: MonthlyTotal[] = [
  { yearMonth: "2026-01", totalMinor: 50000 }
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
