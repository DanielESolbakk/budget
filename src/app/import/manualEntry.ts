import { randomUUID } from "node:crypto";
import {
  validateManualEntryInput,
  type ManualEntryInput,
  type ImportJob,
  type Transaction,
} from "../../domain/types.js";
import { detectDuplicate } from "../../domain/import/detectDuplicate.js";

/** Returned when a manual transaction is accepted and persisted. */
export interface ManualEntrySuccess {
  ok: true;
  transaction: Transaction;
  importJobId: string;
}

/** Returned when the submitted transaction is a duplicate of an existing ledger row. */
export interface ManualEntryDuplicate {
  ok: false;
  reason: "duplicate";
  fingerprint: string;
  matchingTransactionId: string;
}

/** Returned when field validation fails. */
export interface ManualEntryValidationFailure {
  ok: false;
  reason: "validation";
  code: string;
  message: string;
}

export type ManualEntryResponse =
  | ManualEntrySuccess
  | ManualEntryDuplicate
  | ManualEntryValidationFailure;

export interface ManualEntryLedger {
  appendImportJob: (job: ImportJob) => void;
  appendTransactions: (transactions: Transaction[]) => void;
}

/**
 * Validates the manual entry input, checks for duplicates, and — when the
 * entry is unique — persists the new transaction and import job via the
 * provided ledger interface.
 */
export function submitManualEntry(
  input: ManualEntryInput,
  existingTransactions: readonly Transaction[],
  ledger: ManualEntryLedger
): ManualEntryResponse {
  try {
    validateManualEntryInput(input);
  } catch (err: unknown) {
    const code =
      err instanceof Error && "code" in err
        ? (err as { code: string }).code
        : "UNKNOWN";
    const message = err instanceof Error ? err.message : "Validation failed.";
    return { ok: false, reason: "validation", code, message };
  }

  const duplicateResult = detectDuplicate(
    {
      accountId: input.accountId,
      bookedAtIso: input.bookedAtIso.trim(),
      amountMinor: input.amountMinor,
      merchantRaw: input.merchantRaw,
    },
    existingTransactions
  );

  if (duplicateResult.isDuplicate) {
    return {
      ok: false,
      reason: "duplicate",
      fingerprint: duplicateResult.fingerprint,
      matchingTransactionId: duplicateResult.matchingTransactionId,
    };
  }

  const now = new Date().toISOString();
  const importJobId = `import-manual-${randomUUID()}`;

  const importJob: ImportJob = {
    id: importJobId,
    householdId: input.householdId,
    sourceType: "manual",
    sourceName: "manual-entry",
    startedAtIso: now,
    finishedAtIso: now,
  };

  const transaction: Transaction = {
    id: `tx-manual-${randomUUID()}`,
    householdId: input.householdId,
    accountId: input.accountId,
    bookedAtIso: input.bookedAtIso.trim(),
    amountMinor: input.amountMinor,
    merchantRaw: input.merchantRaw.trim(),
    importJobId,
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
  };

  ledger.appendImportJob(importJob);
  ledger.appendTransactions([transaction]);

  return { ok: true, transaction, importJobId };
}
