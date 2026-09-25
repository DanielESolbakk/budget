import type { Transaction } from "../types.js";
import { buildTransactionFingerprint } from "./buildTransactionFingerprint.js";

function reconciliationKey(transaction: Transaction): string {
  const fingerprint = buildTransactionFingerprint(transaction);
  return `${fingerprint}|reference:${transaction.sourceReference?.trim() ?? ""}`;
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