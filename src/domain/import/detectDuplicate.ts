import { buildTransactionFingerprint } from "./buildTransactionFingerprint.js";
import type { Transaction } from "../types.js";

/** Outcome of a duplicate-detection check. */
export type DuplicateCheckResult =
  | { isDuplicate: false; fingerprint: string }
  | { isDuplicate: true; fingerprint: string; matchingTransactionId: string };

/**
 * Checks whether a candidate fingerprint already exists in the provided
 * transaction set.  The result carries the fingerprint and enough context
 * to explain why the candidate was accepted or rejected.
 */
export function detectDuplicate(
  candidate: {
    accountId: string;
    bookedAtIso: string;
    amountMinor: number;
    merchantRaw: string;
  },
  existingTransactions: readonly Transaction[]
): DuplicateCheckResult {
  const fingerprint = buildTransactionFingerprint(candidate);

  for (const tx of existingTransactions) {
    const txFingerprint = buildTransactionFingerprint({
      accountId: tx.accountId,
      bookedAtIso: tx.bookedAtIso,
      amountMinor: tx.amountMinor,
      merchantRaw: tx.merchantRaw,
    });

    if (txFingerprint === fingerprint) {
      return { isDuplicate: true, fingerprint, matchingTransactionId: tx.id };
    }
  }

  return { isDuplicate: false, fingerprint };
}
