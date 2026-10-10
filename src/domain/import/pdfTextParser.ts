import { createHash } from "node:crypto";
import type { Transaction } from "../types.js";

/** Identifier for the Rogaland Sparebank text PDF adapter. */
export const ROGALAND_ADAPTER_ID = "rogaland-sparebank-text-v1";
/** Source identity for the Rogaland Sparebank digital text statement layout. */
export const ROGALAND_SOURCE_ID = "no.rogaland-sparebank.statement-text";

/** Header token that identifies this statement layout. */
const ROGALAND_HEADER_TOKEN = "ROGALAND SPAREBANK";

/**
 * Transaction date pattern: dd.MM.yyyy at the start of a line,
 * optionally preceded by whitespace.
 */
const TRANSACTION_LINE_PATTERN =
  /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+([+-]?\d[\d\s]*,\d{2})\s+([+-]?\d[\d\s]*,\d{2})\s*$/;
const VALID_TRANSACTION_DATE_PREFIX_PATTERN = /^\s*\d{2}\.\d{2}\.\d{4}(?=\s)/;
const TRANSACTION_DATE_LIKE_PREFIX_PATTERN = /^\s*\d{1,4}[./-]\d{1,4}[./-]\d{1,4}(?=\s)/;
const BANK_EXPORT_TABLE_HEADER_PATTERN = /^Dato\s+Type\s+Fra konto\b/;
const BANK_EXPORT_TRANSACTION_DATE_PATTERN = /^\s*(\d{2}\.\d{2}\.\d{4})(?=\s)/;
const BANK_EXPORT_PAGE_FOOTER_PATTERN = /^\s*\d+\s*\/\s*\d+\s+Rogaland Sparebank\s*$/i;
const BANK_EXPORT_SUMMARY_PATTERN = /^\s*(?:Total beløp|Totalt beløp|Inngående saldo|Utgående\s+saldo)\b/i;

export type PdfTextValidationErrorCode =
  | "UNSUPPORTED_LAYOUT"
  | "MISSING_TRANSACTION_SECTION"
  | "INVALID_DATE_FORMAT"
  | "INVALID_AMOUNT_FORMAT"
  | "MISSING_DESCRIPTION"
  | "FILE_READ_ERROR";

export interface PdfTextValidationError {
  code: PdfTextValidationErrorCode;
  message: string;
  lineNumber?: number;
  field?: "date" | "description" | "amount";
}

export interface PdfTextParseSuccess {
  ok: true;
  adapterId: string;
  transactions: Transaction[];
}

export interface PdfTextParseFailure {
  ok: false;
  errors: PdfTextValidationError[];
}

export type PdfTextParseResult = PdfTextParseSuccess | PdfTextParseFailure;

export interface PdfTextParseOptions {
  householdId: string;
  accountId: string;
  importJobId?: string;
  /** Prefix for generated transaction IDs. Defaults to "pdf". */
  idPrefix?: string;
}

export interface PdfTextParseBatchCallbacks {
  batchSize?: number;
  isCancelled: () => boolean;
  onProgress: (completedRows: number, totalRows: number) => void;
}

export function buildRogalandImportJobId(
  text: string,
  options: Pick<PdfTextParseOptions, "householdId" | "accountId">
): string {
  const canonical = [
    ROGALAND_ADAPTER_ID,
    options.householdId.trim(),
    options.accountId.trim(),
    text,
  ].join("|");

  return `import-pdf-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24)}`;
}

/**
 * Parses a Norwegian date string in dd.MM.yyyy format to an ISO-8601 date-time string.
 * Returns null when the value does not match or represents an impossible calendar date.
 */
function parseNorwegianDate(value: string): string | null {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return null;
  const [day = "", month = "", year = ""] = value.split(".");
  const d = Number.parseInt(day, 10);
  const m = Number.parseInt(month, 10);
  const y = Number.parseInt(year, 10);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    return null;
  }
  return `${year}-${month}-${day}T00:00:00Z`;
}

/**
 * Parses a Norwegian-formatted number string (e.g. "50 000,00" or "-97,70") to a float.
 * Returns null when the format is not recognised.
 */
function parseNorwegianAmount(raw: string): number | null {
  const stripped = raw.replace(/\s/g, "").replace(",", ".");
  if (!/^[+-]?\d+(\.\d+)?$/.test(stripped)) return null;
  const value = Number.parseFloat(stripped);
  return Number.isFinite(value) ? value : null;
}

function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Returns true when the text content belongs to the Rogaland Sparebank adapter.
 * Used for source detection before parsing begins.
 */
export function isRogalandStatementText(text: string): boolean {
  return text.includes(ROGALAND_HEADER_TOKEN);
}

interface BankExportRow {
  lineNumber: number;
  text: string;
}

function collectBankExportRows(lines: readonly string[], tableHeaderIndex: number): BankExportRow[] {
  const rows: BankExportRow[] = [];
  let currentRow: BankExportRow | undefined;

  const finishCurrentRow = (): void => {
    if (currentRow !== undefined) {
      rows.push(currentRow);
      currentRow = undefined;
    }
  };

  for (const [index, line] of lines.slice(tableHeaderIndex + 1).entries()) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) continue;
    if (
      BANK_EXPORT_TABLE_HEADER_PATTERN.test(trimmedLine) ||
      /^Transaksjoner\b/i.test(trimmedLine) ||
      /^Kontonummer\s*:/i.test(trimmedLine) ||
      BANK_EXPORT_PAGE_FOOTER_PATTERN.test(trimmedLine) ||
      BANK_EXPORT_SUMMARY_PATTERN.test(trimmedLine)
    ) {
      continue;
    }

    if (BANK_EXPORT_TRANSACTION_DATE_PATTERN.test(line)) {
      finishCurrentRow();
      currentRow = { lineNumber: tableHeaderIndex + index + 2, text: trimmedLine };
    } else if (currentRow !== undefined) {
      currentRow.text = `${currentRow.text} ${trimmedLine}`;
    }
  }

  finishCurrentRow();
  return rows;
}

function parseRogalandBankExport(
  lines: readonly string[],
  tableHeaderIndex: number,
  options: PdfTextParseOptions
): PdfTextParseResult {
  const rows = collectBankExportRows(lines, tableHeaderIndex);
  const idPrefix = options.idPrefix ?? "pdf";
  const transactions: Transaction[] = [];
  const errors: PdfTextValidationError[] = [];
  const bankExportRowPattern =
    /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+([+-]?\d[\d ]*,\d{2})\s+([A-Z]{3})\s+(Bokført|Reservert|Bekreftet)\s*(.*)$/i;

  for (const row of rows) {
    const match = bankExportRowPattern.exec(row.text);
    if (match === null) {
      errors.push({
        code: "INVALID_AMOUNT_FORMAT",
        message: `Could not parse bank-export transaction row at line ${row.lineNumber}.`,
        lineNumber: row.lineNumber,
        field: "amount",
      });
      continue;
    }

    const [, rawDate = "", prefix = "", rawAmount = "", currencyCode = "NOK", , rawMessage = ""] = match;
    const bookedAtIso = parseNorwegianDate(rawDate);
    if (bookedAtIso === null) {
      errors.push({
        code: "INVALID_DATE_FORMAT",
        message: `Invalid bank-export transaction date at line ${row.lineNumber}.`,
        lineNumber: row.lineNumber,
        field: "date",
      });
      continue;
    }

    const amount = parseNorwegianAmount(rawAmount);
    if (amount === null) {
      errors.push({
        code: "INVALID_AMOUNT_FORMAT",
        message: `Invalid bank-export amount at line ${row.lineNumber}.`,
        lineNumber: row.lineNumber,
        field: "amount",
      });
      continue;
    }

    const merchantRaw = rawMessage.trim().replace(/\s+/g, " ") || prefix.trim().replace(/\s+/g, " ");
    if (merchantRaw.length === 0) {
      errors.push({
        code: "MISSING_DESCRIPTION",
        message: `Missing bank-export description at line ${row.lineNumber}.`,
        lineNumber: row.lineNumber,
        field: "description",
      });
      continue;
    }

    const transaction: Transaction = {
      id: `${idPrefix}-${transactions.length + 1}`,
      householdId: options.householdId,
      accountId: options.accountId,
      bookedAtIso,
      amountMinor: toMinorUnits(amount),
      merchantRaw,
      currencyCode,
      sourceType: "pdf",
    };
    if (options.importJobId !== undefined) transaction.importJobId = options.importJobId;
    transactions.push(transaction);
  }

  if (errors.length > 0) return { ok: false, errors };
  if (transactions.length === 0) {
    return {
      ok: false,
      errors: [{
        code: "MISSING_TRANSACTION_SECTION",
        message: "No bank-export transaction rows were found in the statement.",
      }],
    };
  }

  transactions.sort((left, right) =>
    right.bookedAtIso.localeCompare(left.bookedAtIso) ||
    left.amountMinor - right.amountMinor ||
    left.merchantRaw.localeCompare(right.merchantRaw)
  );
  transactions.forEach((transaction, index) => {
    transaction.id = `${idPrefix}-${index + 1}`;
  });

  return { ok: true, adapterId: ROGALAND_ADAPTER_ID, transactions };
}

/**
 * Parses a Rogaland Sparebank digital text PDF statement into domain Transaction candidates.
 *
 * Source detection is performed first: returns UNSUPPORTED_LAYOUT when the header token is
 * absent so that no partial records are created. Transaction rows are parsed line by line;
 * any malformed line is reported as a validation error and the whole result is failed to
 * preserve the no-partial-success contract.
 */
export function parseRogalandStatementText(
  text: string,
  options: PdfTextParseOptions
): PdfTextParseResult {
  if (!isRogalandStatementText(text)) {
    return {
      ok: false,
      errors: [
        {
          code: "UNSUPPORTED_LAYOUT",
          message: `Statement text does not contain the expected header token "${ROGALAND_HEADER_TOKEN}". Unsupported layout.`,
        },
      ],
    };
  }

  const lines = text.split(/\r?\n/);
  const bankExportHeaderIndex = lines.findIndex((line) =>
    BANK_EXPORT_TABLE_HEADER_PATTERN.test(line.trim())
  );
  if (bankExportHeaderIndex !== -1) {
    return parseRogalandBankExport(lines, bankExportHeaderIndex, options);
  }

  // Find the header row that starts the transaction table.
  const tableHeaderIndex = lines.findIndex((line) => /^Dato\s+Beskrivelse/.test(line.trim()));

  if (tableHeaderIndex === -1) {
    return {
      ok: false,
      errors: [
        {
          code: "MISSING_TRANSACTION_SECTION",
          message: "Could not locate the transaction table header (Dato/Beskrivelse) in the statement.",
        },
      ],
    };
  }

  const transactionLines = lines.slice(tableHeaderIndex + 1).filter((l) => l.trim().length > 0);

  const idPrefix = options.idPrefix ?? "pdf";
  const transactions: Transaction[] = [];
  const errors: PdfTextValidationError[] = [];
  let rowIndex = 0;

  for (const [transactionLineIndex, line] of transactionLines.entries()) {
    const lineNumber = tableHeaderIndex + transactionLineIndex + 2;
    const match = TRANSACTION_LINE_PATTERN.exec(line);
    if (!match) {
      if (VALID_TRANSACTION_DATE_PREFIX_PATTERN.test(line)) {
        errors.push({
          code: "INVALID_AMOUNT_FORMAT",
          message: `Could not parse transaction line: "${line.trim()}"`,
          lineNumber,
          field: "amount",
        });
      } else if (TRANSACTION_DATE_LIKE_PREFIX_PATTERN.test(line)) {
        errors.push({
          code: "INVALID_DATE_FORMAT",
          message: `Could not parse transaction line: "${line.trim()}"`,
          lineNumber,
          field: "date",
        });
      }
      continue;
    }

    const [, rawDate = "", rawDescription = "", rawAmount = ""] = match;

    const bookedAtIso = parseNorwegianDate(rawDate);
    if (!bookedAtIso) {
      errors.push({
        code: "INVALID_DATE_FORMAT",
        message: `Invalid date value "${rawDate}" on line: "${line.trim()}"`,
        lineNumber,
        field: "date",
      });
      continue;
    }

    const description = rawDescription.trim();
    if (!description) {
      errors.push({
        code: "MISSING_DESCRIPTION",
        message: `Missing description on line: "${line.trim()}"`,
        lineNumber,
        field: "description",
      });
      continue;
    }

    const amount = parseNorwegianAmount(rawAmount);
    if (amount === null) {
      errors.push({
        code: "INVALID_AMOUNT_FORMAT",
        message: `Invalid amount value "${rawAmount}" on line: "${line.trim()}"`,
        lineNumber,
        field: "amount",
      });
      continue;
    }

    const transaction: Transaction = {
      id: `${idPrefix}-${rowIndex + 1}`,
      householdId: options.householdId,
      accountId: options.accountId,
      bookedAtIso,
      amountMinor: toMinorUnits(amount),
      merchantRaw: description,
      currencyCode: "NOK",
      sourceType: "pdf",
    };

    if (options.importJobId !== undefined) {
      transaction.importJobId = options.importJobId;
    }

    transactions.push(transaction);
    rowIndex++;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (transactions.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "MISSING_TRANSACTION_SECTION",
          message: "No transaction rows were found in the statement.",
        },
      ],
    };
  }

  transactions.sort((left, right) => {
    const dateComparison = right.bookedAtIso.localeCompare(left.bookedAtIso);
    if (dateComparison !== 0) return dateComparison;

    const amountComparison = left.amountMinor - right.amountMinor;
    if (amountComparison !== 0) return amountComparison;

    if (left.merchantRaw < right.merchantRaw) return -1;
    if (left.merchantRaw > right.merchantRaw) return 1;
    return 0;
  });

  transactions.forEach((transaction, index) => {
    transaction.id = `${idPrefix}-${index + 1}`;
  });

  return {
    ok: true,
    adapterId: ROGALAND_ADAPTER_ID,
    transactions,
  };
}

export async function parseRogalandStatementTextInBatches(
  text: string,
  options: PdfTextParseOptions,
  callbacks: PdfTextParseBatchCallbacks
): Promise<PdfTextParseResult | null> {
  if (!isRogalandStatementText(text)) return parseRogalandStatementText(text, options);

  const lines = text.split(/\r?\n/);
  const tableHeaderIndex = lines.findIndex((line) => /^Dato\s+Beskrivelse/.test(line.trim()));
  if (tableHeaderIndex === -1) return parseRogalandStatementText(text, options);

  const transactionLines = lines.slice(tableHeaderIndex + 1).filter((line) => line.trim().length > 0);
  if (transactionLines.length === 0) return parseRogalandStatementText(text, options);

  const batchSize = Math.max(1, Math.floor(callbacks.batchSize ?? 100));
  const headerText = lines.slice(0, tableHeaderIndex + 1).join("\n");
  const transactions: Transaction[] = [];
  const errors: PdfTextValidationError[] = [];

  for (let start = 0; start < transactionLines.length; start += batchSize) {
    if (callbacks.isCancelled()) return null;
    const end = Math.min(start + batchSize, transactionLines.length);
    const batchText = `${headerText}\n${transactionLines.slice(start, end).join("\n")}`;
    const result = parseRogalandStatementText(batchText, {
      ...options,
      idPrefix: `${options.idPrefix ?? "pdf"}-batch-${start}`,
    });
    if (result.ok) {
      transactions.push(...result.transactions);
    } else {
      errors.push(...result.errors
        .filter((error) => error.code !== "MISSING_TRANSACTION_SECTION")
        .map((error) => ({
          ...error,
          ...(error.lineNumber === undefined ? {} : { lineNumber: error.lineNumber + start }),
        })));
    }

    callbacks.onProgress(end, transactionLines.length);
    await new Promise<void>((resolveBatch) => setImmediate(resolveBatch));
  }

  if (callbacks.isCancelled()) return null;
  if (errors.length > 0) return { ok: false, errors };
  if (transactions.length === 0) return parseRogalandStatementText(text, options);

  transactions.sort((left, right) => {
    const dateComparison = right.bookedAtIso.localeCompare(left.bookedAtIso);
    if (dateComparison !== 0) return dateComparison;
    const amountComparison = left.amountMinor - right.amountMinor;
    if (amountComparison !== 0) return amountComparison;
    return left.merchantRaw.localeCompare(right.merchantRaw);
  });
  const idPrefix = options.idPrefix ?? "pdf";
  transactions.forEach((transaction, index) => {
    transaction.id = `${idPrefix}-${index + 1}`;
  });

  return { ok: true, adapterId: ROGALAND_ADAPTER_ID, transactions };
}
