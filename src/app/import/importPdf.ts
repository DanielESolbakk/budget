import type { PdfTextValidationError } from "../../domain/import/pdfTextParser.js";

/** Shape of a normalized PDF import request passed from the renderer to the main process via IPC. */
export interface PdfImportRequest {
  filePath: string;
  householdId: string;
  accountId: string;
}

/** Returned when a PDF import completes without validation errors and transactions are persisted. */
export interface PdfImportSuccess {
  ok: true;
  importJobId: string;
  transactionCount: number;
  adapterId: string;
}

/** Returned when a PDF import has validation errors and no transactions are persisted. */
export interface PdfImportFailure {
  ok: false;
  errors: Array<{
    code: string;
    message: string;
  }>;
}

/** Discriminated union returned by the `import:pdf` IPC channel. */
export type PdfImportResponse = PdfImportSuccess | PdfImportFailure;

/**
 * Builds a normalized PdfImportRequest from a raw file path and household/account context.
 * Trims whitespace from the path and enforces required fields as non-empty strings.
 */
export function buildPdfImportRequest(
  filePath: string,
  options: { householdId: string; accountId: string }
): PdfImportRequest {
  const trimmedPath = filePath.trim();

  if (!trimmedPath) {
    throw new Error("filePath must be a non-empty string.");
  }

  if (!options.householdId.trim()) {
    throw new Error("householdId must be a non-empty string.");
  }

  if (!options.accountId.trim()) {
    throw new Error("accountId must be a non-empty string.");
  }

  return {
    filePath: trimmedPath,
    householdId: options.householdId,
    accountId: options.accountId,
  };
}

/**
 * Converts validation errors from the PDF parser into the stable
 * PdfImportFailure shape returned over IPC.
 */
export function normalizePdfImportErrors(
  errors: PdfTextValidationError[]
): PdfImportFailure {
  return {
    ok: false,
    errors: errors.map((e) => ({ code: e.code, message: e.message })),
  };
}
