import { describe, expect, it } from "vitest";
import { computeMonthlyTotals } from "../../src/domain/aggregation/computeMonthlyTotals.js";
import {
  UNCATEGORIZED_LABEL,
  computeCategoryBreakdown,
} from "../../src/domain/aggregation/computeCategoryBreakdown.js";
import type { Transaction } from "../../src/domain/types.js";

function tx(input: Partial<Transaction> & { id: string; bookedAtIso: string; amountMinor: number }): Transaction {
  return {
    id: input.id,
    householdId: input.householdId ?? "hh-1",
    accountId: input.accountId ?? "acc-1",
    bookedAtIso: input.bookedAtIso,
    amountMinor: input.amountMinor,
    merchantRaw: input.merchantRaw ?? "Merchant",
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
  };
}

describe("computeMonthlyTotals", () => {
  it("includes only matching month transactions and computes deterministic totals", () => {
    const transactions: Transaction[] = [
      tx({ id: "1", bookedAtIso: "2026-05-01T00:00:00Z", amountMinor: 20_000 }),
      tx({ id: "2", bookedAtIso: "2026-05-02T00:00:00Z", amountMinor: -5_500 }),
      tx({ id: "3", bookedAtIso: "2026-06-02T00:00:00Z", amountMinor: -1_000 }),
    ];

    const totals = computeMonthlyTotals(transactions, "2026-05");
    expect(totals).toEqual({
      yearMonth: "2026-05",
      incomeMinor: 20_000,
      expenseMinor: 5_500,
      netMinor: 14_500,
    });
  });

  it("treats zero-value transactions as income-side non-negative values", () => {
    const totals = computeMonthlyTotals([
      tx({ id: "1", bookedAtIso: "2026-05-10T00:00:00Z", amountMinor: 0 }),
    ], "2026-05");

    expect(totals.incomeMinor).toBe(0);
    expect(totals.expenseMinor).toBe(0);
    expect(totals.netMinor).toBe(0);
  });
});

describe("computeCategoryBreakdown", () => {
  it("groups absolute totals by category and sorts categorized entries by total desc", () => {
    const transactions: Transaction[] = [
      tx({ id: "1", bookedAtIso: "2026-05-01T00:00:00Z", amountMinor: -3_000, categoryId: "food" }),
      tx({ id: "2", bookedAtIso: "2026-05-02T00:00:00Z", amountMinor: -2_000, categoryId: "transport" }),
      tx({ id: "3", bookedAtIso: "2026-05-03T00:00:00Z", amountMinor: -2_500, categoryId: "transport" }),
      tx({ id: "4", bookedAtIso: "2026-06-01T00:00:00Z", amountMinor: -9_000, categoryId: "food" }),
    ];

    const breakdown = computeCategoryBreakdown(transactions, "2026-05");

    expect(breakdown.yearMonth).toBe("2026-05");
    expect(breakdown.entries).toEqual([
      { categoryId: "transport", label: "transport", totalMinor: 4_500, transactionCount: 2 },
      { categoryId: "food", label: "food", totalMinor: 3_000, transactionCount: 1 },
    ]);
  });

  it("places uncategorized entry last and uses explicit uncategorized label", () => {
    const transactions: Transaction[] = [
      tx({ id: "1", bookedAtIso: "2026-05-01T00:00:00Z", amountMinor: -3_000, categoryId: "food" }),
      tx({ id: "2", bookedAtIso: "2026-05-02T00:00:00Z", amountMinor: -1_000 }),
      tx({ id: "3", bookedAtIso: "2026-05-03T00:00:00Z", amountMinor: -2_000 }),
    ];

    const breakdown = computeCategoryBreakdown(transactions, "2026-05");
    const lastEntry = breakdown.entries[breakdown.entries.length - 1];

    expect(lastEntry).toEqual({
      categoryId: null,
      label: UNCATEGORIZED_LABEL,
      totalMinor: 3_000,
      transactionCount: 2,
    });
  });

  it("uses categoryId ascending tie-breaker when totals are equal", () => {
    const transactions: Transaction[] = [
      tx({ id: "1", bookedAtIso: "2026-05-01T00:00:00Z", amountMinor: -1_000, categoryId: "b" }),
      tx({ id: "2", bookedAtIso: "2026-05-02T00:00:00Z", amountMinor: -1_000, categoryId: "a" }),
    ];

    const breakdown = computeCategoryBreakdown(transactions, "2026-05");
    expect(breakdown.entries.map((entry) => entry.categoryId)).toEqual(["a", "b"]);
  });
});
