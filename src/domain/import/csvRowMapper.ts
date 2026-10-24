import type {
  BankTransactionStatus,
  PendingTransactionObservation,
  PendingTransactionStatus,
  Transaction,
} from "../types.js";
import { isCurrencyCode } from "../types.js";
import { buildTransactionFingerprint } from "./buildTransactionFingerprint.js";
import { assignImportedTransactionIds } from "./assignImportedTransactionIds.js";
import { CSV_COLUMN_NAMES } from "./csvColumns.js";
import type { CsvColumnKey, CsvColumnMapping } from "./csvColumns.js";

export { CSV_COLUMN_NAMES } from "./csvColumns.js";
export type { CsvColumnKey, CsvColumnMapping } from "./csvColumns.js";

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
  | "INVALID_ROW_SHAPE"
  | "MISSING_DATE"
  | "INVALID_DATE_FORMAT"
  | "MISSING_DESCRIPTION"
  | "AMBIGUOUS_AMOUNT"
  | "INVALID_AMOUNT_FORMAT"
  | "INVALID_CURRENCY_CODE"
  | "UNSUPPORTED_TRANSACTION_STATUS";

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
  pendingObservations?: PendingTransactionObservation[];
  skipped: Array<{ rowIndex: number; errors: CsvRowValidationError[] }>;
}

export interface CsvRowPreview {
  rowIndex: number;
  transaction?: Transaction;
  pendingObservation?: PendingTransactionObservation;
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
  sourceScope?: string;
}

function normalizeHeaderName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

export function mapCsvImportedStatus(
  value: string
): { status: "booked" } | { status: PendingTransactionStatus; sourceStatus: Exclude<BankTransactionStatus, "Bokført"> } {
  const normalized = normalizeHeaderName(value.trim());

  if (normalized === "reservert") {
    return { status: "reserved", sourceStatus: "Reservert" };
  }
  if (normalized === "bekreftet") {
    return { status: "confirmed", sourceStatus: "Bekreftet" };
  }
  return { status: "booked" };
}

function isSupportedCsvImportedStatus(value: string): boolean {
  const normalized = normalizeHeaderName(value.trim().replace(/[øØ]/g, "o"));
  return normalized === "" ||
    normalized === "reservert" ||
    normalized === "bekreftet" ||
    normalized === "bokfort";
}

export function createCsvPendingObservation(
  transaction: Transaction,
  sourceRowIndex: number,
  status: PendingTransactionStatus,
  sourceStatus: Exclude<BankTransactionStatus, "Bokført">
): PendingTransactionObservation {
  return {
    id: transaction.id,
    householdId: transaction.householdId,
    accountId: transaction.accountId,
    transactionDateIso: transaction.bookedAtIso,
    amountMinor: transaction.amountMinor,
    merchantRaw: transaction.merchantRaw,
    sourceRowIndex,
    sourceType: "csv",
    status,
    sourceStatus,
    ...(transaction.currencyCode === undefined ? {} : { currencyCode: transaction.currencyCode }),
    ...(transaction.sourceReference === undefined ? {} : { sourceReference: transaction.sourceReference }),
    ...(transaction.importJobId === undefined ? {} : { importJobId: transaction.importJobId }),
  };
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

export function extractCsvSourceAmount(
  row: Record<string, string>,
  columnMapping?: CsvColumnMapping
): { amountMinor?: number; currencyCode?: string } {
  const normalizedRow = normalizeCsvRow(row, columnMapping);
  const amountInRaw = (normalizedRow[CSV_COLUMN_NAMES.amountIn] ?? "").trim();
  const amountOutRaw = (normalizedRow[CSV_COLUMN_NAMES.amountOut] ?? "").trim();
  const amountIn = amountInRaw === "" ? 0 : parseAmount(amountInRaw);
  const amountOut = amountOutRaw === "" ? 0 : parseAmount(amountOutRaw);
  const currencyCode = (normalizedRow[CSV_COLUMN_NAMES.currency] ?? "").trim();
  const result: { amountMinor?: number; currencyCode?: string } = {};

  if (currencyCode && !isCurrencyCode(currencyCode.toUpperCase())) return result;
  if (currencyCode) result.currencyCode = currencyCode;
  if (
    amountIn === null ||
    amountOut === null ||
    (amountIn !== 0 && amountOut !== 0)
  ) {
    return result;
  }

  const amountMinor = amountIn !== 0
    ? toMinorUnits(amountIn)
    : amountOut !== 0
      ? -Math.abs(toMinorUnits(amountOut))
      : 0;
  if (Number.isSafeInteger(amountMinor)) result.amountMinor = amountMinor;
  return result;
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
  const rowShapeError = normalizedRow.__csvRowShapeError?.trim();

  if (rowShapeError) {
    errors.push({
      code: "INVALID_ROW_SHAPE",
      message: rowShapeError,
      field: "row",
    });
  }

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

  const currencyCode = (normalizedRow[CSV_COLUMN_NAMES.currency] ?? "").trim();
  if (currencyCode && !isCurrencyCode(currencyCode.toUpperCase())) {
    errors.push({
      code: "INVALID_CURRENCY_CODE",
      message: `Currency code "${currencyCode}" must contain three letters.`,
      field: CSV_COLUMN_NAMES.currency,
    });
  }

  const status = (normalizedRow[CSV_COLUMN_NAMES.status] ?? "").trim();
  if (!isSupportedCsvImportedStatus(status)) {
    errors.push({
      code: "UNSUPPORTED_TRANSACTION_STATUS",
      message: `Transaction status "${status}" is not supported.`,
      field: CSV_COLUMN_NAMES.status,
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
  const pendingRows: Array<{
    rowIndex: number;
    transaction: Transaction;
    status: PendingTransactionStatus;
    sourceStatus: Exclude<BankTransactionStatus, "Bokført">;
  }> = [];
  const skipped: Array<{ rowIndex: number; errors: CsvRowValidationError[] }> = [];

  for (let i = 0; i < rows.length; i++) {
    const result = mapCsvRowToTransaction(rows[i]!, i, options);
    if (result.ok) {
      const normalizedRow = normalizeCsvRow(rows[i]!, options.columnMapping);
      const mappedStatus = mapCsvImportedStatus(normalizedRow[CSV_COLUMN_NAMES.status] ?? "");
      if (mappedStatus.status === "booked") {
        mappedTransactions.push(result.transaction);
      } else {
        pendingRows.push({
          rowIndex: i,
          transaction: result.transaction,
          status: mappedStatus.status,
          sourceStatus: mappedStatus.sourceStatus,
        });
      }
    } else {
      skipped.push({ rowIndex: result.rowIndex, errors: result.errors });
    }
  }

  if (skipped.length > 0) {
    return { transactions: [], skipped };
  }

  const sourceScope = options.sourceScope === undefined ? {} : { sourceScope: options.sourceScope };
  const transactions = assignImportedTransactionIds(mappedTransactions, {
    ...sourceScope,
    sourceReferences: mappedTransactions.map((transaction) => transaction.sourceReference),
  });
  const identifiedPendingRows = assignImportedTransactionIds(
    pendingRows.map(({ transaction }) => transaction),
    {
      sourceScopes: pendingRows.map(({ transaction }) =>
        transaction.sourceReference?.trim() ? undefined : options.sourceScope
      ),
      sourceReferences: pendingRows.map(({ transaction }) => transaction.sourceReference),
    }
  );

  return {
    transactions,
    ...(pendingRows.length === 0
      ? {}
      : {
          pendingObservations: pendingRows.map((row, index) =>
            createCsvPendingObservation(
              identifiedPendingRows[index]!,
              row.rowIndex,
              row.status,
              row.sourceStatus
            )
          ),
        }),
    skipped,
  };
}

/** Maps every row independently so the renderer can show candidates and unresolved rows before import. */
export function previewCsvRows(
  rows: Array<Record<string, string>>,
  options: CsvRowMappingOptions
): {
  rows: CsvRowPreview[];
  transactions: Transaction[];
  pendingObservations?: PendingTransactionObservation[];
} {
  type MappedRow =
    | { rowIndex: number; errors: CsvRowValidationError[] }
    | {
        rowIndex: number;
        transaction: Transaction;
        status: "booked";
        errors: [];
      }
    | {
        rowIndex: number;
        transaction: Transaction;
        status: PendingTransactionStatus;
        sourceStatus: Exclude<BankTransactionStatus, "Bokført">;
        errors: [];
      };

  const mappedRows: MappedRow[] = rows.map((row, rowIndex) => {
    const result = mapCsvRowToTransaction(row, rowIndex, options);
    if (!result.ok) {
      return { rowIndex, errors: result.errors };
    }

    const normalizedRow = normalizeCsvRow(row, options.columnMapping);
    const mappedStatus = mapCsvImportedStatus(normalizedRow[CSV_COLUMN_NAMES.status] ?? "");
    return mappedStatus.status === "booked"
      ? { rowIndex, transaction: result.transaction, status: "booked", errors: [] }
      : {
          rowIndex,
          transaction: result.transaction,
          status: mappedStatus.status,
          sourceStatus: mappedStatus.sourceStatus,
          errors: [],
        };
  });
  const validRows = mappedRows.flatMap((row) =>
    "transaction" in row ? [row] : []
  );
  const validTransactions = assignImportedTransactionIds(
    validRows.map(({ transaction }) => transaction),
    {
      sourceScopes: validRows.map((row) =>
        row.status !== "booked" && row.transaction.sourceReference?.trim()
          ? undefined
          : options.sourceScope
      ),
      sourceReferences: validRows.map(({ transaction }) => transaction.sourceReference),
    }
  );
  let validTransactionIndex = 0;
  const normalizedPreviews: CsvRowPreview[] = mappedRows.map((row) => {
    if (!("transaction" in row)) {
      return { rowIndex: row.rowIndex, errors: row.errors };
    }

    const transaction = validTransactions[validTransactionIndex]!;
    validTransactionIndex += 1;
    return row.status === "booked"
      ? { rowIndex: row.rowIndex, transaction, errors: [] }
      : {
          rowIndex: row.rowIndex,
          pendingObservation: createCsvPendingObservation(
            transaction,
            row.rowIndex,
            row.status,
            row.sourceStatus
          ),
          errors: [],
        };
  });
  const pendingObservations = normalizedPreviews.flatMap((preview) =>
    preview.pendingObservation === undefined ? [] : [preview.pendingObservation]
  );

  return {
    rows: normalizedPreviews,
    transactions: normalizedPreviews.flatMap((preview) =>
      preview.transaction === undefined ? [] : [preview.transaction]
    ),
    ...(pendingObservations.length === 0 ? {} : { pendingObservations }),
  };
}
