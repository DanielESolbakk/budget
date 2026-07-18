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
 * Reads a fixture CSV file and returns only the successfully mapped transactions.
 * Rows that fail validation are silently dropped; use importFixtureCsv when skipped rows matter.
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
 * Maps pre-parsed fixture row objects to transactions.
 * Rows that fail validation are silently dropped; use mapCsvRows when skipped rows matter.
 */
export function buildTransactionsFromFixtureRows(
  rows: Array<Record<string, string>>,
  options: FixtureTransactionOptions = {}
): Transaction[] {
  const result = mapCsvRows(rows, resolveOptions(options));
  return result.transactions;
}

/**
 * Reads a fixture CSV file and returns the full CsvImportResult including skipped rows.
 * Use when tests need to inspect both valid transactions and validation failures.
 */
export function importFixtureCsv(
  filePath: string,
  options: FixtureTransactionOptions = {}
): CsvImportResult {
  const parsed = readFixtureCsv(filePath);
  const rows = rowsToObjects(parsed);
  return mapCsvRows(rows, resolveOptions(options));
}
