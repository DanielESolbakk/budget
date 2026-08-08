import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { Transaction } from "../../domain/types.js";
import { mapCsvRows, type CsvRowMappingOptions } from "../../domain/import/csvRowMapper.js";
import { parseFixtureCsv, rowsToObjects } from "../fixtures/fixtureCsv.js";
import {
  PERFORMANCE_HARNESS_BASELINE_POLICY,
  PERFORMANCE_HARNESS_CONTRACT_VERSION,
  PERFORMANCE_HARNESS_FIXTURE_DIGEST_ALGORITHM,
  PERFORMANCE_HARNESS_METRIC_KEYS,
  PERFORMANCE_HARNESS_NAME,
  PERFORMANCE_HARNESS_SOURCE_KIND,
  PERFORMANCE_HARNESS_WORKFLOW,
  type PerformanceHarnessMetrics,
  type PerformanceHarnessResult,
} from "./performanceHarnessContract.js";

export interface PerformanceHarnessOptions {
  fixturePath: string;
  projectRoot?: string;
  householdId?: string;
  accountId?: string;
  importJobId?: string;
  idPrefix?: string;
  iterationCount?: number;
}

const FIXTURE_DEFAULTS = {
  householdId: "hh-performance",
  accountId: "acc-performance",
  idPrefix: "backup-restore",
} as const;

function toPortableRelativePath(projectRoot: string, filePath: string): string {
  return relative(projectRoot, filePath).split(sep).join("/");
}

function resolveMappingOptions(options: PerformanceHarnessOptions): CsvRowMappingOptions {
  return {
    householdId: options.householdId ?? FIXTURE_DEFAULTS.householdId,
    accountId: options.accountId ?? FIXTURE_DEFAULTS.accountId,
    idPrefix: options.idPrefix ?? FIXTURE_DEFAULTS.idPrefix,
    ...(options.importJobId !== undefined ? { importJobId: options.importJobId } : {}),
  };
}

function sumIncomeMinor(transactions: Transaction[]): number {
  return transactions.reduce((total, transaction) => (
    transaction.amountMinor > 0 ? total + transaction.amountMinor : total
  ), 0);
}

function sumExpenseMinor(transactions: Transaction[]): number {
  return transactions.reduce((total, transaction) => (
    transaction.amountMinor < 0 ? total + Math.abs(transaction.amountMinor) : total
  ), 0);
}

function buildMetrics(
  rows: Array<Record<string, string>>,
  fixtureRowCount: number,
  options: CsvRowMappingOptions
): PerformanceHarnessMetrics {
  const importResult = mapCsvRows(rows, options);
  const transactions = importResult.transactions;
  const serializedTransactions = JSON.stringify(transactions);
  const restoredTransactions = JSON.parse(serializedTransactions) as Transaction[];
  const incomeMinorTotal = sumIncomeMinor(transactions);
  const expenseMinorTotal = sumExpenseMinor(transactions);

  return {
    fixtureRowCount,
    mappedTransactionCount: transactions.length,
    restoredTransactionCount: restoredTransactions.length,
    skippedRowCount: importResult.skipped.length,
    serializedByteLength: Buffer.byteLength(serializedTransactions, "utf8"),
    incomeMinorTotal,
    expenseMinorTotal,
    netMinorTotal: incomeMinorTotal - expenseMinorTotal,
    roundTripStable: JSON.stringify(restoredTransactions) === serializedTransactions,
  };
}

function describeMetricDifferences(
  expected: PerformanceHarnessMetrics,
  actual: PerformanceHarnessMetrics
): string {
  const differences = PERFORMANCE_HARNESS_METRIC_KEYS.filter((key) => expected[key] !== actual[key]);
  return differences.map((key) => `${key}: expected ${expected[key]}, received ${actual[key]}`).join("; ");
}

function normalizeFixtureTextForDigest(fixtureText: string): string {
  return fixtureText.replace(/\r\n/g, "\n");
}

export function createPerformanceHarness(options: PerformanceHarnessOptions): PerformanceHarnessResult {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const resolvedFixturePath = resolve(projectRoot, options.fixturePath);
  const fixtureText = readFileSync(resolvedFixturePath, "utf8");
  const normalizedFixtureText = normalizeFixtureTextForDigest(fixtureText);
  const parsedFixture = parseFixtureCsv(fixtureText);
  const rows = rowsToObjects(parsedFixture);
  const iterationCount = options.iterationCount ?? 2;

  if (!Number.isInteger(iterationCount)) {
    throw new Error(
      `Performance harness iterationCount must be an integer greater than zero, got non-integer value: ${iterationCount}`
    );
  }

  if (iterationCount <= 0) {
    throw new Error(
      `Performance harness iterationCount must be an integer greater than zero, got non-positive value: ${iterationCount}`
    );
  }

  const mappingOptions = resolveMappingOptions(options);
  const firstMetrics = buildMetrics(rows, parsedFixture.rows.length, mappingOptions);

  for (let iteration = 1; iteration < iterationCount; iteration += 1) {
    const repeatedMetrics = buildMetrics(rows, parsedFixture.rows.length, mappingOptions);
    if (JSON.stringify(repeatedMetrics) !== JSON.stringify(firstMetrics)) {
      throw new Error(
        `Performance harness contract diverged on iteration ${iteration + 1}: ${describeMetricDifferences(firstMetrics, repeatedMetrics)}`
      );
    }
  }

  return {
    metadata: {
      contractVersion: PERFORMANCE_HARNESS_CONTRACT_VERSION,
      contractKey: `${PERFORMANCE_HARNESS_NAME}:v${PERFORMANCE_HARNESS_CONTRACT_VERSION}`,
      harnessName: PERFORMANCE_HARNESS_NAME,
      workflowName: PERFORMANCE_HARNESS_WORKFLOW,
      sourceKind: PERFORMANCE_HARNESS_SOURCE_KIND,
      fixtureDigestAlgorithm: PERFORMANCE_HARNESS_FIXTURE_DIGEST_ALGORITHM,
      baselinePolicy: PERFORMANCE_HARNESS_BASELINE_POLICY,
      fixturePath: toPortableRelativePath(projectRoot, resolvedFixturePath),
      fixtureDigest: createHash("sha256").update(normalizedFixtureText).digest("hex"),
      iterationCount,
      noNetworkByDefault: true,
      metricKeys: [...PERFORMANCE_HARNESS_METRIC_KEYS],
    },
    metrics: firstMetrics,
  };
}
