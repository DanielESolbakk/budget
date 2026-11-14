import { describe, expect, it } from "vitest";
import { validateRecoveryHistory } from "../../src/app/backup/snapshotHistoryValidation.js";
import type { LedgerRecoveryHistory } from "../../src/domain/backup/snapshotContract.js";

function history(categoryId: string): LedgerRecoveryHistory {
  return {
    merchantCorrections: [], sameMerchantPropagations: [],
    importOperations: [{
      importJobId: "archive", accountId: "account", candidateCount: 1, importedCount: 1, duplicateCount: 0,
      undoAvailable: true, undoRemovedCount: 0, undoRetainedCount: 0,
      transactionBaselines: [{
        transactionId: "transaction",
        serializedTransaction: JSON.stringify({
          id: "transaction", householdId: "household", accountId: "account", bookedAtIso: "2026-05-23",
          amountMinor: -12345, merchantRaw: "Verksted Solglimt", currencyCode: "NOK", sourceType: "csv",
          sourceReference: "synthetic.csv:row-1", categoryId, categoryAllocations: null, importJobId: "archive",
        }),
      }],
    }],
  };
}

function validate(input: unknown) {
  return validateRecoveryHistory(input, "household", new Set(["account"]), new Set(["archive"]),
    ["groceries", "fees"], "synthetic");
}

describe("portable backup history validation", () => {
  it.each(["missing", " groceries "])("rejects an undo baseline with an unregistered direct category: %s", (categoryId) => {
    expect(() => validate(history(categoryId))).toThrow(/recovery history/i);
  });

  it("preserves the original serialized baseline used to verify safe undo", () => {
    const original = history("groceries");
    const validated = validate(original);
    expect(validated).toEqual(original);
    expect(validated.importOperations[0]?.transactionBaselines[0]?.serializedTransaction)
      .toBe(original.importOperations[0]?.transactionBaselines[0]?.serializedTransaction);
  });

  it("rejects an incomplete baseline instead of presenting unknown original values as verified undo", () => {
    const original = history("groceries");
    const baseline = original.importOperations[0]?.transactionBaselines[0];
    if (baseline === undefined) throw new Error("Expected the synthetic undo baseline.");
    const fields: Record<string, unknown> = JSON.parse(baseline.serializedTransaction);
    delete fields.sourceReference;
    baseline.serializedTransaction = JSON.stringify(fields);
    expect(() => validate(original)).toThrow(/recovery history/i);
  });

  it("rejects an invalid historical rule instead of losing its category evidence", () => {
    const original = history("groceries");
    original.merchantCorrections.push({
      id: "correction", sourceTransactionId: "transaction", merchantAlias: "VERKSTED SOLGLIMT",
      categoryId: "fees", actor: "local-user", correctedAtIso: "2026-05-24T00:00:00Z",
      originalCategorization: {
        status: "categorized", confidence: 1, confidenceLevel: "high", requiresReview: false,
        matchingRules: [{ ruleId: "historical-rule", merchantAlias: "VERKSTED SOLGLIMT", categoryId: "missing", priority: 0 }],
      },
    });
    expect(() => validate(original)).toThrow(/recovery history/i);
  });
});
