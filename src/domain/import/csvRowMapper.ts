import type { Transaction } from "../types.js";
import { buildTransactionFingerprint } from "./buildTransactionFingerprint.js";
import { assignImportedTransactionIds } from "./assignImportedTransactionIds.js";

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

export type CsvColumnKey = keyof typeof CSV_COLUMN_NAMES;
export type CsvColumnMapping = Partial<Record<CsvColumnKey, string>>;

type CsvColumnName = (typeof CSV_COLUMN_NAMES)[keyof typeof CSV_COLUMN_NAMES];

const CSV_COLUMN_ALIASES: Record<CsvColumnName, readonly string[]> = {
  [CSV_COLUMN_NAMES.executionDate]: ["Date", "Execution Date", "Transaction Date", "Dato"],
  [CSV_COLUMN_NAMES.bookedDate]: ["Booked Date", "Posting Date", "Bokfort dato"],
  [CSV_COLUMN_NAMES.description]: ["Description", "Merchant", "Item", "Tekst"],
  [CSV_COLUMN_NAMES.amountIn]: ["Amount In", "Credit", "In", "Belop inn"],
  [CSV_COLUMN_NAMES.amountOut]: ["Amount Out", "Debit", "Out", "Belop ut"],
  [CSV_COLUMN_NAMES.currency]: ["Currency"],
  [CSV_COLUMN_NAMES.status]: ["State"],
  [CSV_COLUMN_NAMES.reference]: ["Reference", "Message", "KID"],
};

export type CsvRowValidationErrorCode =
  | "EMPTY_CSV"
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

export interface CsvRowPreview {
  rowIndex: number;
  transaction?: Transaction;
  errors: CsvRowValidationError[];
}

export interface CsvRowMappingOptions {
  householdId: string;
  accountId: string;
  importJobId?: string;
  /** Prefix for generated transaction IDs. Defaults to "csv". */
  idPrefix?: string;
  columnMapping?: CsvColumnMapping | undefined;
  sourceIdentity?: string;
}

function normalizeHeaderName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

/** Maps common bank export header variants to the canonical Norwegian columns. */
export function normalizeCsvRow(
  row: Record<string, string>,
  columnMapping?: CsvColumnMapping
): Record<string, string> {
  const normalizedRow = { ...row };
  const sourceHeaders = Object.keys(row);

  for (const [columnKey, sourceHeader] of Object.entries(columnMapping ?? {})) {
    const canonicalHeader = CSV_COLUMN_NAMES[columnKey as CsvColumnKey];
    if (sourceHeader !== undefined && row[sourceHeader] !== undefined) {
      normalizedRow[canonicalHeader] = row[sourceHeader] ?? "";
    }
  }

  for (const canonicalHeader of Object.values(CSV_COLUMN_NAMES)) {
    if (normalizedRow[canonicalHeader] !== undefined) continue;

    const aliases = [canonicalHeader, ...CSV_COLUMN_ALIASES[canonicalHeader]];
    const sourceHeader = sourceHeaders.find((candidate) =>
      aliases.some((alias) => normalizeHeaderName(alias) === normalizeHeaderName(candidate))
    );

    if (sourceHeader !== undefined) {
      normalizedRow[canonicalHeader] = row[sourceHeader] ?? "";
    }
  }

  return normalizedRow;
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
  // Accept only canonical decimal numbers to avoid coercive parsing of
  // tokens such as "12,25" or "NOK12.25".
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

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
export function validateCsvRow(
  row: Record<string, string>,
  columnMapping?: CsvColumnMapping
): CsvRowValidationError[] {
  const normalizedRow = normalizeCsvRow(row, columnMapping);
  const errors: CsvRowValidationError[] = [];

  const executionDate = (normalizedRow[CSV_COLUMN_NAMES.executionDate] ?? "").trim();
  const bookedDate = (normalizedRow[CSV_COLUMN_NAMES.bookedDate] ?? "").trim();
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

  const description = (normalizedRow[CSV_COLUMN_NAMES.description] ?? "").trim();
  if (!description) {
    errors.push({
      code: "MISSING_DESCRIPTION",
      message: "Row must have a non-empty Beskrivelse.",
      field: CSV_COLUMN_NAMES.description,
    });
  }

  const amountInRaw = (normalizedRow[CSV_COLUMN_NAMES.amountIn] ?? "").trim();
  const amountOutRaw = (normalizedRow[CSV_COLUMN_NAMES.amountOut] ?? "").trim();

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
  const normalizedRow = normalizeCsvRow(row, options.columnMapping);
  const errors = validateCsvRow(normalizedRow);
  if (errors.length > 0) {
    return { ok: false, rowIndex, errors };
  }

  const executionDate = (normalizedRow[CSV_COLUMN_NAMES.executionDate] ?? "").trim();
  const bookedDate = (normalizedRow[CSV_COLUMN_NAMES.bookedDate] ?? "").trim();
  const dateSource = bookedDate || executionDate;
  const bookedAtIso = parseNorwegianDate(dateSource)!;

  const amountInRaw = (normalizedRow[CSV_COLUMN_NAMES.amountIn] ?? "").trim();
  const amountOutRaw = (normalizedRow[CSV_COLUMN_NAMES.amountOut] ?? "").trim();
  const amountIn = parseAmount(amountInRaw) ?? 0;
  const amountOut = parseAmount(amountOutRaw) ?? 0;
  const currencyCode = (normalizedRow[CSV_COLUMN_NAMES.currency] ?? "").trim();

  // Use -Math.abs() to ensure expense amounts are always negative regardless of
  // whether the source CSV stores Beløp ut as a negative value (e.g. "-45.00") or positive.
  const amountMinor =
    amountIn !== 0
      ? toMinorUnits(amountIn)
      : amountOut !== 0
        ? -Math.abs(toMinorUnits(amountOut))
        : 0;

  const transaction: Transaction = {
    id: buildTransactionFingerprint({
      accountId: options.accountId,
      bookedAtIso,
      amountMinor,
      merchantRaw: (normalizedRow[CSV_COLUMN_NAMES.description] ?? "").trim(),
    }),
    householdId: options.householdId,
    accountId: options.accountId,
    bookedAtIso,
    amountMinor,
    merchantRaw: (normalizedRow[CSV_COLUMN_NAMES.description] ?? "").trim(),
    sourceType: "csv",
  };

  const sourceReference = (normalizedRow[CSV_COLUMN_NAMES.reference] ?? "").trim();
  if (sourceReference) {
    transaction.sourceReference = sourceReference;
  }

  if (options.importJobId !== undefined) {
    transaction.importJobId = options.importJobId;
  }

  if (currencyCode) {
    transaction.currencyCode = currencyCode;
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
  if (rows.length === 0) {
    return {
      transactions: [],
      skipped: [
        {
          rowIndex: -1,
          errors: [
            {
              code: "EMPTY_CSV",
              message: "CSV must contain at least one data row.",
              field: "file",
            },
          ],
        },
      ],
    };
  }

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

  return {
    transactions: assignImportedTransactionIds(mappedTransactions, {
      ...(options.sourceIdentity === undefined ? {} : { sourceIdentity: options.sourceIdentity }),
      sourceReferences: mappedTransactions.map((transaction, index) =>
        normalizeCsvRow(rows[index]!, options.columnMapping)[CSV_COLUMN_NAMES.reference]
      ),
    }),
    skipped,
  };
}

/** Maps every row independently so the renderer can show candidates and unresolved rows before import. */
export function previewCsvRows(
  rows: Array<Record<string, string>>,
  options: CsvRowMappingOptions
): { rows: CsvRowPreview[]; transactions: Transaction[] } {
  const previews = rows.map((row, rowIndex): CsvRowPreview => {
    const result = mapCsvRowToTransaction(row, rowIndex, options);
    return result.ok
      ? { rowIndex, transaction: result.transaction, errors: [] }
      : { rowIndex, errors: result.errors };
  });
  const validTransactions = assignImportedTransactionIds(
    previews.flatMap((preview) =>
      preview.transaction === undefined ? [] : [preview.transaction]
    ),
    {
      ...(options.sourceIdentity === undefined ? {} : { sourceIdentity: options.sourceIdentity }),
      sourceReferences: previews.flatMap((preview) =>
        preview.transaction === undefined
          ? []
          : [normalizeCsvRow(rows[preview.rowIndex]!, options.columnMapping)[CSV_COLUMN_NAMES.reference]]
      ),
    }
  );
  let validTransactionIndex = 0;
  const normalizedPreviews: CsvRowPreview[] = previews.map((preview) => {
    if (preview.transaction === undefined) {
      return preview;
    }

    const transaction = validTransactions[validTransactionIndex]!;
    validTransactionIndex += 1;
    return { ...preview, transaction };
  });

  return {
    rows: normalizedPreviews,
    transactions: normalizedPreviews.flatMap((preview) =>
      preview.transaction === undefined ? [] : [preview.transaction]
    ),
  };
}
