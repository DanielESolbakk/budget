import { describe, expect, it } from "vitest";
import { simpleForecast } from "../../src/domain/forecast/simpleForecast.js";
import type { MonthlyTotal } from "../../src/domain/types.js";

describe("simpleForecast – Scenario 1 (AC-2): baseline 3-month moving average", () => {
  it("computes correct average for exactly three history months", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 50000 },
      { yearMonth: "2026-02", totalMinor: 60000 },
      { yearMonth: "2026-03", totalMinor: 70000 },
    ];

    // average = (50000 + 60000 + 70000) / 3 = 60000
    const result = simpleForecast(history, 3, "2026-04");

    expect(result.usedFallback).toBe(false);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual({ yearMonth: "2026-04", projectedMinor: 60000, method: "moving-average-3m" });
    expect(result.entries[1]).toEqual({ yearMonth: "2026-05", projectedMinor: 60000, method: "moving-average-3m" });
    expect(result.entries[2]).toEqual({ yearMonth: "2026-06", projectedMinor: 60000, method: "moving-average-3m" });
  });

  it("uses only the last 3 months when history has more than 3 entries", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 10000 },
      { yearMonth: "2026-02", totalMinor: 20000 },
      { yearMonth: "2026-03", totalMinor: 30000 },
      { yearMonth: "2026-04", totalMinor: 40000 },
    ];

    // window = last 3: [20000, 30000, 40000] → average = 30000
    const result = simpleForecast(history, 2, "2026-05");

    expect(result.usedFallback).toBe(false);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ yearMonth: "2026-05", projectedMinor: 30000, method: "moving-average-3m" });
    expect(result.entries[1]).toEqual({ yearMonth: "2026-06", projectedMinor: 30000, method: "moving-average-3m" });
  });

  it("output entries are in ascending yearMonth order, each strictly after the last history month", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-03", totalMinor: 12000 },
      { yearMonth: "2026-04", totalMinor: 18000 },
      { yearMonth: "2026-05", totalMinor: 24000 },
    ];

    const result = simpleForecast(history, 3, "2026-06");

    const months = result.entries.map((e) => e.yearMonth);
    expect(months).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
});

describe("simpleForecast – Scenario 2 (AC-1): determinism / repeatability", () => {
  it("identical inputs produce identical output on repeated calls", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 100000 },
      { yearMonth: "2026-02", totalMinor: 200000 },
      { yearMonth: "2026-03", totalMinor: 300000 },
    ];

    const first = simpleForecast(history, 3, "2026-04");
    const second = simpleForecast(history, 3, "2026-04");

    expect(first).toEqual(second);
  });

  it("equivalent input sets in different variable bindings produce identical output", () => {
    const historyA: MonthlyTotal[] = [
      { yearMonth: "2026-04", totalMinor: 5000 },
      { yearMonth: "2026-05", totalMinor: 7000 },
    ];
    const historyB: MonthlyTotal[] = [
      { yearMonth: "2026-04", totalMinor: 5000 },
      { yearMonth: "2026-05", totalMinor: 7000 },
    ];

    expect(simpleForecast(historyA, 3, "2026-06")).toEqual(simpleForecast(historyB, 3, "2026-06"));
  });
});

describe("simpleForecast – Scenario 3 (AC-3): sparse history (1–2 months)", () => {
  it("one history month: uses that single month as the entire window", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 90000 },
    ];

    // window = [90000] → average = 90000
    const result = simpleForecast(history, 3, "2026-02");

    expect(result.usedFallback).toBe(false);
    expect(result.entries).toHaveLength(3);
    result.entries.forEach((e) => {
      expect(e.projectedMinor).toBe(90000);
      expect(e.method).toBe("moving-average-3m");
    });
    expect(result.entries[0]!.yearMonth).toBe("2026-02");
  });

  it("two history months: uses both as the window", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-02", totalMinor: 10000 },
      { yearMonth: "2026-03", totalMinor: 50000 },
    ];

    // average = (10000 + 50000) / 2 = 30000
    const result = simpleForecast(history, 3, "2026-04");

    expect(result.usedFallback).toBe(false);
    expect(result.entries).toHaveLength(3);
    result.entries.forEach((e) => expect(e.projectedMinor).toBe(30000));
    expect(result.entries[0]!.yearMonth).toBe("2026-04");
  });

  it("empty history triggers fallback-zero with explicit start month", () => {
    const result = simpleForecast([], 3, "2026-06");

    expect(result.usedFallback).toBe(true);
    expect(result.entries).toHaveLength(3);
    result.entries.forEach((e) => {
      expect(e.projectedMinor).toBe(0);
      expect(e.method).toBe("fallback-zero");
    });
    expect(result.entries[0]!.yearMonth).toBe("2026-06");
    expect(result.entries[1]!.yearMonth).toBe("2026-07");
    expect(result.entries[2]!.yearMonth).toBe("2026-08");
  });
});

describe("simpleForecast – Scenario 4 (AC-3): zero-value, missing-month gaps, cross-year transitions", () => {
  it("zero-value history months produce zero projected values", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 0 },
      { yearMonth: "2026-02", totalMinor: 0 },
      { yearMonth: "2026-03", totalMinor: 0 },
    ];

    const result = simpleForecast(history, 3, "2026-04");

    expect(result.usedFallback).toBe(false);
    result.entries.forEach((e) => expect(e.projectedMinor).toBe(0));
  });

  it("history with month gap: forecast starts from the month after the last actual", () => {
    // Months 2026-01 and 2026-03 are present; 2026-02 is a gap in the history
    // The caller (aggregation adapter) fills gaps with zero; simpleForecast just
    // uses whatever MonthlyTotal entries it receives.
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 10000 },
      { yearMonth: "2026-02", totalMinor: 0 },
      { yearMonth: "2026-03", totalMinor: 20000 },
    ];

    // average = (10000 + 0 + 20000) / 3 = 10000
    const result = simpleForecast(history, 2, "2026-04");

    expect(result.entries[0]!.yearMonth).toBe("2026-04");
    expect(result.entries[0]!.projectedMinor).toBe(10000);
    expect(result.entries[1]!.yearMonth).toBe("2026-05");
  });

  it("cross-year month transition: December rolls over to January of next year", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-10", totalMinor: 30000 },
      { yearMonth: "2026-11", totalMinor: 30000 },
      { yearMonth: "2026-12", totalMinor: 30000 },
    ];

    const result = simpleForecast(history, 3, "2027-01");

    expect(result.entries[0]!.yearMonth).toBe("2027-01");
    expect(result.entries[1]!.yearMonth).toBe("2027-02");
    expect(result.entries[2]!.yearMonth).toBe("2027-03");
    result.entries.forEach((e) => expect(e.projectedMinor).toBe(30000));
  });

  it("cross-year: single month in December produces January forecast entry", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2025-12", totalMinor: 15000 },
    ];

    const result = simpleForecast(history, 1, "2026-01");

    expect(result.entries[0]!.yearMonth).toBe("2026-01");
    expect(result.entries[0]!.projectedMinor).toBe(15000);
  });
});

describe("simpleForecast – Scenario 5 (AC-4): input immutability", () => {
  it("does not mutate the history array", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 20000 },
      { yearMonth: "2026-02", totalMinor: 40000 },
      { yearMonth: "2026-03", totalMinor: 60000 },
    ];
    const originalLength = history.length;
    const originalEntries = history.map((e) => ({ ...e }));

    simpleForecast(history, 3, "2026-04");

    expect(history).toHaveLength(originalLength);
    expect(history).toEqual(originalEntries);
  });

  it("does not mutate elements inside the history array", () => {
    const entry: MonthlyTotal = { yearMonth: "2026-05", totalMinor: 55000 };
    const history: MonthlyTotal[] = [entry];

    simpleForecast(history, 3, "2026-06");

    expect(entry.yearMonth).toBe("2026-05");
    expect(entry.totalMinor).toBe(55000);
  });
});

describe("simpleForecast – Scenario 6 (AC-4): numeric precision and rounding", () => {
  it("rounds fractional average to nearest integer (Math.round semantics)", () => {
    // (0 + 0 + 1) / 3 = 0.333... → rounds to 0
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 0 },
      { yearMonth: "2026-02", totalMinor: 0 },
      { yearMonth: "2026-03", totalMinor: 1 },
    ];

    const result = simpleForecast(history, 1, "2026-04");

    expect(result.entries[0]!.projectedMinor).toBe(0);
  });

  it("rounds 0.5 up per Math.round (two-month window)", () => {
    // (1 + 2) / 2 = 1.5 → Math.round(1.5) = 2
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 1 },
      { yearMonth: "2026-02", totalMinor: 2 },
    ];

    const result = simpleForecast(history, 1, "2026-03");

    expect(result.entries[0]!.projectedMinor).toBe(2);
  });

  it("projectedMinor is always an integer (no fractional minor units)", () => {
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 100 },
      { yearMonth: "2026-02", totalMinor: 200 },
      { yearMonth: "2026-03", totalMinor: 300 },
    ];

    const result = simpleForecast(history, 3, "2026-04");

    result.entries.forEach((e) => {
      expect(Number.isInteger(e.projectedMinor)).toBe(true);
    });
  });

  it("large minor-unit values are rounded correctly", () => {
    // (1_000_001 + 1_000_002 + 1_000_003) / 3 = 1_000_002 (exact)
    const history: MonthlyTotal[] = [
      { yearMonth: "2026-01", totalMinor: 1_000_001 },
      { yearMonth: "2026-02", totalMinor: 1_000_002 },
      { yearMonth: "2026-03", totalMinor: 1_000_003 },
    ];

    const result = simpleForecast(history, 1, "2026-04");

    expect(result.entries[0]!.projectedMinor).toBe(1_000_002);
  });
});
