import { describe, expect, it } from "vitest";
import { buildDashboardData } from "../../src/app/dashboardApi.js";
import type { MonthlyTotal } from "../../src/domain/types.js";

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
