import { afterEach, describe, expect, it } from "vitest";
import {
  createMonthlyCategoryTarget,
  createMonthlyCategoryTargetStore,
  queryCategoryBreakdown,
  queryMonthlyTotals,
  queryTargetVsActualCategoryRows,
  readMonthlyCategoryTarget,
  reloadMonthlyCategoryTargets,
  updateMonthlyCategoryTarget,
} from "../../src/app/dashboardApi.js";
import type { Transaction } from "../../src/domain/types.js";

const sampleTransactions: Transaction[] = [
  {
    id: "t1",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-05-10T10:00:00Z",
    amountMinor: 40000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
  {
    id: "t2",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-05-15T12:00:00Z",
    amountMinor: -12000,
    merchantRaw: "Rema 1000",
  },
];

describe("dashboard query layer no-network verification", () => {
  const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;

  afterEach(() => {
    (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
  });

  it("queryMonthlyTotals does not invoke fetch", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const result = queryMonthlyTotals(sampleTransactions, "2026-05");
    expect(result.incomeMinor).toBe(40000);
    expect(result.expenseMinor).toBe(12000);
    expect(fetchCalled).toBe(false);
  });

  it("queryCategoryBreakdown does not invoke fetch", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const result = queryCategoryBreakdown(sampleTransactions, "2026-05");
    expect(result.entries.length).toBeGreaterThan(0);
    expect(fetchCalled).toBe(false);
  });

  it("target persistence operations do not invoke fetch", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const store = createMonthlyCategoryTargetStore();
    createMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 10000,
    });
    updateMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 12000,
    });

    const target = readMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
    });
    const reloaded = reloadMonthlyCategoryTargets(store, "2026-05");

    expect(target?.targetMinor).toBe(12000);
    expect(reloaded).toHaveLength(1);
    expect(fetchCalled).toBe(false);
  });

  it("target-vs-actual composition does not invoke fetch", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const store = createMonthlyCategoryTargetStore([
      { yearMonth: "2026-05", categoryId: "salary", targetMinor: 35000 },
      { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 15000 },
    ]);

    const result = queryTargetVsActualCategoryRows(sampleTransactions, store, "2026-05");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(fetchCalled).toBe(false);
  });

  it("guard detects network access if fetch is invoked during target workflows (regression guard)", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    // Verify the spy mechanism itself: any code path that calls fetch will be caught.
    const triggerFetch = (): void => {
      (globalThis as unknown as { fetch: () => unknown }).fetch();
    };

    expect(triggerFetch).toThrow("Network access is not allowed in this test.");
    expect(fetchCalled).toBe(true);
  });
});
