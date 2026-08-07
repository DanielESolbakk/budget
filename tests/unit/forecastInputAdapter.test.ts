import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildForecastInput,
  buildForecastInputFromMonthSeries,
} from "../../src/domain/forecast/forecastInputAdapter.js";
import type { ForecastResult, MonthlyTotal, MonthSeries } from "../../src/domain/types.js";

const threeMonthTotals: MonthlyTotal[] = [
  { yearMonth: "2026-01", totalMinor: 50000 },
  { yearMonth: "2026-02", totalMinor: 60000 },
  { yearMonth: "2026-03", totalMinor: 70000 },
];

const oneMonthTotals: MonthlyTotal[] = [
  { yearMonth: "2026-01", totalMinor: 50000 },
];

const emptyTotals: MonthlyTotal[] = [];

const stubForecast: ForecastResult = {
  entries: [],
  usedFallback: false,
};

function buildMonthSeries(monthlyTotals: MonthlyTotal[]): MonthSeries {
  return { monthlyTotals, forecast: stubForecast };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildForecastInput – AC-1: deterministic adapter output", () => {
  it("preserves history reference unchanged", () => {
    const input = buildForecastInput(threeMonthTotals, { fallbackStartYearMonth: "2026-04" });

    expect(input.history).toEqual(threeMonthTotals);
  });

  it("resolves periods to the provided value", () => {
    const input = buildForecastInput(threeMonthTotals, {
      periods: 6,
      fallbackStartYearMonth: "2026-04",
    });

    expect(input.periods).toBe(6);
  });

  it("defaults periods to 3 when not provided", () => {
    const input = buildForecastInput(threeMonthTotals, { fallbackStartYearMonth: "2026-04" });

    expect(input.periods).toBe(3);
  });

  it("resolves fallbackStartYearMonth to the provided value", () => {
    const input = buildForecastInput(threeMonthTotals, { fallbackStartYearMonth: "2026-07" });

    expect(input.fallbackStartYearMonth).toBe("2026-07");
  });

  it("output is identical for the same input called twice (referential determinism)", () => {
    const a = buildForecastInput(threeMonthTotals, { fallbackStartYearMonth: "2026-04" });
    const b = buildForecastInput(threeMonthTotals, { fallbackStartYearMonth: "2026-04" });

    expect(a).toEqual(b);
  });

  it("result has history, periods, and fallbackStartYearMonth fields", () => {
    const input = buildForecastInput(threeMonthTotals, { fallbackStartYearMonth: "2026-04" });

    expect(input).toHaveProperty("history");
    expect(input).toHaveProperty("periods");
    expect(input).toHaveProperty("fallbackStartYearMonth");
  });
});

describe("buildForecastInput – AC-2: insufficient-history fallback representation", () => {
  it("resolves fallbackStartYearMonth to current UTC month when options are omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));

    const input = buildForecastInput(emptyTotals);
    expect(input.fallbackStartYearMonth).toBe("2026-10");
  });

  it("empty history maps to ForecastInput with explicit fallbackStartYearMonth", () => {
    const input = buildForecastInput(emptyTotals, { fallbackStartYearMonth: "2026-04" });

    expect(input.history).toHaveLength(0);
    expect(input.fallbackStartYearMonth).toBe("2026-04");
    expect(typeof input.fallbackStartYearMonth).toBe("string");
    expect(input.fallbackStartYearMonth).toMatch(/^\d{4}-\d{2}$/);
  });

  it("empty history maps to default period count of 3", () => {
    const input = buildForecastInput(emptyTotals, { fallbackStartYearMonth: "2026-04" });

    expect(input.periods).toBe(3);
  });

  it("sparse history (one month) maps to ForecastInput with explicit fallbackStartYearMonth", () => {
    const input = buildForecastInput(oneMonthTotals, { fallbackStartYearMonth: "2026-02" });

    expect(input.history).toEqual(oneMonthTotals);
    expect(input.fallbackStartYearMonth).toBe("2026-02");
  });

  it("fallbackStartYearMonth is always a concrete YYYY-MM string (not undefined)", () => {
    const input = buildForecastInput(emptyTotals, { fallbackStartYearMonth: "2026-04" });

    expect(input.fallbackStartYearMonth).toBeDefined();
    expect(input.fallbackStartYearMonth.length).toBeGreaterThan(0);
  });
});

describe("buildForecastInputFromMonthSeries – AC-1: deterministic adapter output", () => {
  it("extracts monthlyTotals from MonthSeries into history", () => {
    const series = buildMonthSeries(threeMonthTotals);
    const input = buildForecastInputFromMonthSeries(series, { fallbackStartYearMonth: "2026-04" });

    expect(input.history).toEqual(threeMonthTotals);
  });

  it("defaults periods to 3 when not provided", () => {
    const series = buildMonthSeries(threeMonthTotals);
    const input = buildForecastInputFromMonthSeries(series, { fallbackStartYearMonth: "2026-04" });

    expect(input.periods).toBe(3);
  });

  it("passes through explicit periods option", () => {
    const series = buildMonthSeries(threeMonthTotals);
    const input = buildForecastInputFromMonthSeries(series, {
      periods: 5,
      fallbackStartYearMonth: "2026-04",
    });

    expect(input.periods).toBe(5);
  });

  it("output matches buildForecastInput called with same monthlyTotals", () => {
    const series = buildMonthSeries(threeMonthTotals);
    const fromSeries = buildForecastInputFromMonthSeries(series, { fallbackStartYearMonth: "2026-04" });
    const fromBuckets = buildForecastInput(threeMonthTotals, { fallbackStartYearMonth: "2026-04" });

    expect(fromSeries).toEqual(fromBuckets);
  });
});

describe("buildForecastInputFromMonthSeries – AC-2: insufficient-history fallback representation", () => {
  it("resolves fallbackStartYearMonth to current UTC month when options are omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-05T10:00:00Z"));

    const series = buildMonthSeries(emptyTotals);
    const input = buildForecastInputFromMonthSeries(series);
    expect(input.fallbackStartYearMonth).toBe("2027-01");
  });

  it("empty MonthSeries maps to ForecastInput with resolved fallbackStartYearMonth", () => {
    const series = buildMonthSeries(emptyTotals);
    const input = buildForecastInputFromMonthSeries(series, { fallbackStartYearMonth: "2026-04" });

    expect(input.history).toHaveLength(0);
    expect(input.fallbackStartYearMonth).toBe("2026-04");
  });
});
