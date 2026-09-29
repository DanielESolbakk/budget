import type { CategorizationRule, Transaction } from "../types.js";
import { normalizeMerchantName } from "../merchant/normalizeMerchantName.js";
import { evaluateCategorizationRule } from "./evaluateCategorizationRule.js";

const CATEGORY_RULES: readonly CategorizationRule[] = [
  { ruleId: "builtin-salary-lonn", merchantAlias: "LØNN", categoryId: "salary", priority: 0 },
  { ruleId: "builtin-salary-salary", merchantAlias: "SALARY", categoryId: "salary", priority: 0 },
  { ruleId: "builtin-groceries-kiwi", merchantAlias: "KIWI", categoryId: "groceries", priority: 0 },
  { ruleId: "builtin-groceries-rema-1000", merchantAlias: "REMA 1000", categoryId: "groceries", priority: 0 },
  { ruleId: "builtin-groceries-meny", merchantAlias: "MENY", categoryId: "groceries", priority: 0 },
  { ruleId: "builtin-groceries-coop", merchantAlias: "COOP", categoryId: "groceries", priority: 0 },
  { ruleId: "builtin-groceries-dagligvare", merchantAlias: "DAGLIGVARE", categoryId: "groceries", priority: 0 },
];

export function categorizeTransaction(
  transaction: Transaction,
  learnedRules: ReadonlyMap<string, string> = new Map()
): Transaction {
  if (transaction.categoryId !== undefined) {
    return transaction;
  }

  const merchantAlias = normalizeMerchantName(transaction.merchantRaw);
  const persistedRules: CategorizationRule[] = [...learnedRules].map(([alias, categoryId]) => ({
    ruleId: `learned:${alias}`,
    merchantAlias: alias,
    categoryId,
    priority: 100,
  }));
  const categorization = evaluateCategorizationRule(merchantAlias, [
    ...CATEGORY_RULES,
    ...persistedRules,
  ]);

  return {
    ...transaction,
    merchantAlias,
    ...(categorization.categoryId === undefined ? {} : { categoryId: categorization.categoryId }),
    categorization,
  };
}

export function categorizeTransactions(
  transactions: readonly Transaction[],
  learnedRules: ReadonlyMap<string, string> = new Map()
): Transaction[] {
  return transactions.map((transaction) => categorizeTransaction(transaction, learnedRules));
}
