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
  {
    ...baseTransaction,
    id: "same-date-z",
    bookedAtIso: "2026-05-29T08:00:00Z",
    categorization: {
      status: "ambiguous",
      categoryId: "groceries",
      confidence: 0.35,
      confidenceLevel: "low",
      requiresReview: true,
      matchingRules: [],
    },
  },
  {
    ...baseTransaction,
    id: "newer-day",
    bookedAtIso: "2026-05-31T00:00:00Z",
    categorization: {
      status: "unmatched",
      confidence: 0.1,
      confidenceLevel: "low",
      requiresReview: true,
      matchingRules: [],
    },
  },
  {
    ...baseTransaction,
    id: "older-day",
    bookedAtIso: "2026-05-30T00:00:00Z",
    categorization: {
      status: "ambiguous",
      categoryId: "groceries",
      confidence: 0.35,
      confidenceLevel: "low",
      requiresReview: true,
      matchingRules: [],
    },
  },
  {
    ...baseTransaction,
    id: "same-date-a",
    bookedAtIso: "2026-05-30T23:00:00Z",
    categorization: {
      status: "ambiguous",
      categoryId: "groceries",
      confidence: 0.35,
      confidenceLevel: "low",
      requiresReview: true,
      matchingRules: [],
    },
  },
];

describe("orderReviewQueueTransactions", () => {
  it("orders lowest confidence first and breaks confidence ties by ID", () => {
    expect(orderReviewQueueTransactions(transactions).map((transaction) => transaction.id)).toEqual([
      "newer-day",
      "older-day",
      "same-date-a",
      "same-date-z",
    ]);
    expect(transactions.map((transaction) => transaction.id)).toEqual([
      "same-date-z",
      "newer-day",
      "older-day",
      "same-date-a",
    ]);
  });
});
