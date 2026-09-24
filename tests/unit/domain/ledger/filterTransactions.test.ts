import { describe, expect, it } from "vitest";
import { filterTransactions } from "../../../../src/domain/ledger/filterTransactions.js";
import type { Transaction } from "../../../../src/domain/types.js";

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
});