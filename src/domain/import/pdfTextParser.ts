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
  /^(\d{2}\.\d{2}\.\d{4})\s{2,}(.+?)\s{2,}([+-]?\d[\d\s]*,\d{2})\s/;
const VALID_TRANSACTION_DATE_PREFIX_PATTERN = /^\s*\d{2}\.\d{2}\.\d{4}(?=\s)/;
const TRANSACTION_DATE_LIKE_PREFIX_PATTERN = /^\s*\d{1,4}[./-]\d{1,4}[./-]\d{1,4}(?=\s)/;

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

  for (const line of transactionLines) {
    const match = TRANSACTION_LINE_PATTERN.exec(line);
    if (!match) {
      if (VALID_TRANSACTION_DATE_PREFIX_PATTERN.test(line)) {
        errors.push({
          code: "INVALID_AMOUNT_FORMAT",
          message: `Could not parse transaction line: "${line.trim()}"`,
        });
      } else if (TRANSACTION_DATE_LIKE_PREFIX_PATTERN.test(line)) {
        errors.push({
          code: "INVALID_DATE_FORMAT",
          message: `Could not parse transaction line: "${line.trim()}"`,
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
      });
      continue;
    }

    const description = rawDescription.trim();
    if (!description) {
      errors.push({
        code: "MISSING_DESCRIPTION",
        message: `Missing description on line: "${line.trim()}"`,
      });
      continue;
    }

    const amount = parseNorwegianAmount(rawAmount);
    if (amount === null) {
      errors.push({
        code: "INVALID_AMOUNT_FORMAT",
        message: `Invalid amount value "${rawAmount}" on line: "${line.trim()}"`,
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

  return {
    ok: true,
    adapterId: ROGALAND_ADAPTER_ID,
    transactions,
  };
}
