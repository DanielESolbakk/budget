import type { Transaction } from "../types.js";
import { buildTransactionFingerprint } from "./buildTransactionFingerprint.js";

export type DuplicateMatchBasis = "source-reference" | "transaction-fingerprint";

export interface DuplicateTransactionMatch {
  matchingTransaction: Transaction;
  matchBasis: DuplicateMatchBasis;
}

export interface ClassifiedDuplicateCandidate {
  candidate: Transaction;
  duplicateMatch?: DuplicateTransactionMatch;
}

export interface DuplicateImportDecision {
  rowIndex: number;
  action: "skip" | "import";
}

function reconciliationKey(transaction: Transaction): string {
  const fingerprint = buildTransactionFingerprint(transaction);
  return `${fingerprint}|reference:${transaction.sourceReference?.trim() ?? ""}`;
}

export function classifyDuplicateCandidates(
  candidates: readonly Transaction[],
  existingTransactions: readonly Transaction[]
): ClassifiedDuplicateCandidate[] {
  const existingByKey = new Map<string, Transaction[]>();
  for (const transaction of existingTransactions) {
    const key = reconciliationKey(transaction);
    const matches = existingByKey.get(key) ?? [];
    matches.push(transaction);
    existingByKey.set(key, matches);
  }

  return candidates.map((candidate) => {
    const matches = existingByKey.get(reconciliationKey(candidate));
    const matchingTransaction = matches?.shift();
    if (matchingTransaction === undefined) return { candidate };

    return {
      candidate,
      duplicateMatch: {
        matchingTransaction,
        matchBasis: candidate.sourceReference?.trim() ? "source-reference" : "transaction-fingerprint",
      },
    };
  });
}

export function filterPreviouslyImportedTransactions(
  candidates: readonly Transaction[],
  previouslyImported: readonly Transaction[]
): Transaction[] {
  const remainingByFingerprint = new Map<string, number>();
  for (const transaction of previouslyImported) {
    const key = reconciliationKey(transaction);
    remainingByFingerprint.set(key, (remainingByFingerprint.get(key) ?? 0) + 1);
  }

  return candidates.filter((candidate) => {
    const key = reconciliationKey(candidate);
    const remaining = remainingByFingerprint.get(key) ?? 0;
    if (remaining === 0) return true;
    remainingByFingerprint.set(key, remaining - 1);
    return false;
  });
}