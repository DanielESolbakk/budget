import type { Transaction } from "../types.js";

/** Stable ordered header columns for the exported CSV format. */
export const EXPORT_CSV_HEADERS = [
  "id",
  "householdId",
  "accountId",
  "bookedAtIso",
  "amountMinor",
  "merchantRaw",
  "merchantAlias",
  "categoryId",
  "importJobId",
] as const;

export type ExportCsvHeader = (typeof EXPORT_CSV_HEADERS)[number];

/** A single row in the exported CSV, expressed as a string-valued record. */
export type ExportCsvRow = Record<ExportCsvHeader, string>;

/**
 * Maps a Transaction to a string-valued CSV row using the stable header order.
 * Optional fields are serialized as empty strings when absent.
 */
export function buildCsvRow(transaction: Transaction): ExportCsvRow {
  return {
    id: transaction.id,
    householdId: transaction.householdId,
    accountId: transaction.accountId,
    bookedAtIso: transaction.bookedAtIso,
    amountMinor: String(transaction.amountMinor),
    merchantRaw: transaction.merchantRaw,
    merchantAlias: transaction.merchantAlias ?? "",
    categoryId: transaction.categoryId ?? "",
    importJobId: transaction.importJobId ?? "",
  };
}

function escapeField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serializes a single ExportCsvRow to a comma-separated line (no trailing newline).
 */
export function serializeCsvRow(row: ExportCsvRow): string {
  return EXPORT_CSV_HEADERS.map((h) => escapeField(row[h])).join(",");
}

/**
 * Builds a complete CSV string from an ordered list of transactions.
 * Rows are written in the order supplied; sorting is the caller's responsibility.
 * Returns the CSV text including the header line and a trailing newline.
 */
export function buildCsvOutput(transactions: Transaction[]): string {
  const header = EXPORT_CSV_HEADERS.join(",");
  const rows = transactions.map((tx) => serializeCsvRow(buildCsvRow(tx)));
  return [header, ...rows].join("\n") + "\n";
}
