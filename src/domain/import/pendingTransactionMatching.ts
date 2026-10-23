import type { PendingTransactionObservation, Transaction } from "../types.js";

export type PendingTransactionMatchCandidate = Pick<
  PendingTransactionObservation,
  "id" | "householdId" | "accountId" | "sourceReference" | "reconciledTransactionId"
>;

export interface PendingTransactionReconciliationMatch {
  transactionId: string;
  pendingObservationId: string;
}

function referenceKey(householdId: string, accountId: string, sourceReference: string): string {
  return JSON.stringify([householdId, accountId, sourceReference]);
}

export function matchPendingTransactionObservations(
  bookedTransactions: readonly Transaction[],
  pendingObservations: readonly PendingTransactionMatchCandidate[]
): PendingTransactionReconciliationMatch[] {
  const bookedByReference = new Map<string, Transaction[]>();
  for (const transaction of bookedTransactions) {
    if (transaction.sourceType !== "csv" && transaction.sourceType !== "pdf") continue;
    const sourceReference = transaction.sourceReference?.trim();
    if (!sourceReference) continue;
    const key = referenceKey(transaction.householdId, transaction.accountId, sourceReference);
    const matches = bookedByReference.get(key) ?? [];
    matches.push(transaction);
    bookedByReference.set(key, matches);
  }

  const pendingByReference = new Map<string, PendingTransactionMatchCandidate[]>();
  for (const observation of pendingObservations) {
    if (observation.reconciledTransactionId !== undefined) continue;
    const sourceReference = observation.sourceReference?.trim();
    if (!sourceReference) continue;
    const key = referenceKey(observation.householdId, observation.accountId, sourceReference);
    const matches = pendingByReference.get(key) ?? [];
    matches.push(observation);
    pendingByReference.set(key, matches);
  }

  const reconciliations: PendingTransactionReconciliationMatch[] = [];
  for (const [key, booked] of bookedByReference) {
    const pending = pendingByReference.get(key) ?? [];
    if (booked.length !== 1 || pending.length !== 1) continue;
    reconciliations.push({
      transactionId: booked[0]!.id,
      pendingObservationId: pending[0]!.id,
    });
  }

  return reconciliations;
}
