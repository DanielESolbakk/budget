import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { applyCategorizationCorrection } from "../../src/app/reviewService.js";
import type { CategorizationDecision, Transaction } from "../../src/domain/types.js";

const household = {
  id: "hh-review-correction",
  name: "Review Correction Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const account = {
  id: "acc-review-correction",
  householdId: household.id,
  name: "Brukskonto",
  currencyCode: "NOK" as const,
};

const originalCategorization: CategorizationDecision = {
  status: "categorized",
  categoryId: "groceries",
  confidence: 0.95,
  confidenceLevel: "high",
  requiresReview: false,
  matchingRules: [],
};

const transaction: Transaction = {
  id: "tx-review-correction",
  householdId: household.id,
  accountId: account.id,
  bookedAtIso: "2026-05-01T00:00:00Z",
  amountMinor: -1200,
  merchantRaw: "KIWI",
  categoryId: "groceries",
  categorization: originalCategorization,
};

function createReviewCorrectionDatabase() {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-review-correction-"));
  const database = createLocalLedgerDatabase({
    dbPath: join(temporaryDirectory, "ledger.sqlite"),
    seedData: {
      household,
      accounts: [account],
      transactions: [transaction],
      importJobs: [],
      monthlyCategoryTargets: [],
      merchantCategoryRules: [],
    },
  });

  return {
    database,
    close: () => {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    },
  };
}

describe("review queue correction integration", () => {
  it("returns the persisted correction and provenance from the app service", () => {
    const { database, close } = createReviewCorrectionDatabase();
    const learnedCategoryRules = new Map<string, string>();

    try {
      const result = applyCategorizationCorrection(
        database,
        learnedCategoryRules,
        transaction.id,
        "transport"
      );

      expect(result.futureMatchingChanged).toBe(true);
      expect(result.transaction).toEqual(
        database.loadLedgerSnapshotData().transactions.find((entry) => entry.id === transaction.id)
      );
      expect(result.transaction).toMatchObject({
        categoryId: "transport",
        categorization: {
          status: "categorized",
          categoryId: "transport",
          confidenceLevel: "high",
          requiresReview: false,
        },
      });
      expect(learnedCategoryRules).toEqual(new Map([["KIWI", "transport"]]));
      expect(database.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "KIWI", categoryId: "transport" },
      ]);
      expect(database.listMerchantCorrectionProvenance()).toMatchObject([
        {
          sourceTransactionId: transaction.id,
          categoryId: "transport",
          actor: "local-user",
          originalCategorization,
          correctedAtIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      ]);
    } finally {
      close();
    }
  });

  it("rejects an unknown category without changing the transaction or correction history", () => {
    const { database, close } = createReviewCorrectionDatabase();
    const learnedCategoryRules = new Map([["KIWI", "groceries"]]);

    try {
      expect(() => applyCategorizationCorrection(
        database,
        learnedCategoryRules,
        transaction.id,
        "not-a-category"
      )).toThrow(/category/i);
      expect(learnedCategoryRules).toEqual(new Map([["KIWI", "groceries"]]));
      expect(database.loadLedgerSnapshotData().transactions[0]).toMatchObject({
        categoryId: "groceries",
        categorization: originalCategorization,
      });
      expect(database.listMerchantCategoryRules()).toEqual([]);
      expect(database.listMerchantCorrectionProvenance()).toEqual([]);
    } finally {
      close();
    }
  });

  it("rejects a missing transaction without changing learned rules or ledger state", () => {
    const { database, close } = createReviewCorrectionDatabase();
    const learnedCategoryRules = new Map([["KIWI", "groceries"]]);

    try {
      expect(() => applyCategorizationCorrection(
        database,
        learnedCategoryRules,
        "missing-transaction",
        "transport"
      )).toThrow("Transaction not found: missing-transaction");
      expect(learnedCategoryRules).toEqual(new Map([["KIWI", "groceries"]]));
      expect(database.loadLedgerSnapshotData().transactions).toEqual([transaction]);
      expect(database.listMerchantCategoryRules()).toEqual([]);
      expect(database.listMerchantCorrectionProvenance()).toEqual([]);
    } finally {
      close();
    }
  });
});