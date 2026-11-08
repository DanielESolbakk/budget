import type { Transaction } from "../../domain/types.js";
import { mapCsvRows, type CsvImportResult, type CsvRowMappingOptions } from "../../domain/import/csvRowMapper.js";
import { readFixtureCsv, rowsToObjects } from "./fixtureCsv.js";

export interface FixtureTransactionOptions {
  householdId?: string;
  accountId?: string;
  importJobId?: string;
  idPrefix?: string;
}

const FIXTURE_DEFAULTS = {
  householdId: "hh-fixture",
  accountId: "acc-fixture",
  idPrefix: "fixture",
} as const;

function resolveOptions(options: FixtureTransactionOptions): CsvRowMappingOptions {
  return {
    householdId: options.householdId ?? FIXTURE_DEFAULTS.householdId,
    accountId: options.accountId ?? FIXTURE_DEFAULTS.accountId,
    idPrefix: options.idPrefix ?? FIXTURE_DEFAULTS.idPrefix,
    ...(options.importJobId !== undefined ? { importJobId: options.importJobId } : {}),
  };
}

/**
 * Reads a fixture CSV file and returns mapped transactions only when the full
 * fixture contains valid booked rows only; use importFixtureCsv for skipped
 * rows or pending observations.
 */
export function buildTransactionsFromFixturePath(
  filePath: string,
  options: FixtureTransactionOptions = {}
): Transaction[] {
  const parsed = readFixtureCsv(filePath);
  const rows = rowsToObjects(parsed);
  return buildTransactionsFromFixtureRows(rows, options);
}

/**
 * Maps valid booked rows only. Invalid, empty or pending input throws with
 * bounded mapper-index diagnostics (not physical CSV line numbers).
 * Use mapCsvRows for the full result.
 */
export function buildTransactionsFromFixtureRows(
  rows: Array<Record<string, string>>,
  options: FixtureTransactionOptions = {}
): Transaction[] {
  const result = mapCsvRows(rows, resolveOptions(options));
  if (result.skipped.length > 0) {
    const diagnostics = result.skipped.slice(0, 5).map(({ rowIndex, errors }) =>
      `mapper row ${rowIndex}: ${errors.slice(0, 3).map(({ code, field }) => `${code} (${field})`).join(", ")}`
    ).join("; ");
    throw new Error(`Fixture has ${result.skipped.length} invalid rows: ${diagnostics}. Use importFixtureCsv or mapCsvRows for the full result.`);
  }
  const pendingCount = result.pendingObservations?.length ?? 0;
  if (pendingCount > 0) {
    throw new Error(`Fixture has ${pendingCount} pending observations. Use importFixtureCsv or mapCsvRows for the full result.`);
  }
  return result.transactions;
}

/**
 * Returns the mapper's full result, including pending observations and skipped
 * rows. Invalid input retains the mapper's atomic empty-transaction contract.
 */
export function importFixtureCsv(
  filePath: string,
  options: FixtureTransactionOptions = {}
): CsvImportResult {
  const parsed = readFixtureCsv(filePath);
  const rows = rowsToObjects(parsed);
  return mapCsvRows(rows, resolveOptions(options));
}
