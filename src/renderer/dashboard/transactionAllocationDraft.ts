import type { TransactionCategoryAllocation } from "../../domain/types.js";
import {
  TransactionAllocationValidationError,
  validateTransactionCategoryAllocations,
} from "../../domain/ledger/transactionAllocations.js";
import { parseSignedAmountMinor } from "../amountInputs.js";

export interface AllocationDraft {
  categoryId: string;
  amountText: string;
}

export interface AllocationEditorError {
  message: string;
  field?: {
    index: number;
    name: "category" | "amount";
  };
}

export function parseAllocationDraft(
  sourceAmountMinor: number,
  draft: readonly AllocationDraft[],
  categoryIds: readonly string[],
): { ok: true; allocations: TransactionCategoryAllocation[] } | { ok: false; error: AllocationEditorError } {
  const allocations: TransactionCategoryAllocation[] = [];
  for (const [index, row] of draft.entries()) {
    if (!categoryIds.includes(row.categoryId)) {
      return { ok: false, error: {
        message: `Choose a category for allocation ${index + 1}.`,
        field: { index, name: "category" },
      } };
    }
    const amountMinor = parseSignedAmountMinor(row.amountText);
    if (amountMinor === null) {
      return { ok: false, error: {
        message: `Allocation ${index + 1} must be a valid amount with at most two decimal places.`,
        field: { index, name: "amount" },
      } };
    }
    allocations.push({ categoryId: row.categoryId, amountMinor });
  }
  try {
    validateTransactionCategoryAllocations({ amountMinor: sourceAmountMinor }, allocations, categoryIds);
    return { ok: true, allocations };
  } catch (failure) {
    if (!(failure instanceof TransactionAllocationValidationError)) throw failure;
    const index = failure.code === "INVALID_ALLOCATION_AMOUNT"
      ? allocations.findIndex((row) => row.amountMinor === 0)
      : failure.code === "INVALID_ALLOCATION_SIGN"
        ? allocations.findIndex((row) => Math.sign(row.amountMinor) !== Math.sign(sourceAmountMinor))
        : -1;
    return { ok: false, error: {
      message: failure.message,
      ...(index < 0 ? {} : { field: { index, name: "amount" } }),
    } };
  }
}
