import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
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

describe("review queue correction integration", () => {
  it("rejects an unknown category without changing the transaction or correction history", () => {
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

    try {
      expect(() => database.updateTransactionCategoryAndRule(
        transaction.id,
        { merchantAlias: "KIWI", categoryId: "not-a-category" }
      )).toThrow(/category/i);
      expect(database.loadLedgerSnapshotData().transactions[0]).toMatchObject({
        categoryId: "groceries",
        categorization: originalCategorization,
      });
      expect(database.listMerchantCategoryRules()).toEqual([]);
      expect(database.listMerchantCorrectionProvenance()).toEqual([]);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});