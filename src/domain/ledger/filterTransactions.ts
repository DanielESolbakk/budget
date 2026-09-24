import type { Transaction } from "../types.js";

export interface TransactionQuery {
  accountId?: string;
  bookedFromIso?: string;
  bookedToIso?: string;
  merchant?: string;
  amountMinor?: number;
  categoryId?: string;
}

function includesMerchant(transaction: Transaction, merchant: string): boolean {
  const normalizedQuery = merchant.trim().toUpperCase();
  if (!normalizedQuery) return true;

  return transaction.merchantRaw.toUpperCase().includes(normalizedQuery) ||
    transaction.merchantAlias?.toUpperCase().includes(normalizedQuery) === true;
}

function bookingTimeStart(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
}

function bookingTimeEnd(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value;
}

export function filterTransactions(
  transactions: readonly Transaction[],
  query: TransactionQuery
): Transaction[] {
  return transactions
    .filter((transaction) => query.accountId === undefined || transaction.accountId === query.accountId)
    .filter((transaction) => query.bookedFromIso === undefined || bookingTimeStart(transaction.bookedAtIso) >= bookingTimeStart(query.bookedFromIso))
    .filter((transaction) => query.bookedToIso === undefined || bookingTimeStart(transaction.bookedAtIso) <= bookingTimeEnd(query.bookedToIso))
    .filter((transaction) => query.amountMinor === undefined || transaction.amountMinor === query.amountMinor)
    .filter((transaction) => query.categoryId === undefined || transaction.categoryId === query.categoryId)
    .filter((transaction) => query.merchant === undefined || includesMerchant(transaction, query.merchant))
    .sort((left, right) => bookingTimeStart(right.bookedAtIso).localeCompare(bookingTimeStart(left.bookedAtIso)) || left.id.localeCompare(right.id));
}
