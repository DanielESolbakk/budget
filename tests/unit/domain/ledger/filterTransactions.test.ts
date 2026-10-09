import { describe, expect, it, vi } from "vitest";
import { filterTransactions, queryTransactions } from "../../../../src/domain/ledger/filterTransactions.js";
import type { Transaction } from "../../../../src/domain/types.js";

const ledgerFilterHelpers = await import("../../../../src/domain/ledger/filterTransactions.js") as unknown as {
  parseNokAmountToMinor?: (value: string) => number | null;
};

const transactions: Transaction[] = [
  {
    id: "salary",
    householdId: "household",
    accountId: "account",
    bookedAtIso: "2026-05-02T00:00:00Z",
    amountMinor: 54000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
  {
    id: "groceries",
    householdId: "household",
    accountId: "account",
    bookedAtIso: "2026-05-03T00:00:00Z",
    amountMinor: -7200,
    merchantRaw: "Kiwi",
    categoryId: "groceries",
  },
];

describe("filterTransactions", () => {
  it("applies merchant, date, amount, account, and category filters", () => {
    expect(filterTransactions(transactions, {
      accountId: "account",
      bookedFromIso: "2026-05-01T00:00:00Z",
      bookedToIso: "2026-05-31T23:59:59Z",
      merchant: "kiwi",
      amountMinor: -7200,
      categoryId: "groceries",
    })).toEqual([transactions[1]]);
  });

  it("sorts results newest first with stable id tie-breaking", () => {
    expect(filterTransactions(transactions, {}).map((transaction) => transaction.id)).toEqual([
      "groceries",
      "salary",
    ]);
  });

  it("normalizes date-only bookings before stable date sorting", () => {
    const dateOnly = { ...transactions[0]!, id: "a", bookedAtIso: "2026-05-23" };
    const midnight = { ...transactions[0]!, id: "b", bookedAtIso: "2026-05-23T00:00:00Z" };

    expect(filterTransactions([midnight, dateOnly], {}).map((transaction) => transaction.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("includes a date-only manual transaction on the From date", () => {
    const manual: Transaction = {
      ...transactions[0]!,
      id: "manual",
      bookedAtIso: "2026-05-23",
    };
    expect(filterTransactions([manual], {
      bookedFromIso: "2026-05-23T00:00:00Z",
      bookedToIso: "2026-05-23T23:59:59Z",
    })).toEqual([manual]);
  });

  it("includes timestamped transactions throughout a date-only To date", () => {
    const afternoon: Transaction = {
      ...transactions[0]!,
      id: "afternoon",
      bookedAtIso: "2026-05-23T14:30:00Z",
    };
    expect(filterTransactions([afternoon], { bookedToIso: "2026-05-23" })).toEqual([afternoon]);
  });

  it("returns a sorted bounded page and the total number of filtered transactions", () => {
    expect(queryTransactions(transactions, {
      sortBy: "amountMinor",
      sortDirection: "asc",
      page: 1,
      pageSize: 1,
    })).toEqual({
      transactions: [transactions[1]],
      totalCount: 2,
      page: 1,
      pageSize: 1,
    });
  });

  it("returns an empty page beyond the filtered result set", () => {
    expect(queryTransactions(transactions, { page: 3, pageSize: 1 })).toEqual({
      transactions: [],
      totalCount: 2,
      page: 3,
      pageSize: 1,
    });
  });

  it("returns a bounded page for a 10,001-transaction synthetic ledger", () => {
    const largeLedger: Transaction[] = Array.from({ length: 10_001 }, (_, index) => ({
      ...transactions[0]!,
      id: `synthetic-${index}`,
      merchantRaw: `Merchant ${index % 100}`,
    }));

    const result = queryTransactions(largeLedger, { page: 2, pageSize: 50 });

    expect(result).toMatchObject({ totalCount: 10_001, page: 2, pageSize: 50 });
    expect(result.transactions).toHaveLength(50);
  });

  it("combines uncategorized, expense, and inclusive amount range filters", () => {
    const uncategorized = { ...transactions[0]! };
    delete uncategorized.categoryId;
    const candidates: Transaction[] = [
      { ...uncategorized, id: "uncategorized-boundary", amountMinor: -1_000_000 },
      { ...uncategorized, id: "uncategorized-outside-range", amountMinor: -999_999 },
      { ...transactions[0]!, id: "categorized-boundary", amountMinor: -1_000_000, categoryId: "groceries" },
      { ...uncategorized, id: "income-boundary", amountMinor: 1_000_000 },
    ];

    const result = queryTransactions(candidates, {
      uncategorizedOnly: true,
      transactionType: "expenses",
      amountFromMinor: -1_000_000,
      amountToMinor: -1_000_000,
    } as never);

    expect(result.transactions.map((transaction) => transaction.id)).toEqual([
      "uncategorized-boundary",
    ]);
  });

  it("resolves the This month quick filter when applied", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 12));
    try {
      const monthTransactions: Transaction[] = [
        { ...transactions[0]!, id: "april", bookedAtIso: "2026-04-30T23:59:59Z" },
        { ...transactions[0]!, id: "may-start", bookedAtIso: "2026-05-01T00:00:00Z" },
        { ...transactions[0]!, id: "may-end", bookedAtIso: "2026-05-31T23:59:59Z" },
        { ...transactions[0]!, id: "june", bookedAtIso: "2026-06-01T00:00:00Z" },
      ];

      expect(queryTransactions(monthTransactions, { datePreset: "thisMonth" } as never)
        .transactions.map((transaction) => transaction.id)).toEqual(["may-end", "may-start"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("intersects This month with explicit date bounds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    const monthTransactions: Transaction[] = [
      { ...transactions[0]!, id: "september", bookedAtIso: "2026-09-30T23:59:59Z" },
      { ...transactions[0]!, id: "october-start", bookedAtIso: "2026-10-01T00:00:00Z" },
      { ...transactions[0]!, id: "october-end", bookedAtIso: "2026-10-31T23:59:59Z" },
      { ...transactions[0]!, id: "november", bookedAtIso: "2026-11-01T00:00:00Z" },
    ];

    try {
      expect(queryTransactions(monthTransactions, {
        datePreset: "thisMonth",
        bookedFromIso: "2026-09-15",
        bookedToIso: "2026-11-15",
      }).transactions.map((transaction) => transaction.id)).toEqual([
        "october-end",
        "october-start",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("matches large transactions by absolute amount at the documented threshold", () => {
    const largeExpenses: Transaction[] = [
      { ...transactions[0]!, id: "large-expense", amountMinor: -1_000_000 },
      { ...transactions[0]!, id: "large-income", amountMinor: 1_000_000 },
      { ...transactions[0]!, id: "below-threshold", amountMinor: -999_999 },
    ];

    expect(queryTransactions(largeExpenses, { largeTransactionsOnly: true } as never)
      .transactions.map((transaction) => transaction.id)).toEqual(["large-expense", "large-income"]);
  });

  it("converts NOK amounts to minor units exactly and rejects excess precision", () => {
    expect(ledgerFilterHelpers.parseNokAmountToMinor?.("1 234,56")).toBe(123_456);
    expect(ledgerFilterHelpers.parseNokAmountToMinor?.("-0.25")).toBe(-25);
    expect(ledgerFilterHelpers.parseNokAmountToMinor?.("1,005")).toBeNull();
  });
});