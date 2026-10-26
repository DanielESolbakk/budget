import type { Account, ExchangeRate, Transaction } from "../types.js";
import { convertCurrencyAmount } from "../money/convertCurrencyAmount.js";

/** Stable ordered header columns for the exported CSV format. */
export const EXPORT_CSV_HEADERS = [
  "id",
  "householdId",
  "accountId",
  "bookedAtIso",
  "amountMinor",
  "merchantRaw",
  "merchantAlias",
  "sourceReference",
  "categoryId",
  "importJobId",
  "categoryAllocations",
  "currencyCode",
  "convertedNokAmountMinor",
  "conversionStatus",
  "exchangeRateNokPerUnit",
  "exchangeRateEffectiveDate",
  "exchangeRateKind",
  "exchangeRateSource",
  "exchangeRateProvenance",
] as const;

export type ExportCsvHeader = (typeof EXPORT_CSV_HEADERS)[number];

/** A single row in the exported CSV, expressed as a string-valued record. */
export type ExportCsvRow = Record<ExportCsvHeader, string>;

export interface CsvExportContext {
  accounts?: readonly Account[];
  exchangeRates?: readonly ExchangeRate[];
}

/**
 * Maps a Transaction to a string-valued CSV row using the stable header order.
 * Optional fields are serialized as empty strings when absent.
 */
export function buildCsvRow(
  transaction: Transaction,
  context: CsvExportContext = {}
): ExportCsvRow {
  const currencyCode = transaction.currencyCode ??
    context.accounts?.find((account) => account.id === transaction.accountId)?.currencyCode;
  const conversion = currencyCode === undefined
    ? undefined
    : convertCurrencyAmount({
        amountMinor: transaction.amountMinor,
        currencyCode,
        asOfDateIso: transaction.bookedAtIso.slice(0, 10),
        rates: context.exchangeRates ?? [],
      });

  return {
    id: transaction.id,
    householdId: transaction.householdId,
    accountId: transaction.accountId,
    bookedAtIso: transaction.bookedAtIso,
    amountMinor: String(transaction.amountMinor),
    merchantRaw: transaction.merchantRaw,
    merchantAlias: transaction.merchantAlias ?? "",
    sourceReference: transaction.sourceReference ?? "",
    categoryId: transaction.categoryId ?? "",
    importJobId: transaction.importJobId ?? "",
    categoryAllocations: transaction.categoryAllocations === undefined
      ? ""
      : JSON.stringify(
          [...transaction.categoryAllocations].sort((left, right) =>
            left.categoryId.localeCompare(right.categoryId) ||
            left.amountMinor - right.amountMinor
          )
        ),
    currencyCode: currencyCode ?? "",
    convertedNokAmountMinor: conversion?.state === "converted"
      ? String(conversion.nokAmountMinor)
      : "",
    conversionStatus: conversion?.state ?? "unavailable",
    exchangeRateNokPerUnit: conversion?.exchangeRate?.rateNokPerUnit ?? "",
    exchangeRateEffectiveDate: conversion?.exchangeRate?.effectiveDate ?? "",
    exchangeRateKind: conversion?.exchangeRate?.kind ?? "",
    exchangeRateSource: conversion?.exchangeRate?.source ?? "",
    exchangeRateProvenance: conversion?.exchangeRate?.provenance ?? "",
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
export function buildCsvOutput(
  transactions: Transaction[],
  context: CsvExportContext = {}
): string {
  const header = EXPORT_CSV_HEADERS.join(",");
  const rows = transactions.map((tx) => serializeCsvRow(buildCsvRow(tx, context)));
  return [header, ...rows].join("\n") + "\n";
}
