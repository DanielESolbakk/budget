import { CATEGORY_OPTIONS } from "../../domain/categorization/categoryOptions.js";
import { validateTransactionCategoryAllocations } from "../../domain/ledger/transactionAllocations.js";
import type {
  ImportJob,
  PendingTransactionObservation,
  Transaction,
  TransactionCategoryAllocation,
} from "../../domain/types.js";

export interface TransactionRow {
  id: string;
  household_id: string;
  account_id: string;
  booked_at_iso: string;
  amount_minor: number;
  merchant_raw: string;
  currency_code: string | null;
  source_type: NonNullable<Transaction["sourceType"]> | null;
  source_reference: string | null;
  category_id: string | null;
  import_job_id: string | null;
  category_allocations_json?: string | null;
}

export interface PendingTransactionObservationRow {
  id: string;
  household_id: string;
  account_id: string;
  transaction_date_iso: string;
  amount_minor: number;
  merchant_raw: string;
  source_row_index: number;
  currency_code: string | null;
  source_type: PendingTransactionObservation["sourceType"];
  source_reference: string | null;
  import_job_id: string | null;
  status: PendingTransactionObservation["status"];
  source_status: PendingTransactionObservation["sourceStatus"];
  reconciled_transaction_id: string | null;
  reconciled_at_iso: string | null;
}

export function merchantSearchValue(transaction: Pick<Transaction, "merchantRaw" | "merchantAlias">): string {
  return `${transaction.merchantRaw}\n${transaction.merchantAlias ?? ""}`.toUpperCase();
}

export function mapTransactionRow(transaction: TransactionRow): Transaction {
  const mapped: Transaction = {
    id: transaction.id,
    householdId: transaction.household_id,
    accountId: transaction.account_id,
    bookedAtIso: transaction.booked_at_iso,
    amountMinor: transaction.amount_minor,
    merchantRaw: transaction.merchant_raw,
  };
  if (transaction.currency_code !== null) mapped.currencyCode = transaction.currency_code;
  if (transaction.source_type !== null) mapped.sourceType = transaction.source_type;
  if (transaction.source_reference !== null) mapped.sourceReference = transaction.source_reference;
  if (transaction.category_id !== null) mapped.categoryId = transaction.category_id;
  if (transaction.import_job_id !== null) mapped.importJobId = transaction.import_job_id;
  if (transaction.category_allocations_json != null) {
    const parsed: unknown = JSON.parse(transaction.category_allocations_json);
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid category allocations for transaction ${transaction.id}.`);
    }
    const allocations: TransactionCategoryAllocation[] = parsed.map((value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("categoryId" in value) ||
        typeof value.categoryId !== "string" ||
        !("amountMinor" in value) ||
        typeof value.amountMinor !== "number"
      ) {
        throw new Error(`Invalid category allocations for transaction ${transaction.id}.`);
      }
      return { categoryId: value.categoryId, amountMinor: value.amountMinor };
    });
    validateTransactionCategoryAllocations(
      mapped,
      allocations,
      CATEGORY_OPTIONS.map((category) => category.id)
    );
    mapped.categoryAllocations = allocations;
  }
  return mapped;
}

export function serializeTransactionCategoryAllocations(transaction: Transaction): string | null {
  if (transaction.categoryAllocations === undefined || transaction.categoryAllocations.length === 0) {
    return null;
  }
  const allocations = transaction.categoryAllocations.map((allocation) => ({
    categoryId: allocation.categoryId,
    amountMinor: allocation.amountMinor,
  }));
  validateTransactionCategoryAllocations(
    transaction,
    allocations,
    CATEGORY_OPTIONS.map((category) => category.id)
  );
  return JSON.stringify(allocations);
}

export function mapPendingTransactionObservationRow(
  observation: PendingTransactionObservationRow
): PendingTransactionObservation {
  const mapped: PendingTransactionObservation = {
    id: observation.id,
    householdId: observation.household_id,
    accountId: observation.account_id,
    transactionDateIso: observation.transaction_date_iso,
    amountMinor: observation.amount_minor,
    merchantRaw: observation.merchant_raw,
    sourceRowIndex: observation.source_row_index,
    sourceType: observation.source_type,
    status: observation.status,
    sourceStatus: observation.source_status,
  };
  if (observation.currency_code !== null) mapped.currencyCode = observation.currency_code;
  if (observation.source_reference !== null) mapped.sourceReference = observation.source_reference;
  if (observation.import_job_id !== null) mapped.importJobId = observation.import_job_id;
  if (observation.reconciled_transaction_id !== null) {
    mapped.reconciledTransactionId = observation.reconciled_transaction_id;
  }
  if (observation.reconciled_at_iso !== null) mapped.reconciledAtIso = observation.reconciled_at_iso;
  return mapped;
}

export function parseSourceType(sourceType: string): ImportJob["sourceType"] {
  if (sourceType === "csv" || sourceType === "pdf" || sourceType === "manual") {
    return sourceType;
  }

  throw new Error(`Unsupported source_type value in SQLite import_jobs table: ${sourceType}`);
}
