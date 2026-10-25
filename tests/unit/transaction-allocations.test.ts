import { describe, expect, it } from "vitest";
import { computeCategoryBreakdown } from "../../src/domain/aggregation/computeCategoryBreakdown.js";
import { computeMonthlyTotals } from "../../src/domain/aggregation/computeMonthlyTotals.js";
import { validateTransactionCategoryAllocations } from "../../src/domain/ledger/transactionAllocations.js";

describe("transaction category allocations", () => {
  const expense = {
    id: "tx-validation",
    householdId: "hh-test",
    accountId: "acc-test",
    bookedAtIso: "2026-05-12T00:00:00Z",
    amountMinor: -1_000,
    merchantRaw: "Household shop",
  };
  const allowedCategories = ["groceries", "household"];

  it("accepts valid expense allocations whose signed sum equals the source amount", () => {
    expect(
      validateTransactionCategoryAllocations(
        expense,
        [
          { categoryId: "groceries", amountMinor: -700 },
          { categoryId: "household", amountMinor: -300 },
        ],
        allowedCategories
      )
    ).toEqual([
      { categoryId: "groceries", amountMinor: -700 },
      { categoryId: "household", amountMinor: -300 },
    ]);
  });

  it("returns the same canonical allocation result regardless of input order", () => {
    expect(
      validateTransactionCategoryAllocations(
        expense,
        [
          { categoryId: "household", amountMinor: -300 },
          { categoryId: "groceries", amountMinor: -700 },
        ],
        allowedCategories
      )
    ).toEqual([
      { categoryId: "groceries", amountMinor: -700 },
      { categoryId: "household", amountMinor: -300 },
    ]);
  });

  it("rejects allocation sums that differ from the source amount", () => {
    expect(() =>
      validateTransactionCategoryAllocations(
        expense,
        [
          { categoryId: "groceries", amountMinor: -700 },
          { categoryId: "household", amountMinor: -200 },
        ],
        allowedCategories
      )
    ).toThrow();
  });

  it("rejects zero-value and mixed-sign allocation rows", () => {
    expect(() =>
      validateTransactionCategoryAllocations(
        expense,
        [
          { categoryId: "groceries", amountMinor: -1_000 },
          { categoryId: "household", amountMinor: 0 },
        ],
        allowedCategories
      )
    ).toThrow();
    expect(() =>
      validateTransactionCategoryAllocations(
        expense,
        [
          { categoryId: "groceries", amountMinor: -1_100 },
          { categoryId: "household", amountMinor: 100 },
        ],
        allowedCategories
      )
    ).toThrow();
  });

  it("rejects allocation rows that reference an unknown category", () => {
    expect(() =>
      validateTransactionCategoryAllocations(
        expense,
        [
          { categoryId: "unknown", amountMinor: -700 },
          { categoryId: "household", amountMinor: -300 },
        ],
        allowedCategories
      )
    ).toThrow();
  });

  it("accepts valid income allocations without changing their positive sign", () => {
    const income = { ...expense, amountMinor: 25_000 };
    const allocations = [
      { categoryId: "groceries", amountMinor: 20_000 },
      { categoryId: "household", amountMinor: 5_000 },
    ];

    expect(validateTransactionCategoryAllocations(income, allocations, allowedCategories)).toEqual(
      allocations
    );
  });

  it("uses allocation amounts for category totals without duplicating the source transaction", () => {
    const transaction = {
      id: "tx-split-expense",
      householdId: "hh-test",
      accountId: "acc-test",
      bookedAtIso: "2026-05-12T00:00:00Z",
      amountMinor: -1_000,
      merchantRaw: "Household shop",
      categoryId: "uncategorized-source",
      categoryAllocations: [
        { categoryId: "groceries", amountMinor: -700 },
        { categoryId: "household", amountMinor: -300 },
      ],
    };

    const categories = computeCategoryBreakdown([transaction], "2026-05");
    const cashflow = computeMonthlyTotals([transaction], "2026-05");

    expect(categories.entries).toEqual([
      { categoryId: "groceries", label: "groceries", totalMinor: 700, transactionCount: 1 },
      { categoryId: "household", label: "household", totalMinor: 300, transactionCount: 1 },
    ]);
    expect(cashflow.expenseMinor).toBe(1_000);
    expect(cashflow.netMinor).toBe(-1_000);
  });

  it("counts one source transaction once when multiple allocations share a category", () => {
    const transaction = {
      id: "tx-split-same-category",
      householdId: "hh-test",
      accountId: "acc-test",
      bookedAtIso: "2026-05-12T00:00:00Z",
      amountMinor: -1_000,
      merchantRaw: "Household shop",
      categoryAllocations: [
        { categoryId: "groceries", amountMinor: -400 },
        { categoryId: "groceries", amountMinor: -600 },
      ],
    };

    const categories = computeCategoryBreakdown([transaction], "2026-05");

    expect(categories.entries).toEqual([
      { categoryId: "groceries", label: "groceries", totalMinor: 1_000, transactionCount: 1 },
    ]);
  });

  it("uses signed income allocations for categories while retaining the original income once", () => {
    const transaction = {
      id: "tx-split-income",
      householdId: "hh-test",
      accountId: "acc-test",
      bookedAtIso: "2026-05-12T00:00:00Z",
      amountMinor: 25_000,
      merchantRaw: "Household income",
      categoryAllocations: [
        { categoryId: "salary", amountMinor: 20_000 },
        { categoryId: "other-income", amountMinor: 5_000 },
      ],
    };

    const categories = computeCategoryBreakdown([transaction], "2026-05");
    const cashflow = computeMonthlyTotals([transaction], "2026-05");

    expect(categories.entries.map(({ categoryId, totalMinor }) => ({ categoryId, totalMinor }))).toEqual([
      { categoryId: "salary", totalMinor: 20_000 },
      { categoryId: "other-income", totalMinor: 5_000 },
    ]);
    expect(cashflow.incomeMinor).toBe(25_000);
    expect(cashflow.netMinor).toBe(25_000);
  });
});
