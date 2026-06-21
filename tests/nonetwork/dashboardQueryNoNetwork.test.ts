import { afterEach, describe, expect, it } from "vitest";
import { queryCategoryBreakdown, queryMonthlyTotals } from "../../src/app/dashboardApi.js";
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
});
