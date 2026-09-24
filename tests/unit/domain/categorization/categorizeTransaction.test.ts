import { describe, expect, it } from "vitest";
import { categorizeTransaction } from "../../../../src/domain/categorization/categorizeTransaction.js";
import type { Transaction } from "../../../../src/domain/types.js";

const baseTransaction: Transaction = {
  id: "tx-1",
  householdId: "household-1",
  accountId: "account-1",
  bookedAtIso: "2026-05-23T00:00:00Z",
  amountMinor: -1250,
  merchantRaw: "Rema 1000",
};

describe("categorizeTransaction", () => {
  it("assigns deterministic categories and merchant aliases for known merchants", () => {
    expect(categorizeTransaction(baseTransaction)).toMatchObject({
      categoryId: "groceries",
      merchantAlias: "REMA 1000",
    });
  });

  it("leaves unknown merchants uncategorized for review", () => {
    const result = categorizeTransaction({ ...baseTransaction, merchantRaw: "Unknown household merchant" });

    expect(result.categoryId).toBeUndefined();
    expect(result.merchantAlias).toBe("UNKNOWN HOUSEHOLD MERCHANT");
  });

  it("does not overwrite a user-provided category", () => {
    expect(categorizeTransaction({ ...baseTransaction, categoryId: "transport" })).toMatchObject({
      categoryId: "transport",
    });
  });

  it("uses a persisted merchant rule for future uncategorized transactions", () => {
    expect(categorizeTransaction(
      { ...baseTransaction, merchantRaw: "Merchant 005" },
      new Map([["MERCHANT 005", "transport"]])
    )).toMatchObject({
      categoryId: "transport",
      merchantAlias: "MERCHANT 005",
    });
  });
});