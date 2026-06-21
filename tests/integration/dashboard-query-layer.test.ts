import { describe, expect, it } from "vitest";
import {
  UNCATEGORIZED_LABEL,
  queryCategoryBreakdown,
  queryMonthlyTotals,
} from "../../src/app/dashboardApi.js";
import type { Transaction } from "../../src/domain/types.js";

// ---------------------------------------------------------------------------
// Shared synthetic fixtures
// ---------------------------------------------------------------------------

function makeTx(
  overrides: Partial<Transaction> & { amountMinor: number; bookedAtIso: string }
): Transaction {
  return {
    id: crypto.randomUUID(),
    householdId: "hh-1",
    accountId: "acc-1",
    merchantRaw: "Test Merchant",
    ...overrides,
  };
}

const mayTransactions: Transaction[] = [
  makeTx({ id: "t1", bookedAtIso: "2026-05-01T10:00:00Z", amountMinor: 30000, categoryId: "groceries" }),
  makeTx({ id: "t2", bookedAtIso: "2026-05-03T12:00:00Z", amountMinor: -15000, categoryId: "transport" }),
  makeTx({ id: "t3", bookedAtIso: "2026-05-10T09:00:00Z", amountMinor: -5000, categoryId: "groceries" }),
  makeTx({ id: "t4", bookedAtIso: "2026-05-15T14:00:00Z", amountMinor: 50000 }),
  makeTx({ id: "t5", bookedAtIso: "2026-05-20T08:00:00Z", amountMinor: -8000 }),
];

const juneTransactions: Transaction[] = [
  makeTx({ id: "t6", bookedAtIso: "2026-06-01T10:00:00Z", amountMinor: 40000, categoryId: "salary" }),
  makeTx({ id: "t7", bookedAtIso: "2026-06-05T11:00:00Z", amountMinor: -12000, categoryId: "transport" }),
];

const allTransactions = [...mayTransactions, ...juneTransactions];

// ---------------------------------------------------------------------------
// AC-1: Monthly totals query – income, expense, and net
// ---------------------------------------------------------------------------

describe("queryMonthlyTotals – AC-1 deterministic monthly totals", () => {
  it("returns the correct income total for the selected month", () => {
    const result = queryMonthlyTotals(allTransactions, "2026-05");
    // t1: +30000, t4: +50000 → income = 80000
    expect(result.incomeMinor).toBe(80000);
  });

  it("returns the correct expense total for the selected month", () => {
    const result = queryMonthlyTotals(allTransactions, "2026-05");
    // t2: 15000, t3: 5000, t5: 8000 → expense = 28000
    expect(result.expenseMinor).toBe(28000);
  });

  it("returns the correct net total for the selected month", () => {
    const result = queryMonthlyTotals(allTransactions, "2026-05");
    expect(result.netMinor).toBe(80000 - 28000);
  });

  it("returns the correct yearMonth in the result", () => {
    const result = queryMonthlyTotals(allTransactions, "2026-05");
    expect(result.yearMonth).toBe("2026-05");
  });

  it("excludes transactions from other months", () => {
    const result = queryMonthlyTotals(allTransactions, "2026-05");
    // June has income 40000 which must not appear
    expect(result.incomeMinor).not.toBe(120000);
  });

  it("returns zero totals for a month with no transactions", () => {
    const result = queryMonthlyTotals(allTransactions, "2026-03");
    expect(result.incomeMinor).toBe(0);
    expect(result.expenseMinor).toBe(0);
    expect(result.netMinor).toBe(0);
  });

  it("produces the same result on repeated calls (determinism)", () => {
    const first = queryMonthlyTotals(allTransactions, "2026-05");
    const second = queryMonthlyTotals(allTransactions, "2026-05");
    expect(first).toEqual(second);
  });

  it("correctly handles a month with only income transactions", () => {
    const txs: Transaction[] = [
      makeTx({ id: "i1", bookedAtIso: "2026-04-10T00:00:00Z", amountMinor: 20000 }),
      makeTx({ id: "i2", bookedAtIso: "2026-04-20T00:00:00Z", amountMinor: 10000 }),
    ];
    const result = queryMonthlyTotals(txs, "2026-04");
    expect(result.incomeMinor).toBe(30000);
    expect(result.expenseMinor).toBe(0);
    expect(result.netMinor).toBe(30000);
  });

  it("correctly handles a month with only expense transactions", () => {
    const txs: Transaction[] = [
      makeTx({ id: "e1", bookedAtIso: "2026-04-10T00:00:00Z", amountMinor: -7000 }),
      makeTx({ id: "e2", bookedAtIso: "2026-04-20T00:00:00Z", amountMinor: -3000 }),
    ];
    const result = queryMonthlyTotals(txs, "2026-04");
    expect(result.incomeMinor).toBe(0);
    expect(result.expenseMinor).toBe(10000);
    expect(result.netMinor).toBe(-10000);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Category breakdown query – ordering and uncategorized handling
// ---------------------------------------------------------------------------

describe("queryCategoryBreakdown – AC-2 deterministic category ordering", () => {
  it("returns the correct yearMonth in the result", () => {
    const result = queryCategoryBreakdown(allTransactions, "2026-05");
    expect(result.yearMonth).toBe("2026-05");
  });

  it("groups transactions by categoryId", () => {
    const result = queryCategoryBreakdown(allTransactions, "2026-05");
    const groceries = result.entries.find(e => e.categoryId === "groceries");
    expect(groceries).toBeDefined();
    // t1: abs(30000) + t3: abs(5000) = 35000
    expect(groceries?.totalMinor).toBe(35000);
    expect(groceries?.transactionCount).toBe(2);
  });

  it("places the uncategorized entry last", () => {
    const result = queryCategoryBreakdown(allTransactions, "2026-05");
    const last = result.entries[result.entries.length - 1];
    expect(last?.categoryId).toBeNull();
    expect(last?.label).toBe(UNCATEGORIZED_LABEL);
  });

  it("assigns the UNCATEGORIZED_LABEL to the uncategorized entry", () => {
    const result = queryCategoryBreakdown(allTransactions, "2026-05");
    const uncategorized = result.entries.find(e => e.categoryId === null);
    expect(uncategorized?.label).toBe("Uncategorized");
  });

  it("sums uncategorized transactions correctly", () => {
    const result = queryCategoryBreakdown(allTransactions, "2026-05");
    const uncategorized = result.entries.find(e => e.categoryId === null);
    // t4: abs(50000), t5: abs(8000) = 58000
    expect(uncategorized?.totalMinor).toBe(58000);
    expect(uncategorized?.transactionCount).toBe(2);
  });

  it("orders categorized entries by totalMinor descending", () => {
    const result = queryCategoryBreakdown(allTransactions, "2026-05");
    const categorized = result.entries.filter(e => e.categoryId !== null);
    for (let i = 0; i < categorized.length - 1; i++) {
      expect(categorized[i]!.totalMinor).toBeGreaterThanOrEqual(categorized[i + 1]!.totalMinor);
    }
  });

  it("breaks ties in totalMinor by categoryId ascending", () => {
    const txs: Transaction[] = [
      makeTx({ id: "x1", bookedAtIso: "2026-05-01T00:00:00Z", amountMinor: -10000, categoryId: "transport" }),
      makeTx({ id: "x2", bookedAtIso: "2026-05-02T00:00:00Z", amountMinor: -10000, categoryId: "groceries" }),
    ];
    const result = queryCategoryBreakdown(txs, "2026-05");
    const categorized = result.entries.filter(e => e.categoryId !== null);
    expect(categorized[0]?.categoryId).toBe("groceries");
    expect(categorized[1]?.categoryId).toBe("transport");
  });

  it("excludes transactions from other months", () => {
    const result = queryCategoryBreakdown(allTransactions, "2026-05");
    const salary = result.entries.find(e => e.categoryId === "salary");
    expect(salary).toBeUndefined();
  });

  it("returns an empty entries array when the month has no transactions", () => {
    const result = queryCategoryBreakdown(allTransactions, "2026-03");
    expect(result.entries).toHaveLength(0);
  });

  it("produces the same result on repeated calls (determinism)", () => {
    const first = queryCategoryBreakdown(allTransactions, "2026-05");
    const second = queryCategoryBreakdown(allTransactions, "2026-05");
    expect(first).toEqual(second);
  });

  it("handles a month where all transactions are uncategorized", () => {
    const txs: Transaction[] = [
      makeTx({ id: "u1", bookedAtIso: "2026-04-01T00:00:00Z", amountMinor: -5000 }),
      makeTx({ id: "u2", bookedAtIso: "2026-04-15T00:00:00Z", amountMinor: -3000 }),
    ];
    const result = queryCategoryBreakdown(txs, "2026-04");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.categoryId).toBeNull();
    expect(result.entries[0]?.label).toBe(UNCATEGORIZED_LABEL);
    expect(result.entries[0]?.totalMinor).toBe(8000);
  });

  it("handles a month where all transactions are categorized", () => {
    const txs: Transaction[] = [
      makeTx({ id: "c1", bookedAtIso: "2026-04-01T00:00:00Z", amountMinor: -5000, categoryId: "groceries" }),
    ];
    const result = queryCategoryBreakdown(txs, "2026-04");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.categoryId).toBe("groceries");
    const hasNull = result.entries.some(e => e.categoryId === null);
    expect(hasNull).toBe(false);
  });
});
