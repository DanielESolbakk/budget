import { createHash } from "node:crypto";
import type {
  ImportedTransactionStatus,
  PendingTransactionObservation,
  SourceDocumentTextLineEvidence,
  Transaction,
} from "../types.js";

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
const BANK_EXPORT_DATE_LIKE_PREFIX_PATTERN = /^\s*\d{1,4}[./-]\d{1,4}[./-]\d{1,4}(?=\s)/;
const BANK_EXPORT_CONTINUATION_COLUMN_TOLERANCE = 8;
const BANK_EXPORT_PAGE_FOOTER_PATTERN = /^\s*\d+\s*\/\s*\d+\s+Rogaland Sparebank\s*$/i;
const BANK_EXPORT_SUMMARY_PATTERN = /^\s*(?:Total beløp|Totalt beløp|Inngående saldo|Utgående\s+saldo)\b/i;

export type PdfTextValidationErrorCode =
  | "UNSUPPORTED_LAYOUT"
  | "INVALID_TRANSACTION_ROW"
  | "UNSUPPORTED_TRANSACTION_STATUS"
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
  sourceRows: PdfTextSourceRow[];
  pendingObservations?: PendingTransactionObservation[];
  unresolvedRows?: PdfTextUnresolvedRow[];
  excludedRows?: PdfTextExcludedRow[];
}

export interface PdfTextSourceRow {
  lineNumber: number;
  amountMinor?: number;
  currencyCode?: string;
  candidateId?: string;
}

export interface PdfTextUnresolvedRow {
  lineNumber: number;
  rawRow: string;
  errors: PdfTextValidationError[];
  sourceEvidence?: SourceDocumentTextLineEvidence;
}

export interface PdfTextExcludedRow {
  lineNumber: number;
  status: "Reservert" | "Bekreftet";
  date: string;
  amount: string;
  currencyCode: string;
  description: string;
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
  return buildPdfImportContentDigest(text, options, ROGALAND_ADAPTER_ID);
}

export function buildPdfImportContentDigest(
  text: string,
  options: Pick<PdfTextParseOptions, "householdId" | "accountId">,
  adapterId: string
): string {
  const canonical = [
    adapterId,
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

function assignSortedTransactionIds(
  transactions: Transaction[],
  sourceRows: PdfTextSourceRow[],
  idPrefix: string
): void {
  const sourceRowsByCandidateId = new Map(
    sourceRows.flatMap((row) =>
      row.candidateId === undefined ? [] : [[row.candidateId, row] as const]
    )
  );
  transactions.forEach((transaction, index) => {
    const previousId = transaction.id;
    transaction.id = `${idPrefix}-${index + 1}`;
    const sourceRow = sourceRowsByCandidateId.get(previousId);
    if (sourceRow !== undefined) sourceRow.candidateId = transaction.id;
  });
}

/**
 * Returns true when the text content belongs to the Rogaland Sparebank adapter.
 * Used for source detection before parsing begins.
 */
export function isRogalandStatementText(text: string): boolean {
  return text.includes(ROGALAND_HEADER_TOKEN);
}

function parseBankExportMessage(
  rawMessage: string,
  fallbackDescription: string
): { description: string; sourceReference?: string } {
  const normalizedMessage = rawMessage.trim().replace(/\s+/g, " ");
  const labeledReferenceMatch =
    /\b(?:KID|REF(?:ERANSE|ERENCE)?|FAKT(?:URA)?\.?\s*NR\.?)\s*[:#]\s*([A-Z0-9][A-Z0-9._/-]*)\b/i.exec(
      normalizedMessage
    );
  const bareReferenceMatch = labeledReferenceMatch === null
    ? /\b(?:REF|KID)[-_][A-Z0-9][A-Z0-9._/-]*\b/i.exec(normalizedMessage) ??
      /^\d{6,}$/.exec(normalizedMessage)
    : null;
  const referenceMatch = labeledReferenceMatch ?? bareReferenceMatch;
  const sourceReference = labeledReferenceMatch?.[1] ?? bareReferenceMatch?.[0];
  const description =
    referenceMatch === null
      ? normalizedMessage
      : `${normalizedMessage.slice(0, referenceMatch.index)}${normalizedMessage.slice(
          referenceMatch.index + referenceMatch[0].length
        )}`
          .trim()
          .replace(/\s+/g, " ");

  return {
    description: description || fallbackDescription.trim().replace(/\s+/g, " "),
    ...(sourceReference === undefined ? {} : { sourceReference }),
  };
}

function mapBankTransactionStatus(status: string): ImportedTransactionStatus {
  const normalized = status
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized === "reservert") return "reserved";
  if (normalized === "bekreftet") return "confirmed";
  return "booked";
}

function buildPendingObservationId(prefix: string, sourceRowIndex: number): string {
  return `${prefix}-pending-${sourceRowIndex}`;
}

function pendingObservationIdPrefix(text: string, options: PdfTextParseOptions): string {
  return options.importJobId === undefined
    ? options.idPrefix ?? "pdf"
    : buildRogalandImportJobId(text, options);
}

interface BankExportRow {
  lineNumber: number;
  text: string;
}

function collectBankExportRows(lines: readonly string[], tableHeaderIndex: number): BankExportRow[] {
  const rows: BankExportRow[] = [];
  const typeColumnStart = lines[tableHeaderIndex]?.indexOf("Type") ?? -1;
  const fromAccountColumnStart = lines[tableHeaderIndex]?.indexOf("Fra konto") ?? -1;
  const messageColumnStart = lines[tableHeaderIndex]?.indexOf("Melding/KID/Fakt.nr") ?? -1;
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

    const lineNumber = tableHeaderIndex + index + 2;
    const firstNonWhitespaceIndex = line.search(/\S/);
    if (BANK_EXPORT_TRANSACTION_DATE_PATTERN.test(line)) {
      finishCurrentRow();
      currentRow = { lineNumber, text: trimmedLine };
    } else if (BANK_EXPORT_DATE_LIKE_PREFIX_PATTERN.test(line)) {
      finishCurrentRow();
      currentRow = { lineNumber, text: trimmedLine };
    } else if (
      currentRow !== undefined &&
      typeColumnStart !== -1 &&
      fromAccountColumnStart !== -1 &&
      firstNonWhitespaceIndex >= typeColumnStart &&
      firstNonWhitespaceIndex < fromAccountColumnStart - BANK_EXPORT_CONTINUATION_COLUMN_TOLERANCE
    ) {
      currentRow.text = currentRow.text.replace(
        /^(\d{2}\.\d{2}\.\d{4}\s+\S+)(?=\s)/,
        `$1 ${trimmedLine}`
      );
    } else if (
      currentRow !== undefined &&
      messageColumnStart !== -1 &&
      line.search(/\S/) >= messageColumnStart - BANK_EXPORT_CONTINUATION_COLUMN_TOLERANCE
    ) {
      currentRow.text = `${currentRow.text} ${trimmedLine}`;
    } else {
      finishCurrentRow();
      rows.push({ lineNumber, text: trimmedLine });
    }
  }

  finishCurrentRow();
  return rows;
}

function parseRogalandBankExport(
  lines: readonly string[],
  tableHeaderIndex: number,
  options: PdfTextParseOptions,
  allowExcludedOnly = false,
  pendingIdPrefix = options.importJobId ?? options.idPrefix ?? "pdf"
): PdfTextParseResult {
  const rows = collectBankExportRows(lines, tableHeaderIndex);
  const idPrefix = options.idPrefix ?? "pdf";
  const transactions: Transaction[] = [];
  const sourceRows: PdfTextSourceRow[] = [];
  const pendingObservations: PendingTransactionObservation[] = [];
  const excludedRows: PdfTextExcludedRow[] = [];
  const unresolvedRows: PdfTextUnresolvedRow[] = [];
  const errors: PdfTextValidationError[] = [];
  const bankExportRowPattern =
    /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+([+-]?\d[\d ]*,\d{2})\s+([A-Z]{3})\s+(Bokført|Reservert|Bekreftet)\s*(.*)$/i;

  for (const row of rows) {
    const sourceRow: PdfTextSourceRow = { lineNumber: row.lineNumber };
    sourceRows.push(sourceRow);
    const match = bankExportRowPattern.exec(row.text);
    if (match === null) {
      const sourceAmountMatch = /([+-]?\d[\d ]*,\d{2})\s+([A-Z]{3})\s+\S+/i.exec(row.text);
      if (sourceAmountMatch !== null) {
        sourceRow.currencyCode = sourceAmountMatch[2]!.toUpperCase();
        const sourceAmount = parseNorwegianAmount(sourceAmountMatch[1]!);
        if (sourceAmount !== null) sourceRow.amountMinor = toMinorUnits(sourceAmount);
      }
      const hasDateLikePrefix = BANK_EXPORT_DATE_LIKE_PREFIX_PATTERN.test(row.text);
      const hasValidDatePrefix = BANK_EXPORT_TRANSACTION_DATE_PATTERN.test(row.text);
      let error: PdfTextValidationError;
      if (hasDateLikePrefix && !hasValidDatePrefix) {
        error = {
          code: "INVALID_DATE_FORMAT",
          message: `Could not parse bank-export transaction date at line ${row.lineNumber}.`,
          lineNumber: row.lineNumber,
          field: "date",
        };
      } else if (hasValidDatePrefix) {
        error = {
          code: "INVALID_AMOUNT_FORMAT",
          message: `Could not parse bank-export transaction amount at line ${row.lineNumber}.`,
          lineNumber: row.lineNumber,
          field: "amount",
        };
      } else {
        error = {
          code: "INVALID_TRANSACTION_ROW",
          message: `Could not parse bank-export transaction row at line ${row.lineNumber}.`,
          lineNumber: row.lineNumber,
        };
      }
      errors.push(error);
      unresolvedRows.push({ lineNumber: row.lineNumber, rawRow: row.text, errors: [error] });
      continue;
    }

    const [, rawDate = "", prefix = "", rawAmount = "", currencyCode = "NOK", status = "", rawMessage = ""] = match;
    sourceRow.currencyCode = currencyCode;
    const sourceAmount = parseNorwegianAmount(rawAmount);
    if (sourceAmount !== null) sourceRow.amountMinor = toMinorUnits(sourceAmount);
    const importedStatus = mapBankTransactionStatus(status);
    const parsedMessage = parseBankExportMessage(rawMessage, prefix);
    if (importedStatus !== "booked") {
      const sourceStatus = importedStatus === "reserved" ? "Reservert" : "Bekreftet";
      excludedRows.push({
        lineNumber: row.lineNumber,
        status: sourceStatus,
        date: rawDate,
        amount: rawAmount,
        currencyCode,
        description: parsedMessage.description,
      });

      const transactionDateIso = parseNorwegianDate(rawDate);
      const amount = parseNorwegianAmount(rawAmount);
      if (transactionDateIso === null || amount === null) {
        const error: PdfTextValidationError = transactionDateIso === null
          ? {
              code: "INVALID_DATE_FORMAT",
              message: `Invalid bank-export transaction date at line ${row.lineNumber}.`,
              lineNumber: row.lineNumber,
              field: "date",
            }
          : {
              code: "INVALID_AMOUNT_FORMAT",
              message: `Invalid bank-export amount at line ${row.lineNumber}.`,
              lineNumber: row.lineNumber,
              field: "amount",
            };
        errors.push(error);
        unresolvedRows.push({ lineNumber: row.lineNumber, rawRow: row.text, errors: [error] });
        continue;
      }

      const sourceRowIndex = row.lineNumber - 1;
      pendingObservations.push({
        id: buildPendingObservationId(pendingIdPrefix, sourceRowIndex),
        householdId: options.householdId,
        accountId: options.accountId,
        transactionDateIso,
        amountMinor: toMinorUnits(amount),
        merchantRaw: parsedMessage.description,
        sourceRowIndex,
        currencyCode,
        sourceType: "pdf",
        status: importedStatus,
        sourceStatus,
        ...(parsedMessage.sourceReference === undefined
          ? {}
          : { sourceReference: parsedMessage.sourceReference }),
        ...(options.importJobId === undefined ? {} : { importJobId: options.importJobId }),
      });
      continue;
    }

    const bookedAtIso = parseNorwegianDate(rawDate);
    if (bookedAtIso === null) {
      const error: PdfTextValidationError = {
        code: "INVALID_DATE_FORMAT",
        message: `Invalid bank-export transaction date at line ${row.lineNumber}.`,
        lineNumber: row.lineNumber,
        field: "date",
      };
      errors.push(error);
      unresolvedRows.push({ lineNumber: row.lineNumber, rawRow: row.text, errors: [error] });
      continue;
    }

    const amount = parseNorwegianAmount(rawAmount);
    if (amount === null) {
      const error: PdfTextValidationError = {
        code: "INVALID_AMOUNT_FORMAT",
        message: `Invalid bank-export amount at line ${row.lineNumber}.`,
        lineNumber: row.lineNumber,
        field: "amount",
      };
      errors.push(error);
      unresolvedRows.push({ lineNumber: row.lineNumber, rawRow: row.text, errors: [error] });
      continue;
    }

    const merchantRaw = parsedMessage.description;
    if (merchantRaw.length === 0) {
      const error: PdfTextValidationError = {
        code: "MISSING_DESCRIPTION",
        message: `Missing bank-export description at line ${row.lineNumber}.`,
        lineNumber: row.lineNumber,
        field: "description",
      };
      errors.push(error);
      unresolvedRows.push({ lineNumber: row.lineNumber, rawRow: row.text, errors: [error] });
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
    if (parsedMessage.sourceReference !== undefined) {
      transaction.sourceReference = parsedMessage.sourceReference;
    }
    sourceRow.candidateId = transaction.id;
    transactions.push(transaction);
  }

  if (
    transactions.length === 0 &&
    pendingObservations.length === 0 &&
    unresolvedRows.length === 0 &&
    !(allowExcludedOnly && excludedRows.length > 0)
  ) {
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
  assignSortedTransactionIds(transactions, sourceRows, idPrefix);

  return {
    ok: true,
    adapterId: ROGALAND_ADAPTER_ID,
    transactions,
    sourceRows,
    ...(pendingObservations.length === 0 ? {} : { pendingObservations }),
    ...(unresolvedRows.length === 0 ? {} : { unresolvedRows }),
    ...(excludedRows.length === 0 ? {} : { excludedRows }),
  };
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
    return parseRogalandBankExport(
      lines,
      bankExportHeaderIndex,
      options,
      false,
      pendingObservationIdPrefix(text, options)
    );
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
  const sourceRows: PdfTextSourceRow[] = [];
  const unresolvedRows: PdfTextUnresolvedRow[] = [];
  let rowIndex = 0;

  for (const [transactionLineIndex, line] of transactionLines.entries()) {
    const lineNumber = tableHeaderIndex + transactionLineIndex + 2;
    const match = TRANSACTION_LINE_PATTERN.exec(line);
    if (!match) {
      let error: PdfTextValidationError | undefined;
      if (VALID_TRANSACTION_DATE_PREFIX_PATTERN.test(line)) {
        error = {
          code: "INVALID_AMOUNT_FORMAT",
          message: `Could not parse transaction line: "${line.trim()}"`,
          lineNumber,
          field: "amount",
        };
      } else if (TRANSACTION_DATE_LIKE_PREFIX_PATTERN.test(line)) {
        error = {
          code: "INVALID_DATE_FORMAT",
          message: `Could not parse transaction line: "${line.trim()}"`,
          lineNumber,
          field: "date",
        };
      }
      if (error !== undefined) {
        sourceRows.push({ lineNumber, currencyCode: "NOK" });
        unresolvedRows.push({ lineNumber, rawRow: line.trim(), errors: [error] });
      }
      continue;
    }

    const [, rawDate = "", rawDescription = "", rawAmount = ""] = match;
    const sourceRow: PdfTextSourceRow = { lineNumber, currencyCode: "NOK" };
    sourceRows.push(sourceRow);
    const sourceAmount = parseNorwegianAmount(rawAmount);
    if (sourceAmount !== null) sourceRow.amountMinor = toMinorUnits(sourceAmount);

    const bookedAtIso = parseNorwegianDate(rawDate);
    if (!bookedAtIso) {
      const error: PdfTextValidationError = {
        code: "INVALID_DATE_FORMAT",
        message: `Invalid date value "${rawDate}" on line: "${line.trim()}"`,
        lineNumber,
        field: "date",
      };
      unresolvedRows.push({ lineNumber, rawRow: line.trim(), errors: [error] });
      continue;
    }

    const description = rawDescription.trim();
    if (!description) {
      const error: PdfTextValidationError = {
        code: "MISSING_DESCRIPTION",
        message: `Missing description on line: "${line.trim()}"`,
        lineNumber,
        field: "description",
      };
      unresolvedRows.push({ lineNumber, rawRow: line.trim(), errors: [error] });
      continue;
    }

    const amount = parseNorwegianAmount(rawAmount);
    if (amount === null) {
      const error: PdfTextValidationError = {
        code: "INVALID_AMOUNT_FORMAT",
        message: `Invalid amount value "${rawAmount}" on line: "${line.trim()}"`,
        lineNumber,
        field: "amount",
      };
      unresolvedRows.push({ lineNumber, rawRow: line.trim(), errors: [error] });
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

    sourceRow.candidateId = transaction.id;
    transactions.push(transaction);
    rowIndex++;
  }

  if (transactions.length === 0 && unresolvedRows.length === 0) {
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

  assignSortedTransactionIds(transactions, sourceRows, idPrefix);

  return {
    ok: true,
    adapterId: ROGALAND_ADAPTER_ID,
    transactions,
    sourceRows,
    ...(unresolvedRows.length === 0 ? {} : { unresolvedRows }),
  };
}

export async function parseRogalandStatementTextInBatches(
  text: string,
  options: PdfTextParseOptions,
  callbacks: PdfTextParseBatchCallbacks
): Promise<PdfTextParseResult | null> {
  if (!isRogalandStatementText(text)) return parseRogalandStatementText(text, options);

  const lines = text.split(/\r?\n/);
  const bankExportHeaderIndex = lines.findIndex((line) =>
    BANK_EXPORT_TABLE_HEADER_PATTERN.test(line.trim())
  );
  if (bankExportHeaderIndex !== -1) {
    const rows = collectBankExportRows(lines, bankExportHeaderIndex);
    if (rows.length === 0) return parseRogalandStatementText(text, options);

    const batchSize = Math.max(1, Math.floor(callbacks.batchSize ?? 100));
    const pendingIdPrefix = pendingObservationIdPrefix(text, options);
    const transactions: Transaction[] = [];
    const sourceRows: PdfTextSourceRow[] = [];
    const pendingObservations: PendingTransactionObservation[] = [];
    const excludedRows: PdfTextExcludedRow[] = [];
    const unresolvedRows: PdfTextUnresolvedRow[] = [];
    const errors: PdfTextValidationError[] = [];

    for (let start = 0; start < rows.length; start += batchSize) {
      if (callbacks.isCancelled()) return null;
      const end = Math.min(start + batchSize, rows.length);
      const batchRows = rows.slice(start, end);
      const batchLines = [
        ...lines.slice(0, bankExportHeaderIndex + 1),
        ...batchRows.map((row) => row.text),
      ];
      const result = parseRogalandBankExport(batchLines, bankExportHeaderIndex, {
        ...options,
        idPrefix: `${options.idPrefix ?? "pdf"}-batch-${start}`,
      }, true, pendingIdPrefix);

      if (result.ok) {
        transactions.push(...result.transactions);
        for (const sourceAccountingRow of result.sourceRows) {
          const batchRowIndex = sourceAccountingRow.lineNumber - bankExportHeaderIndex - 2;
          const originalRow = rows[start + batchRowIndex];
          sourceRows.push({
            ...sourceAccountingRow,
            ...(originalRow === undefined ? {} : { lineNumber: originalRow.lineNumber }),
          });
        }
        for (const pendingObservation of result.pendingObservations ?? []) {
          const batchRowIndex = pendingObservation.sourceRowIndex - bankExportHeaderIndex - 1;
          const sourceRow = rows[start + batchRowIndex];
          pendingObservations.push(
            sourceRow === undefined
              ? pendingObservation
              : {
                  ...pendingObservation,
                  id: buildPendingObservationId(pendingIdPrefix, sourceRow.lineNumber - 1),
                  sourceRowIndex: sourceRow.lineNumber - 1,
                }
          );
        }
        for (const unresolvedRow of result.unresolvedRows ?? []) {
          const batchRowIndex = unresolvedRow.lineNumber - bankExportHeaderIndex - 2;
          const sourceRow = rows[start + batchRowIndex];
          unresolvedRows.push({
            ...unresolvedRow,
            ...(sourceRow === undefined ? {} : { lineNumber: sourceRow.lineNumber, rawRow: sourceRow.text }),
          });
        }
        for (const excludedRow of result.excludedRows ?? []) {
          const batchRowIndex = excludedRow.lineNumber - bankExportHeaderIndex - 2;
          const sourceRow = rows[start + batchRowIndex];
          excludedRows.push({
            ...excludedRow,
            ...(sourceRow === undefined ? {} : { lineNumber: sourceRow.lineNumber }),
          });
        }
      } else {
        errors.push(...result.errors
          .filter((error) => error.code !== "MISSING_TRANSACTION_SECTION")
          .map((error) => {
            const batchRowIndex = error.lineNumber === undefined
              ? undefined
              : error.lineNumber - bankExportHeaderIndex - 2;
            const sourceRow = batchRowIndex === undefined ? undefined : rows[start + batchRowIndex];
            return {
              ...error,
              ...(sourceRow === undefined ? {} : { lineNumber: sourceRow.lineNumber }),
            };
          }));
      }

      callbacks.onProgress(end, rows.length);
      await new Promise<void>((resolveBatch) => setImmediate(resolveBatch));
    }

    if (callbacks.isCancelled()) return null;
    if (errors.length > 0) return { ok: false, errors };
    if (
      transactions.length === 0 &&
      pendingObservations.length === 0 &&
      unresolvedRows.length === 0
    ) {
      return parseRogalandStatementText(text, options);
    }

    transactions.sort((left, right) =>
      right.bookedAtIso.localeCompare(left.bookedAtIso) ||
      left.amountMinor - right.amountMinor ||
      left.merchantRaw.localeCompare(right.merchantRaw)
    );
    const idPrefix = options.idPrefix ?? "pdf";
    assignSortedTransactionIds(transactions, sourceRows, idPrefix);

    return {
      ok: true,
      adapterId: ROGALAND_ADAPTER_ID,
      transactions,
      sourceRows,
      ...(pendingObservations.length === 0 ? {} : { pendingObservations }),
      ...(unresolvedRows.length === 0 ? {} : { unresolvedRows }),
      ...(excludedRows.length === 0 ? {} : { excludedRows }),
    };
  }

  const tableHeaderIndex = lines.findIndex((line) => /^Dato\s+Beskrivelse/.test(line.trim()));
  if (tableHeaderIndex === -1) return parseRogalandStatementText(text, options);

  const transactionLines = lines.slice(tableHeaderIndex + 1).filter((line) => line.trim().length > 0);
  if (transactionLines.length === 0) return parseRogalandStatementText(text, options);

  const batchSize = Math.max(1, Math.floor(callbacks.batchSize ?? 100));
  const headerText = lines.slice(0, tableHeaderIndex + 1).join("\n");
  const transactions: Transaction[] = [];
  const sourceRows: PdfTextSourceRow[] = [];
  const unresolvedRows: PdfTextUnresolvedRow[] = [];
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
      sourceRows.push(...result.sourceRows.map((row) => ({
        ...row,
        lineNumber: row.lineNumber + start,
      })));
      unresolvedRows.push(...(result.unresolvedRows ?? []).map((row) => ({
        ...row,
        lineNumber: row.lineNumber + start,
      })));
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
  if (transactions.length === 0 && unresolvedRows.length === 0) return parseRogalandStatementText(text, options);

  transactions.sort((left, right) => {
    const dateComparison = right.bookedAtIso.localeCompare(left.bookedAtIso);
    if (dateComparison !== 0) return dateComparison;
    const amountComparison = left.amountMinor - right.amountMinor;
    if (amountComparison !== 0) return amountComparison;
    return left.merchantRaw.localeCompare(right.merchantRaw);
  });
  const idPrefix = options.idPrefix ?? "pdf";
  assignSortedTransactionIds(transactions, sourceRows, idPrefix);

  return {
    ok: true,
    adapterId: ROGALAND_ADAPTER_ID,
    transactions,
    sourceRows,
    ...(unresolvedRows.length === 0 ? {} : { unresolvedRows }),
  };
}
