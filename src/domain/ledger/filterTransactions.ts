import type { Transaction } from "../types.js";
import { CATEGORY_OPTIONS } from "../categorization/categoryOptions.js";

export type TransactionTypeFilter = "income" | "expenses";
export type TransactionDatePreset = "thisMonth";

export interface TransactionFilters {
  accountId?: string;
  bookedFromIso?: string;
  bookedToIso?: string;
  merchant?: string;
  amountMinor?: number;
  amountFromMinor?: number;
  amountToMinor?: number;
  categoryId?: string;
  uncategorizedOnly?: boolean;
  transactionType?: TransactionTypeFilter;
  datePreset?: TransactionDatePreset;
  largeTransactionsOnly?: boolean;
}

export interface TransactionQuery extends TransactionFilters {
  sortBy?: TransactionSortField;
  sortDirection?: TransactionSortDirection;
  page?: number;
  pageSize?: number;
}

export interface SavedLedgerView {
  id: string;
  name: string;
  filters: TransactionFilters;
}

export type TransactionSortField =
  | "bookedAtIso"
  | "merchantRaw"
  | "amountMinor"
  | "categoryId"
  | "accountId";

export type TransactionSortDirection = "asc" | "desc";

export interface TransactionPage {
  transactions: Transaction[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export const DEFAULT_TRANSACTION_PAGE_SIZE = 50;
export const MAX_TRANSACTION_PAGE_SIZE = 100;
export const LARGE_TRANSACTION_THRESHOLD_MINOR = 1_000_000;

export function parseNokAmountToMinor(value: string): number | null {
  const input = value.trim();
  const hasGrouping = /[ \u00a0\u202f]/.test(input);
  const expression = hasGrouping
    ? /^(-?)(\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,](\d{1,2}))?$/
    : /^(-?)(\d+)(?:[.,](\d{1,2}))?$/;
  const match = expression.exec(input);
  if (!match) return null;

  const wholeAmount = BigInt(match[2]!.replace(/[ \u00a0\u202f]/g, ""));
  const fractionalAmount = BigInt((match[3] ?? "").padEnd(2, "0") || "0");
  const magnitude = wholeAmount * 100n + fractionalAmount;
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  const signedAmount = match[1] === "-" ? -magnitude : magnitude;
  return Number(signedAmount);
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function thisMonthRange(now = new Date()): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: localDateString(start), to: localDateString(end) };
}

export function resolveTransactionDateBounds(
  query: Pick<TransactionQuery, "bookedFromIso" | "bookedToIso" | "datePreset">,
  now = new Date()
): { bookedFromIso: string | undefined; bookedToIso: string | undefined } {
  const currentMonth = query.datePreset === "thisMonth" ? thisMonthRange(now) : undefined;
  return {
    bookedFromIso: currentMonth === undefined
      ? query.bookedFromIso
      : laterBookingStartBound(query.bookedFromIso, currentMonth.from),
    bookedToIso: currentMonth === undefined
      ? query.bookedToIso
      : earlierBookingEndBound(query.bookedToIso, currentMonth.to),
  };
}

function compareTransactions(
  left: Transaction,
  right: Transaction,
  sortBy: TransactionSortField,
  sortDirection: TransactionSortDirection
): number {
  const leftValue = sortBy === "bookedAtIso"
    ? bookingTimeStart(left.bookedAtIso)
    : sortBy === "categoryId"
      ? CATEGORY_OPTIONS.find((category) => category.id === left.categoryId)?.label ?? left.categoryId ?? "Uncategorized"
      : left[sortBy] ?? "";
  const rightValue = sortBy === "bookedAtIso"
    ? bookingTimeStart(right.bookedAtIso)
    : sortBy === "categoryId"
      ? CATEGORY_OPTIONS.find((category) => category.id === right.categoryId)?.label ?? right.categoryId ?? "Uncategorized"
      : right[sortBy] ?? "";
  const comparison = typeof leftValue === "number" && typeof rightValue === "number"
    ? leftValue - rightValue
    : String(leftValue).localeCompare(String(rightValue));

  return (sortDirection === "desc" ? -comparison : comparison) || left.id.localeCompare(right.id);
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

function laterBookingStartBound(left: string | undefined, right: string): string {
  if (left === undefined) return right;
  return compareBookingTimes(left, right) >= 0 ? left : right;
}

function earlierBookingEndBound(left: string | undefined, right: string): string {
  if (left === undefined) return right;
  const leftEnd = Date.parse(bookingTimeEnd(left));
  const rightEnd = Date.parse(bookingTimeEnd(right));
  if (!Number.isFinite(leftEnd) || !Number.isFinite(rightEnd)) {
    return left.localeCompare(right) <= 0 ? left : right;
  }
  return leftEnd <= rightEnd ? left : right;
}

function compareBookingTimes(left: string, right: string): number {
  const leftTime = Date.parse(bookingTimeStart(left));
  const rightTime = Date.parse(bookingTimeStart(right));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return bookingTimeStart(left).localeCompare(bookingTimeStart(right));
}

export function filterTransactions(
  transactions: readonly Transaction[],
  query: TransactionQuery
): Transaction[] {
  const { bookedFromIso, bookedToIso } = resolveTransactionDateBounds(query);

  return transactions
    .filter((transaction) => query.accountId === undefined || transaction.accountId === query.accountId)
    .filter((transaction) => bookedFromIso === undefined || compareBookingTimes(transaction.bookedAtIso, bookedFromIso) >= 0)
    .filter((transaction) => bookedToIso === undefined || compareBookingTimes(transaction.bookedAtIso, bookingTimeEnd(bookedToIso)) <= 0)
    .filter((transaction) => query.amountMinor === undefined || transaction.amountMinor === query.amountMinor)
    .filter((transaction) => query.amountFromMinor === undefined || transaction.amountMinor >= query.amountFromMinor)
    .filter((transaction) => query.amountToMinor === undefined || transaction.amountMinor <= query.amountToMinor)
    .filter((transaction) => query.categoryId === undefined || transaction.categoryId === query.categoryId)
    .filter((transaction) => !query.uncategorizedOnly || transaction.categoryId === undefined)
    .filter((transaction) => query.transactionType === undefined ||
      (query.transactionType === "income" ? transaction.amountMinor > 0 : transaction.amountMinor < 0))
    .filter((transaction) => !query.largeTransactionsOnly ||
      Math.abs(transaction.amountMinor) >= LARGE_TRANSACTION_THRESHOLD_MINOR)
    .filter((transaction) => query.merchant === undefined || includesMerchant(transaction, query.merchant))
    .sort((left, right) => compareTransactions(
      left,
      right,
      query.sortBy ?? "bookedAtIso",
      query.sortDirection ?? "desc"
    ));
}

export function queryTransactions(
  transactions: readonly Transaction[],
  query: TransactionQuery
): TransactionPage {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_TRANSACTION_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("page must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_TRANSACTION_PAGE_SIZE) {
    throw new RangeError(`pageSize must be an integer between 1 and ${MAX_TRANSACTION_PAGE_SIZE}.`);
  }

  const filtered = filterTransactions(transactions, query);
  const start = (page - 1) * pageSize;
  return {
    transactions: filtered.slice(start, start + pageSize),
    totalCount: filtered.length,
    page,
    pageSize,
  };
}
