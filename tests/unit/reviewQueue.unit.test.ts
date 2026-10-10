import { describe, expect, it } from "vitest";
import { listCategorizationReviewQueue } from "../../src/app/reviewQueue.js";
import type { Transaction } from "../../src/domain/types.js";

const HOUSEHOLD = {
  id: "household-1",
  name: "Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const transactions: Transaction[] = [
  {
    id: "high-confidence",
    householdId: HOUSEHOLD.id,
    accountId: "account-1",
    bookedAtIso: "2026-05-01T00:00:00Z",
    amountMinor: -1200,
    merchantRaw: "KIWI",
    categoryId: "groceries",
    categorization: {
      status: "categorized",
      categoryId: "groceries",
      confidence: 0.95,
      confidenceLevel: "high",
      requiresReview: false,
      matchingRules: [],
    },
  },
  {
    id: "uncategorized",
    householdId: HOUSEHOLD.id,
    accountId: "account-1",
    bookedAtIso: "2026-05-02T00:00:00Z",
    amountMinor: -800,
    merchantRaw: "UNKNOWN",
  },
  {
    id: "low-confidence",
    householdId: HOUSEHOLD.id,
    accountId: "account-1",
    bookedAtIso: "2026-05-03T00:00:00Z",
    amountMinor: -500,
    merchantRaw: "UNCERTAIN SHOP",
    categoryId: "groceries",
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
    id: "other-household",
    householdId: "household-2",
    accountId: "account-2",
    bookedAtIso: "2026-05-04T00:00:00Z",
    amountMinor: -500,
    merchantRaw: "UNCERTAIN SHOP",
    categoryId: "groceries",
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

const thresholdTransactions: Transaction[] = [
  {
    id: "below-threshold",
    householdId: HOUSEHOLD.id,
    accountId: "account-1",
    bookedAtIso: "2026-05-05T00:00:00Z",
    amountMinor: -300,
    merchantRaw: "BELOW THRESHOLD",
    categoryId: "groceries",
    categorization: {
      status: "categorized",
      categoryId: "groceries",
      confidence: 0.74,
      confidenceLevel: "low",
      requiresReview: false,
      matchingRules: [],
    },
  },
  {
    id: "at-threshold",
    householdId: HOUSEHOLD.id,
    accountId: "account-1",
    bookedAtIso: "2026-05-06T00:00:00Z",
    amountMinor: -400,
    merchantRaw: "AT THRESHOLD",
    categoryId: "groceries",
    categorization: {
      status: "categorized",
      categoryId: "groceries",
      confidence: 0.75,
      confidenceLevel: "high",
      requiresReview: true,
      matchingRules: [],
    },
  },
  {
    id: "above-threshold",
    householdId: HOUSEHOLD.id,
    accountId: "account-1",
    bookedAtIso: "2026-05-07T00:00:00Z",
    amountMinor: -500,
    merchantRaw: "ABOVE THRESHOLD",
    categoryId: "groceries",
    categorization: {
      status: "categorized",
      categoryId: "groceries",
      confidence: 0.95,
      confidenceLevel: "high",
      requiresReview: true,
      matchingRules: [],
    },
  },
];

const database = {
  listUncategorizedTransactions: () => transactions,
  loadLedgerSnapshotData: () => ({
    household: HOUSEHOLD,
    accounts: [],
    transactions,
    importJobs: [],
    monthlyCategoryTargets: [],
    merchantCategoryRules: [],
  }),
};

describe("review queue service", () => {
  it("selects only this household's uncategorized and low-confidence transactions", () => {
    expect(
      listCategorizationReviewQueue(database, HOUSEHOLD.id).map((transaction) => transaction.id)
    ).toEqual(["uncategorized", "low-confidence"]);
  });

  it("uses the numeric confidence threshold when review flags disagree", () => {
    const thresholdDatabase = {
      ...database,
      loadLedgerSnapshotData: () => ({
        ...database.loadLedgerSnapshotData(),
        transactions: thresholdTransactions,
      }),
    };

    expect(
      listCategorizationReviewQueue(thresholdDatabase, HOUSEHOLD.id).map((transaction) => transaction.id)
    ).toEqual(["below-threshold"]);
  });

  it("returns an empty queue when all categorized scores meet the threshold", () => {
    const thresholdDatabase = {
      ...database,
      loadLedgerSnapshotData: () => ({
        ...database.loadLedgerSnapshotData(),
        transactions: thresholdTransactions.slice(1),
      }),
    };

    expect(listCategorizationReviewQueue(thresholdDatabase, HOUSEHOLD.id)).toEqual([]);
  });
});