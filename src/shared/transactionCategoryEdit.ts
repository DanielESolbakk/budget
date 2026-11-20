import {
  validateTransactionCategoryAllocations,
} from "../domain/ledger/transactionAllocations.js";
import type {
  MerchantCategoryRule,
  Transaction,
  TransactionCategoryAllocation,
} from "../domain/types.js";

export interface TransactionCategoryEditExpectedState {
  databaseGeneration: number;
  transaction: Transaction;
  merchantCategoryRule: MerchantCategoryRule | null;
}

export interface TransactionCategoryEditContext {
  expectedState: TransactionCategoryEditExpectedState;
  transaction: Transaction;
  merchantAlias: string;
  merchantCategoryRule: MerchantCategoryRule | null;
}

interface TransactionCategoryEditRequestBase {
  transactionId: string;
  expectedState: TransactionCategoryEditExpectedState;
  rememberForMerchant: boolean;
}

export type TransactionCategoryEditInput =
  | (TransactionCategoryEditRequestBase & {
      mode: "single";
      categoryId: string;
    })
  | (TransactionCategoryEditRequestBase & {
      mode: "split";
      allocations: TransactionCategoryAllocation[];
    });

interface TransactionCategoryEditBase {
  transaction: Pick<Transaction, "categoryId" | "categoryAllocations" | "amountMinor">;
  merchantAlias: string;
  merchantCategoryRule: MerchantCategoryRule | null;
  rememberForMerchant: boolean;
}

export type TransactionCategoryEditIntent =
  | (TransactionCategoryEditBase & {
      mode: "single";
      categoryId: string;
      allocations?: never;
    })
  | (TransactionCategoryEditBase & {
      mode: "split";
      allocations: readonly TransactionCategoryAllocation[];
    });

export type MerchantCategoryRuleEffect =
  | "updated"
  | "already-matching"
  | "not-requested"
  | "unavailable";

export interface TransactionCategoryEditDecision {
  mode: TransactionCategoryEditIntent["mode"];
  transactionChanged: boolean;
  merchantRuleEffect: MerchantCategoryRuleEffect;
  shouldWrite: boolean;
  categoryId?: string;
  allocations?: TransactionCategoryAllocation[];
}

export type TransactionCategoryEditFailureCode =
  | "TRANSACTION_NOT_FOUND"
  | "STALE_EDIT"
  | "INVALID_LEARNING_CHOICE"
  | "INVALID_CATEGORY"
  | "INVALID_SPLIT"
  | "INVALID_MERCHANT_RULE";

export type TransactionCategoryEditResult =
  | {
      ok: true;
      transaction: Transaction;
      transactionChanged: boolean;
      merchantRuleEffect: MerchantCategoryRuleEffect;
    }
  | {
      ok: false;
      code: TransactionCategoryEditFailureCode;
      message: string;
    };

export class TransactionCategoryEditValidationError extends Error {
  readonly code: TransactionCategoryEditFailureCode;

  constructor(code: TransactionCategoryEditFailureCode, message: string) {
    super(message);
    this.name = "TransactionCategoryEditValidationError";
    this.code = code;
  }
}

export function decideTransactionCategoryEdit(
  intent: TransactionCategoryEditIntent,
  allowedCategoryIds: readonly string[]
): TransactionCategoryEditDecision {
  if (typeof intent.rememberForMerchant !== "boolean") {
    throw new TransactionCategoryEditValidationError(
      "INVALID_LEARNING_CHOICE",
      "Choose whether to remember this category for the merchant."
    );
  }

  const { merchantAlias, merchantCategoryRule } = intent;
  if (
    merchantCategoryRule !== null &&
    (merchantCategoryRule.merchantAlias !== merchantAlias || merchantAlias.trim() === "")
  ) {
    throw new TransactionCategoryEditValidationError(
      "INVALID_MERCHANT_RULE",
      "The remembered category does not match this transaction's merchant alias."
    );
  }

  if (intent.mode === "single") {
    if (!allowedCategoryIds.includes(intent.categoryId)) {
      throw new TransactionCategoryEditValidationError(
        "INVALID_CATEGORY",
        `Invalid transaction category: ${intent.categoryId}`
      );
    }

    const transactionChanged = intent.transaction.categoryId !== intent.categoryId ||
      (intent.transaction.categoryAllocations?.length ?? 0) > 0;
    const merchantRuleEffect = !intent.rememberForMerchant
      ? "not-requested"
      : merchantAlias.trim() === ""
        ? "unavailable"
        : merchantCategoryRule?.categoryId === intent.categoryId
          ? "already-matching"
          : "updated";

    return {
      mode: intent.mode,
      transactionChanged,
      merchantRuleEffect,
      shouldWrite: transactionChanged || merchantRuleEffect === "updated",
      categoryId: intent.categoryId,
    };
  }

  if (intent.rememberForMerchant) {
    throw new TransactionCategoryEditValidationError(
      "INVALID_LEARNING_CHOICE",
      "A split cannot be remembered as one category for this merchant."
    );
  }

  let allocations: TransactionCategoryAllocation[];
  try {
    validateTransactionCategoryAllocations(
      intent.transaction,
      intent.allocations,
      allowedCategoryIds
    );
    allocations = intent.allocations.map((allocation) => ({
      categoryId: allocation.categoryId,
      amountMinor: allocation.amountMinor,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "The split is invalid.";
    throw new TransactionCategoryEditValidationError("INVALID_SPLIT", message);
  }

  return {
    mode: intent.mode,
    transactionChanged: intent.transaction.categoryId !== undefined ||
      !sameAllocations(intent.transaction.categoryAllocations, allocations),
    merchantRuleEffect: "not-requested",
    shouldWrite: intent.transaction.categoryId !== undefined ||
      !sameAllocations(intent.transaction.categoryAllocations, allocations),
    allocations,
  };
}

export function isTransactionCategoryEditStateCurrent(
  expected: TransactionCategoryEditExpectedState,
  current: TransactionCategoryEditExpectedState
): boolean {
  return expected.databaseGeneration === current.databaseGeneration &&
    stableJson(expected.transaction) === stableJson(current.transaction) &&
    stableJson(expected.merchantCategoryRule) === stableJson(current.merchantCategoryRule);
}

function sameAllocations(
  left: readonly TransactionCategoryAllocation[] | undefined,
  right: readonly TransactionCategoryAllocation[]
): boolean {
  return (left ?? []).length === right.length &&
    (left ?? []).every((allocation, index) =>
      allocation.categoryId === right[index]?.categoryId &&
      allocation.amountMinor === right[index]?.amountMinor
    );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nestedValue]) =>
      `${JSON.stringify(key)}:${stableJson(nestedValue)}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
