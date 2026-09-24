import { describe, expect, it } from "vitest";
import { filterPreviouslyImportedTransactions } from "../../src/domain/import/filterPreviouslyImportedTransactions.js";
import type { Transaction } from "../../src/domain/types.js";

const candidate: Transaction = {
  id: "candidate-1",
  householdId: "household",
  accountId: "account",
  bookedAtIso: "2026-05-23T00:00:00Z",
  amountMinor: -1250,
  merchantRaw: "KIWI",
};

describe("filterPreviouslyImportedTransactions", () => {
  it("keeps only the missing occurrence when a legacy import was incomplete", () => {
    const second = { ...candidate, id: "candidate-2" };
    expect(filterPreviouslyImportedTransactions([candidate, second], [
      { ...candidate, id: "old-import-1" },
    ])).toEqual([second]);
  });

  it("skips exact repeats without discarding a distinct amount", () => {
    expect(filterPreviouslyImportedTransactions([
      candidate,
      { ...candidate, id: "other", amountMinor: -2500 },
    ], [{ ...candidate, id: "old-import-1" }])).toEqual([
      { ...candidate, id: "other", amountMinor: -2500 },
    ]);
  });
});