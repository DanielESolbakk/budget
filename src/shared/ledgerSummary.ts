import type { TransactionFilters, TransactionPage } from "../domain/ledger/filterTransactions.js";
import type { Account, ExchangeRate, Transaction } from "../domain/types.js";
import { buildNokTransactionReport, type NokCurrencySubtotals } from "./dashboard.js";

export interface LedgerSummary extends Pick<NokCurrencySubtotals, "nativeSubtotals" | "incompleteCurrencies"> {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
}

export interface LedgerQueryResult extends TransactionPage {
  accounts: Account[];
  summary: LedgerSummary;
}

export function buildLedgerSummary(
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  rates: readonly ExchangeRate[],
): LedgerSummary {
  const report = buildNokTransactionReport({ transactions, accounts, rates });
  let incomeMinor = 0;
  let expenseMinor = 0;
  for (const entry of report.transactions) {
    if (entry.nokAmountMinor === null) continue;
    if (entry.nokAmountMinor >= 0) incomeMinor += entry.nokAmountMinor;
    else expenseMinor -= entry.nokAmountMinor;
    if (!Number.isSafeInteger(incomeMinor) || !Number.isSafeInteger(expenseMinor)) {
      throw new RangeError("Ledger NOK totals exceed the safe integer range.");
    }
  }
  return {
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    nativeSubtotals: report.nativeSubtotals,
    incompleteCurrencies: report.incompleteCurrencies,
  };
}

const filterFields = [
  "accountId", "bookedFromIso", "bookedToIso", "merchant", "amountMinor",
  "amountFromMinor", "amountToMinor", "categoryId", "uncategorizedOnly",
  "transactionType", "datePreset", "largeTransactionsOnly", "dateBasis",
] as const satisfies readonly (keyof TransactionFilters)[];

export function haveSameTransactionFilters(left: TransactionFilters, right: TransactionFilters): boolean {
  return filterFields.every((field) => left[field] === right[field]);
}
