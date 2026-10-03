import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { listUncategorizedReviewQueue } from "../../src/app/reviewQueue.js";
import type { Transaction } from "../../src/domain/types.js";

const household = {
  id: "hh-review-queue",
  name: "Review Queue Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const account = {
  id: "acc-review-queue",
  householdId: household.id,
  name: "Brukskonto",
  currencyCode: "NOK" as const,
};

const transactions: Transaction[] = [
  {
    id: "a-new",
    householdId: household.id,
    accountId: account.id,
    bookedAtIso: "2026-05-31T00:00:00Z",
    amountMinor: -3100,
    merchantRaw: "Newer merchant",
  },
  {
    id: "z-old",
    householdId: household.id,
    accountId: account.id,
    bookedAtIso: "2026-05-29T00:00:00Z",
    amountMinor: -2900,
    merchantRaw: "Older merchant",
  },
  {
    id: "same-date-z",
    householdId: household.id,
    accountId: account.id,
    bookedAtIso: "2026-05-30T08:00:00Z",
    amountMinor: -3000,
    merchantRaw: "Same date Z",
  },
  {
    id: "same-date-a",
    householdId: household.id,
    accountId: account.id,
    bookedAtIso: "2026-05-30T23:00:00Z",
    amountMinor: -3001,
    merchantRaw: "Same date A",
  },
  {
    id: "m-categorized",
    householdId: household.id,
    accountId: account.id,
    bookedAtIso: "2026-05-28T00:00:00Z",
    amountMinor: -2800,
    merchantRaw: "Already categorized",
    categoryId: "transport",
  },
];

describe("listUncategorizedReviewQueue", () => {
  it("filters categorized rows and returns oldest booking date first with ID tie-breaking", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-review-queue-query-"));
    const database = createLocalLedgerDatabase({
      dbPath: join(temporaryDirectory, "ledger.sqlite"),
      seedData: {
        household,
        accounts: [account],
        transactions,
        importJobs: [],
        monthlyCategoryTargets: [],
        merchantCategoryRules: [],
      },
    });

    try {
      expect(database.loadLedgerSnapshotData().transactions.map((transaction) => transaction.id)).toEqual([
        "a-new",
        "m-categorized",
        "same-date-a",
        "same-date-z",
        "z-old",
      ]);
      expect(listUncategorizedReviewQueue(database).map((transaction) => transaction.id)).toEqual([
        "z-old",
        "same-date-a",
        "same-date-z",
        "a-new",
      ]);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
