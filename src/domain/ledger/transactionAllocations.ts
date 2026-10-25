import type { Transaction, TransactionCategoryAllocation } from "../types.js";

export type TransactionAllocationValidationCode =
  | "INVALID_ALLOCATION_COUNT"
  | "INVALID_ALLOCATION_CATEGORY"
  | "INVALID_ALLOCATION_AMOUNT"
  | "INVALID_ALLOCATION_SIGN"
  | "ALLOCATION_TOTAL_MISMATCH";

export class TransactionAllocationValidationError extends Error {
  readonly code: TransactionAllocationValidationCode;

  constructor(code: TransactionAllocationValidationCode, message: string) {
    super(message);
    this.name = "TransactionAllocationValidationError";
    this.code = code;
  }
}

export function validateTransactionCategoryAllocations(
  transaction: Pick<Transaction, "amountMinor">,
  allocations: readonly TransactionCategoryAllocation[],
  allowedCategoryIds: readonly string[]
): TransactionCategoryAllocation[] {
  if (allocations.length < 2) {
    throw new TransactionAllocationValidationError(
      "INVALID_ALLOCATION_COUNT",
      "A split transaction must have at least two category allocations."
    );
  }

  const allowedCategories = new Set(allowedCategoryIds);
  let allocationTotal = 0;

  for (const allocation of allocations) {
    if (typeof allocation.categoryId !== "string" ||
      allocation.categoryId.trim().length === 0 ||
      !allowedCategories.has(allocation.categoryId)) {
      throw new TransactionAllocationValidationError(
        "INVALID_ALLOCATION_CATEGORY",
        "Every allocation must use a known transaction category."
      );
    }
    if (!Number.isSafeInteger(allocation.amountMinor) || allocation.amountMinor === 0) {
      throw new TransactionAllocationValidationError(
        "INVALID_ALLOCATION_AMOUNT",
        "Every category allocation must be a non-zero safe integer amount."
      );
    }
    if (Math.sign(allocation.amountMinor) !== Math.sign(transaction.amountMinor)) {
      throw new TransactionAllocationValidationError(
        "INVALID_ALLOCATION_SIGN",
        "Category allocations must use the source transaction sign."
      );
    }
    allocationTotal += allocation.amountMinor;
  }

  if (!Number.isSafeInteger(transaction.amountMinor) || allocationTotal !== transaction.amountMinor) {
    throw new TransactionAllocationValidationError(
      "ALLOCATION_TOTAL_MISMATCH",
      "Category allocations must sum exactly to the source transaction amount."
    );
  }

  return allocations.map((allocation) => ({
    categoryId: allocation.categoryId,
    amountMinor: allocation.amountMinor,
  }));
}
