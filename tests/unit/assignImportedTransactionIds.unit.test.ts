import { describe, expect, it } from "vitest";
import { assignImportedTransactionIds } from "../../src/domain/import/assignImportedTransactionIds.js";
import type { Transaction } from "../../src/domain/types.js";

const baseTransaction: Transaction = {
  id: "source-id",
  householdId: "household",
  accountId: "account",
  bookedAtIso: "2026-05-23T00:00:00Z",
  amountMinor: -1250,
  merchantRaw: "Same merchant",
};

describe("assignImportedTransactionIds", () => {
  it("assigns distinct deterministic IDs to identical imported rows", () => {
    const input = [baseTransaction, { ...baseTransaction, id: "other-source-id" }];
    const transactions = assignImportedTransactionIds(input);

    expect(new Set(transactions.map((transaction) => transaction.id)).size).toBe(2);
    expect(transactions).toEqual(assignImportedTransactionIds(input));
  });

  it("keeps an occurrence identity stable when another fingerprint group is added", () => {
    const first = assignImportedTransactionIds([baseTransaction], { sourceScope: "statement.csv" });
    const withAnotherGroup = assignImportedTransactionIds([
      { ...baseTransaction, merchantRaw: "Other merchant" },
      baseTransaction,
    ], { sourceScope: "statement.csv" });

    expect(withAnotherGroup[1]?.id).toBe(first[0]?.id);
  });

  it("keeps a transaction ID stable for the same source scope", () => {
    const firstSource = assignImportedTransactionIds([baseTransaction], { sourceScope: "statement.csv" });
    const changedSource = assignImportedTransactionIds([baseTransaction], { sourceScope: "statement.csv" });

    expect(changedSource[0]?.id).toBe(firstSource[0]?.id);
  });

  it("keeps distinct source references across separate imports", () => {
    const first = assignImportedTransactionIds([baseTransaction], {
      sourceScope: "statement.csv",
      sourceReferences: ["KID-100"],
    });
    const second = assignImportedTransactionIds([baseTransaction], {
      sourceScope: "statement.csv",
      sourceReferences: ["KID-200"],
    });

    expect(first[0]?.id).not.toBe(second[0]?.id);
    expect(assignImportedTransactionIds([baseTransaction], {
      sourceScope: "statement.csv",
      sourceReferences: ["KID-100"],
    })[0]?.id).toBe(first[0]?.id);

    const reusedReference = assignImportedTransactionIds([baseTransaction], {
      sourceScope: "statement.csv",
      sourceReferences: ["KID-100"],
    });
    expect(reusedReference[0]?.id).toBe(first[0]?.id);
  });

  it("keeps distinct no-reference rows from different sources", () => {
    const first = assignImportedTransactionIds([baseTransaction], { sourceScope: "statement-a.csv" });
    const second = assignImportedTransactionIds([baseTransaction], { sourceScope: "statement-b.csv" });
    expect(first[0]?.id).not.toBe(second[0]?.id);
    expect(assignImportedTransactionIds([baseTransaction], { sourceScope: "statement-a.csv" })).toEqual(first);
  });
});