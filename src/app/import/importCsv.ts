import type { CsvRowValidationError } from "../../domain/import/csvRowMapper.js";

/** Shape of a normalized import request passed from the renderer to the main process via IPC. */
export interface CsvImportRequest {
  filePath: string;
  householdId: string;
  accountId: string;
}

/** Returned when a CSV import completes without validation errors and transactions are persisted. */
export interface CsvImportSuccess {
  ok: true;
  importJobId: string;
  transactionCount: number;
}

/** Returned when a CSV import has validation errors and no transactions are persisted. */
export interface CsvImportFailure {
  ok: false;
  errors: Array<{
    rowIndex: number;
    fields: string[];
    codes: string[];
    messages: string[];
  }>;
}

/** Discriminated union returned by the `import:csv` IPC channel. */
export type CsvImportResponse = CsvImportSuccess | CsvImportFailure;

/**
 * Builds a normalized CsvImportRequest from a raw file path and household/account context.
 * Trims whitespace from the path and enforces required fields as non-empty strings.
 */
export function buildCsvImportRequest(
  filePath: string,
  options: { householdId: string; accountId: string }
): CsvImportRequest {
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
 * Converts validation errors from the CSV row-mapping layer into the stable
 * CsvImportFailure shape returned over IPC.
 */
export function normalizeCsvImportErrors(
  skipped: Array<{ rowIndex: number; errors: CsvRowValidationError[] }>
): CsvImportFailure {
  return {
    ok: false,
    errors: skipped.map(({ rowIndex, errors }) => ({
      rowIndex,
      fields: errors.map((e) => e.field),
      codes: errors.map((e) => e.code),
      messages: errors.map((e) => e.message),
    })),
  };
}
