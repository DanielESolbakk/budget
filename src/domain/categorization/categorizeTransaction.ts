import type { Transaction } from "../types.js";
import { normalizeMerchantName } from "../merchant/normalizeMerchantName.js";

const CATEGORY_RULES: ReadonlyArray<{
  categoryId: string;
  merchantNames: readonly string[];
}> = [
  { categoryId: "salary", merchantNames: ["LØNN", "SALARY"] },
  {
    categoryId: "groceries",
    merchantNames: ["KIWI", "REMA 1000", "MENY", "COOP", "DAGLIGVARE"],
  },
];

export function categorizeTransaction(
  transaction: Transaction,
  learnedRules: ReadonlyMap<string, string> = new Map()
): Transaction {
  if (transaction.categoryId !== undefined) {
    return transaction;
  }

  const merchantAlias = normalizeMerchantName(transaction.merchantRaw);
  const learnedCategoryId = learnedRules.get(merchantAlias);
  const matchingRule = CATEGORY_RULES.find((rule) => rule.merchantNames.includes(merchantAlias));

  return {
    ...transaction,
    merchantAlias,
    ...(learnedCategoryId !== undefined
      ? { categoryId: learnedCategoryId }
      : matchingRule === undefined
        ? {}
        : { categoryId: matchingRule.categoryId }),
  };
}

export function categorizeTransactions(
  transactions: readonly Transaction[],
  learnedRules: ReadonlyMap<string, string> = new Map()
): Transaction[] {
  return transactions.map((transaction) => categorizeTransaction(transaction, learnedRules));
}
