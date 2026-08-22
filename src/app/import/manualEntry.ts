import { randomUUID } from "node:crypto";
import {
  validateManualEntryInput,
  type ManualEntryValidationErrorCode,
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
  code: ManualEntryValidationErrorCode;
  message: string;
}

export type ManualEntryResponse =
  | ManualEntrySuccess
  | ManualEntryDuplicate
  | ManualEntryValidationFailure;

export interface ManualEntryLedger {
  getAccountsForHousehold: (householdId: string) => readonly { id: string }[];
  appendManualEntry: (importJob: ImportJob, transaction: Transaction) => void;
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
        ? (err as { code: ManualEntryValidationErrorCode }).code
        : "INVALID_HOUSEHOLD_ID";
    const message = err instanceof Error ? err.message : "Validation failed.";
    return { ok: false, reason: "validation", code, message };
  }

  const householdId = input.householdId.trim();
  const accountId = input.accountId.trim();
  const categoryId = input.categoryId?.trim();
  const accountExists = ledger
    .getAccountsForHousehold(householdId)
    .some((account) => account.id === accountId);

  if (!accountExists) {
    return {
      ok: false,
      reason: "validation",
      code: "INVALID_ACCOUNT_ID",
      message: "accountId must identify an account belonging to the household.",
    };
  }

  const duplicateResult = detectDuplicate(
    {
      accountId,
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
    householdId,
    sourceType: "manual",
    sourceName: "manual-entry",
    startedAtIso: now,
    finishedAtIso: now,
  };

  const transaction: Transaction = {
    id: `tx-manual-${randomUUID()}`,
    householdId,
    accountId,
    bookedAtIso: input.bookedAtIso.trim(),
    amountMinor: input.amountMinor,
    merchantRaw: input.merchantRaw.trim(),
    importJobId,
    ...(categoryId !== undefined ? { categoryId } : {}),
  };

  ledger.appendManualEntry(importJob, transaction);

  return { ok: true, transaction, importJobId };
}