import type { Transaction } from "../types.js";

/** Column names for the supported Norwegian bank CSV import format. */
export const CSV_COLUMN_NAMES = {
  executionDate: "Utført dato",
  bookedDate: "Bokført dato",
  description: "Beskrivelse",
  amountIn: "Beløp inn",
  amountOut: "Beløp ut",
  currency: "Valuta",
  status: "Status",
  reference: "Melding/KID/Fakt.nr",
} as const;

export type CsvRowValidationErrorCode =
  | "MISSING_DATE"
  | "INVALID_DATE_FORMAT"
  | "MISSING_DESCRIPTION"
  | "AMBIGUOUS_AMOUNT"
  | "INVALID_AMOUNT_FORMAT";

export interface CsvRowValidationError {
  code: CsvRowValidationErrorCode;
  message: string;
  field: string;
}

export interface CsvRowMappingSuccess {
  ok: true;
  transaction: Transaction;
}

export interface CsvRowMappingFailure {
  ok: false;
  rowIndex: number;
  errors: CsvRowValidationError[];
}

export type CsvRowMappingResult = CsvRowMappingSuccess | CsvRowMappingFailure;

/** Stable output shape for a CSV import run consumed by downstream app-layer workflows. */
export interface CsvImportResult {
  transactions: Transaction[];
  skipped: Array<{ rowIndex: number; errors: CsvRowValidationError[] }>;
}

export interface CsvRowMappingOptions {
  householdId: string;
  accountId: string;
  importJobId?: string;
  /** Prefix for generated transaction IDs. Defaults to "csv". */
  idPrefix?: string;
}

function parseNorwegianDate(value: string): string | null {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return null;
  const [day = "", month = "", year = ""] = value.split(".");
  const dayNumber = Number.parseInt(day, 10);
  const monthNumber = Number.parseInt(month, 10);
  const yearNumber = Number.parseInt(year, 10);
  const parsed = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));

  if (
    parsed.getUTCFullYear() !== yearNumber ||
    parsed.getUTCMonth() !== monthNumber - 1 ||
    parsed.getUTCDate() !== dayNumber
  ) {
    return null;
  }

  return `${year}-${month}-${day}T00:00:00Z`;
}

function parseAmount(raw: string): number | null {
  const normalized = raw.trim();
  if (normalized === "") return null;
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Validates a raw CSV row object against the supported Norwegian bank CSV format.
 * Returns an array of validation errors; an empty array means the row is valid.
 */
export function validateCsvRow(row: Record<string, string>): CsvRowValidationError[] {
  const errors: CsvRowValidationError[] = [];

  const executionDate = (row[CSV_COLUMN_NAMES.executionDate] ?? "").trim();
  const bookedDate = (row[CSV_COLUMN_NAMES.bookedDate] ?? "").trim();
  const dateSource = bookedDate || executionDate;

  if (!dateSource) {
    errors.push({
      code: "MISSING_DATE",
      message: "Row must have either Utført dato or Bokført dato.",
      field: CSV_COLUMN_NAMES.executionDate,
    });
  } else if (!parseNorwegianDate(dateSource)) {
    errors.push({
      code: "INVALID_DATE_FORMAT",
      message: `Date value "${dateSource}" is not in dd.MM.yyyy format.`,
      field: bookedDate ? CSV_COLUMN_NAMES.bookedDate : CSV_COLUMN_NAMES.executionDate,
    });
  }

  const description = (row[CSV_COLUMN_NAMES.description] ?? "").trim();
  if (!description) {
    errors.push({
      code: "MISSING_DESCRIPTION",
      message: "Row must have a non-empty Beskrivelse.",
      field: CSV_COLUMN_NAMES.description,
    });
  }

  const amountInRaw = (row[CSV_COLUMN_NAMES.amountIn] ?? "").trim();
  const amountOutRaw = (row[CSV_COLUMN_NAMES.amountOut] ?? "").trim();

  if (amountInRaw !== "" && parseAmount(amountInRaw) === null) {
    errors.push({
      code: "INVALID_AMOUNT_FORMAT",
      message: `Amount-in value "${amountInRaw}" is not a valid number.`,
      field: CSV_COLUMN_NAMES.amountIn,
    });
  }

  if (amountOutRaw !== "" && parseAmount(amountOutRaw) === null) {
    errors.push({
      code: "INVALID_AMOUNT_FORMAT",
      message: `Amount-out value "${amountOutRaw}" is not a valid number.`,
      field: CSV_COLUMN_NAMES.amountOut,
    });
  }

  const amountIn = parseAmount(amountInRaw);
  const amountOut = parseAmount(amountOutRaw);

  if (amountIn !== null && amountIn !== 0 && amountOut !== null && amountOut !== 0) {
    errors.push({
      code: "AMBIGUOUS_AMOUNT",
      message: `Row has both Beløp inn (${amountInRaw}) and Beløp ut (${amountOutRaw}) populated with non-zero values.`,
      field: CSV_COLUMN_NAMES.amountIn,
    });
  }

  return errors;
}

/**
 * Maps a single raw CSV row to a domain Transaction.
 * Returns a discriminated result: ok=true with the transaction, or ok=false with validation errors.
 */
export function mapCsvRowToTransaction(
  row: Record<string, string>,
  rowIndex: number,
  options: CsvRowMappingOptions
): CsvRowMappingResult {
  const errors = validateCsvRow(row);
  if (errors.length > 0) {
    return { ok: false, rowIndex, errors };
  }

  const executionDate = (row[CSV_COLUMN_NAMES.executionDate] ?? "").trim();
  const bookedDate = (row[CSV_COLUMN_NAMES.bookedDate] ?? "").trim();
  const dateSource = bookedDate || executionDate;
  const bookedAtIso = parseNorwegianDate(dateSource)!;

  const amountInRaw = (row[CSV_COLUMN_NAMES.amountIn] ?? "").trim();
  const amountOutRaw = (row[CSV_COLUMN_NAMES.amountOut] ?? "").trim();
  const amountIn = parseAmount(amountInRaw) ?? 0;
  const amountOut = parseAmount(amountOutRaw) ?? 0;

  // Use -Math.abs() to ensure expense amounts are always negative regardless of
  // whether the source CSV stores Beløp ut as a negative value (e.g. "-45.00") or positive.
  const amountMinor =
    amountIn !== 0
      ? toMinorUnits(amountIn)
      : amountOut !== 0
        ? -Math.abs(toMinorUnits(amountOut))
        : 0;

  const idPrefix = options.idPrefix ?? "csv";
  const transaction: Transaction = {
    id: `${idPrefix}-${rowIndex + 1}`,
    householdId: options.householdId,
    accountId: options.accountId,
    bookedAtIso,
    amountMinor,
    merchantRaw: (row[CSV_COLUMN_NAMES.description] ?? "").trim(),
  };

  if (options.importJobId !== undefined) {
    transaction.importJobId = options.importJobId;
  }

  return { ok: true, transaction };
}

/**
 * Maps an array of raw CSV row objects to a stable CsvImportResult.
 * When any row fails validation, the result contains no mapped transactions and
 * reports every invalid row through the `skipped` array to avoid a partial-success contract.
 */
export function mapCsvRows(
  rows: Array<Record<string, string>>,
  options: CsvRowMappingOptions
): CsvImportResult {
  const mappedTransactions: Transaction[] = [];
  const skipped: Array<{ rowIndex: number; errors: CsvRowValidationError[] }> = [];

  for (let i = 0; i < rows.length; i++) {
    const result = mapCsvRowToTransaction(rows[i]!, i, options);
    if (result.ok) {
      mappedTransactions.push(result.transaction);
    } else {
      skipped.push({ rowIndex: result.rowIndex, errors: result.errors });
    }
  }

  if (skipped.length > 0) {
    return { transactions: [], skipped };
  }

  return { transactions: mappedTransactions, skipped };
}
