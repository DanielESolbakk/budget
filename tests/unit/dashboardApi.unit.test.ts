import { describe, expect, it } from "vitest";
import {
  buildDashboardData,
  createMonthlyCategoryTarget,
  createMonthlyCategoryTargetStore,
  queryTargetVsActualCategoryRows,
  readMonthlyCategoryTarget,
  reloadMonthlyCategoryTargets,
  updateMonthlyCategoryTarget,
} from "../../src/app/dashboardApi.js";
import type { MonthlyTotal, Transaction } from "../../src/domain/types.js";

function makeTx(
  overrides: Partial<Transaction> & {
    id: string;
    bookedAtIso: string;
    amountMinor: number;
  }
): Transaction {
  const { id, bookedAtIso, amountMinor, ...rest } = overrides;
  return {
    id,
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso,
    amountMinor,
    merchantRaw: "merchant",
    ...rest,
  };
}

describe("dashboardApi target store operations", () => {
  it("validates initial targets when creating a store", () => {
    expect(() =>
      createMonthlyCategoryTargetStore([
        { yearMonth: "2026-13", categoryId: "food", targetMinor: 1000 },
      ])
    ).toThrowError(/Invalid target yearMonth/);
  });

  it("creates and reads targets with defensive cloning", () => {
    const store = createMonthlyCategoryTargetStore();

    const created = createMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "food",
      targetMinor: 10_000,
    });

    created.targetMinor = 1;

    const readBack = readMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "food",
    });

    expect(readBack).toEqual({
      yearMonth: "2026-05",
      categoryId: "food",
      targetMinor: 10_000,
    });
  });

  it("rejects duplicate target creation", () => {
    const store = createMonthlyCategoryTargetStore();
    createMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "food",
      targetMinor: 5_000,
    });

    expect(() =>
      createMonthlyCategoryTarget(store, {
        yearMonth: "2026-05",
        categoryId: "food",
        targetMinor: 6_000,
      })
    ).toThrowError(/already exists/);
  });

  it("rejects update when target is missing", () => {
    const store = createMonthlyCategoryTargetStore();

    expect(() =>
      updateMonthlyCategoryTarget(store, {
        yearMonth: "2026-05",
        categoryId: "food",
        targetMinor: 7_000,
      })
    ).toThrowError(/is missing/);
  });

  it("updates existing target and preserves validated value", () => {
    const store = createMonthlyCategoryTargetStore();
    createMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "food",
      targetMinor: 5_000,
    });

    const updated = updateMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "food",
      targetMinor: 9_000,
    });

    expect(updated).toEqual({
      yearMonth: "2026-05",
      categoryId: "food",
      targetMinor: 9_000,
    });
  });

  it("reloads month targets sorted by categoryId and rejects invalid month", () => {
    const store = createMonthlyCategoryTargetStore();
    createMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "transport",
      targetMinor: 3_000,
    });
    createMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "food",
      targetMinor: 7_000,
    });

    const reloaded = reloadMonthlyCategoryTargets(store, "2026-05");
    expect(reloaded.map((row) => row.categoryId)).toEqual(["food", "transport"]);

    expect(() => reloadMonthlyCategoryTargets(store, "2026-5")).toThrowError(
      /Invalid target reload yearMonth/
    );
  });
});

describe("dashboardApi target-vs-actual query", () => {
  const transactions: Transaction[] = [
    makeTx({
      id: "1",
      bookedAtIso: "2026-05-01T00:00:00Z",
      amountMinor: -2_000,
      categoryId: "food",
    }),
    makeTx({
      id: "2",
      bookedAtIso: "2026-05-02T00:00:00Z",
      amountMinor: -1_000,
    }),
    makeTx({
      id: "3",
      bookedAtIso: "2026-05-03T00:00:00Z",
      amountMinor: 500,
      categoryId: "salary",
    }),
  ];

  it("builds deterministic target-vs-actual rows with uncategorized last", () => {
    const store = createMonthlyCategoryTargetStore([
      { yearMonth: "2026-05", categoryId: "food", targetMinor: 3_000 },
      { yearMonth: "2026-05", categoryId: "transport", targetMinor: 1_500 },
    ]);

    const rows = queryTargetVsActualCategoryRows(transactions, store, "2026-05");

    expect(rows.yearMonth).toBe("2026-05");
    expect(rows.rows).toEqual([
      { categoryId: "food", targetMinor: 3_000, actualMinor: 2_000, deltaMinor: -1_000 },
      { categoryId: "salary", targetMinor: null, actualMinor: 500, deltaMinor: null },
      { categoryId: "transport", targetMinor: 1_500, actualMinor: 0, deltaMinor: -1_500 },
      { categoryId: null, targetMinor: null, actualMinor: 1_000, deltaMinor: null },
    ]);
  });

  it("rejects invalid selected yearMonth", () => {
    const store = createMonthlyCategoryTargetStore();

    expect(() => queryTargetVsActualCategoryRows(transactions, store, "2026/05")).toThrowError(
      /Invalid target-vs-actual yearMonth/
    );
  });
});

describe("dashboardApi buildDashboardData", () => {
  it("passes through totals and uses fallback forecast when history is empty", () => {
    const monthlyTotals: MonthlyTotal[] = [];

    const result = buildDashboardData({
      monthlyTotals,
      forecastPeriods: 2,
      fallbackStartYearMonth: "2026-11",
    });

    expect(result.monthlyTotals).toEqual([]);
    expect(result.forecast.usedFallback).toBe(true);
    expect(result.forecast.entries).toEqual([
      { yearMonth: "2026-11", projectedMinor: 0, method: "fallback-zero" },
      { yearMonth: "2026-12", projectedMinor: 0, method: "fallback-zero" },
    ]);
  });
});
