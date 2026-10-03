import { describe, expect, it } from "vitest";
import { orderReviewQueueTransactions } from "../../../../src/domain/categorization/reviewQueue.js";
import type { Transaction } from "../../../../src/domain/types.js";

const baseTransaction: Transaction = {
  id: "transaction",
  householdId: "household-1",
  accountId: "account-1",
  bookedAtIso: "2026-05-30T00:00:00Z",
  amountMinor: -1200,
  merchantRaw: "Unknown merchant",
};

const transactions: Transaction[] = [
  { ...baseTransaction, id: "same-date-z", bookedAtIso: "2026-05-30T08:00:00Z" },
  { ...baseTransaction, id: "newer-day", bookedAtIso: "2026-05-31T00:00:00Z" },
  { ...baseTransaction, id: "older-day", bookedAtIso: "2026-05-29T00:00:00Z" },
  { ...baseTransaction, id: "same-date-a", bookedAtIso: "2026-05-30T23:00:00Z" },
];

describe("orderReviewQueueTransactions", () => {
  it("orders oldest booked date first, breaks same-day ties by ID, and preserves input order", () => {
    expect(orderReviewQueueTransactions(transactions).map((transaction) => transaction.id)).toEqual([
      "older-day",
      "same-date-a",
      "same-date-z",
      "newer-day",
    ]);
    expect(transactions.map((transaction) => transaction.id)).toEqual([
      "same-date-z",
      "newer-day",
      "older-day",
      "same-date-a",
    ]);
  });
});
