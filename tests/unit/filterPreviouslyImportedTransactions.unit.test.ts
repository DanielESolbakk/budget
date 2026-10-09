import { describe, expect, it } from "vitest";
import * as duplicateFilter from "../../src/domain/import/filterPreviouslyImportedTransactions.js";
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
  it("classifies prior rows one-to-one by reference or fingerprint without merging distinct references", () => {
    const classify = (duplicateFilter as unknown as {
      classifyDuplicateCandidates?: (
        candidates: readonly Transaction[],
        existing: readonly Transaction[]
      ) => Array<{ candidate: Transaction; duplicateMatch?: { matchingTransaction: Transaction; matchBasis: string } }>;
    }).classifyDuplicateCandidates;
    const referencedCandidate = { ...candidate, id: "new-reference", sourceReference: "BANK-100" };
    const fingerprintCandidate = { ...candidate, id: "new-fingerprint" };
    const distinctReferenceCandidate = { ...candidate, id: "distinct-reference", sourceReference: "BANK-200" };
    const existingReference = { ...referencedCandidate, id: "existing-reference" };
    const existingFingerprint = { ...candidate, id: "existing-fingerprint" };

    const classified = classify?.(
      [referencedCandidate, fingerprintCandidate, distinctReferenceCandidate],
      [existingReference, existingFingerprint]
    );

    expect(classified?.map((row) => ({
      candidateId: row.candidate.id,
      matchingTransactionId: row.duplicateMatch?.matchingTransaction.id ?? null,
      matchBasis: row.duplicateMatch?.matchBasis ?? null,
    }))).toEqual([
      { candidateId: "new-reference", matchingTransactionId: "existing-reference", matchBasis: "source-reference" },
      { candidateId: "new-fingerprint", matchingTransactionId: "existing-fingerprint", matchBasis: "transaction-fingerprint" },
      { candidateId: "distinct-reference", matchingTransactionId: null, matchBasis: null },
    ]);
  });

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