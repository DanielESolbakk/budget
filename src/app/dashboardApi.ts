import { computeCategoryBreakdown } from "../domain/aggregation/computeCategoryBreakdown.js";
import { computeMonthlyTotals } from "../domain/aggregation/computeMonthlyTotals.js";
import { needsCategorizationReview } from "../domain/categorization/reviewQueue.js";
import { assessAccountCoverage } from "../domain/ledger/accountCoverage.js";
import { convertCurrencyAmount } from "../domain/money/convertCurrencyAmount.js";
import { simpleForecast } from "../domain/forecast/simpleForecast.js";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import type {
  Account,
  AccountCoverageAssessment,
  AccountCoverageAssessmentInput,
  CategoryBreakdown,
  CurrencyCode,
  ExchangeRate,
  MonthlyCategoryTarget,
  MonthlyCategoryTargetInput,
  MonthlyCategoryTargetQuery,
  MonthlyBreakdown,
  MonthlyTotal,
  MonthSeries,
  TargetVsActualCategoryRow,
  TargetVsActualCategoryRows,
  Transaction,
} from "../domain/types.js";
import {
  isYearMonth,
  validateMonthlyCategoryTargetInput,
  validateMonthlyCategoryTargetQuery,
} from "../domain/types.js";

export type { CategoryBreakdown, MonthlyBreakdown, MonthSeries };
export { UNCATEGORIZED_LABEL } from "../domain/aggregation/computeCategoryBreakdown.js";
export type { TargetVsActualCategoryRows };

export interface DashboardInput {
  monthlyTotals: MonthlyTotal[];
  forecastPeriods?: number;
  /** YYYY-MM month to begin fallback entries from when history is empty. Defaults to current UTC month. */
  fallbackStartYearMonth?: string;
}

/** Alias for the canonical MonthSeries domain type; used as the output of buildDashboardData. */
export type DashboardData = MonthSeries;

export interface MonthlyDashboardSnapshot {
  selectedYearMonth: string;
  categoryReviewCount: number;
  monthlyTotals: MonthlyBreakdown;
  categoryBreakdown: CategoryBreakdown;
  targetVsActualCategoryRows: TargetVsActualCategoryRows;
}

export interface LoadingDashboardViewContract {
  state: "loading";
  selectedYearMonth: string;
}

export interface ReadyDashboardViewContract {
  state: "ready";
  snapshot: MonthlyDashboardSnapshot;
}

export interface EmptyDashboardViewContract {
  state: "empty";
  snapshot: MonthlyDashboardSnapshot;
}

export type DashboardViewContract =
  | LoadingDashboardViewContract
  | ReadyDashboardViewContract
  | EmptyDashboardViewContract;

export interface MonthlyAttentionSummary {
  hasUncategorizedTransactions: boolean;
  categoryReviewCount: number;
  overTargetCategoryCount: number;
}

export interface NokMonthlyReportInput {
  transactions: readonly Transaction[];
  accounts: readonly Account[];
  rates: readonly ExchangeRate[];
  yearMonth: string;
  monthlyReferenceRateIds?: Readonly<Record<string, string>>;
  useLatestRateScenario?: boolean;
}

export interface NokMonthlyReportTransaction {
  transactionId: string;
  bookedAtIso: string;
  merchantRaw: string;
  nativeAmountMinor: number;
  nativeCurrencyCode: CurrencyCode;
  nokAmountMinor: number | null;
  exchangeRate: ExchangeRate | null;
  isEstimate: boolean;
  isScenarioRestatement: boolean;
}

export interface NokMonthlyReport {
  yearMonth: string;
  nativeSubtotals: Array<{ currencyCode: CurrencyCode; totalMinor: number }>;
  nokSubtotalMinor: number | null;
  partialNokSubtotalMinor: number;
  incompleteCurrencies: CurrencyCode[];
  transactions: NokMonthlyReportTransaction[];
}

type AccountCoverageQuerySource = Pick<
  LocalLedgerDatabase,
  | "loadLedgerSnapshotData"
  | "listAccountStatementCoveragePeriods"
  | "listAccountBalanceCheckpoints"
  | "getTransactionsForAccount"
  | "listPendingTransactionObservations"
>;

export function queryAccountCoverageAssessment(
  database: AccountCoverageQuerySource,
  periodId: string,
  evaluatedAtIso: string
): AccountCoverageAssessment {
  const snapshot = database.loadLedgerSnapshotData();
  const period = (snapshot.accountStatementCoveragePeriods ?? [])
    .find((candidate) => candidate.id === periodId);
  if (period === undefined) {
    throw new Error(`Account statement coverage period not found: ${periodId}`);
  }
  const account = snapshot.accounts.find((candidate) => candidate.id === period.accountId);
  if (account === undefined) {
    throw new Error(`Account not found: ${period.accountId}`);
  }

  const input: AccountCoverageAssessmentInput = {
    period,
    relatedPeriods: database.listAccountStatementCoveragePeriods(period.accountId),
    checkpoints: database.listAccountBalanceCheckpoints(period.accountId),
    transactions: database.getTransactionsForAccount(period.accountId),
    pendingObservations: database.listPendingTransactionObservations(account.householdId),
    importJobs: snapshot.importJobs,
    evaluatedAtIso,
  };
  return assessAccountCoverage(input);
}

export interface DashboardViewContractInput {
  transactions: Transaction[];
  selectedYearMonth: string;
  monthlyCategoryTargetStore?: MonthlyCategoryTargetStore;
  isLoading?: boolean;
}

export interface MonthlyCategoryTargetStore {
  targetsByMonthAndCategory: Map<string, MonthlyCategoryTarget>;
}

/** Builds the internal composite key `${yearMonth}::${categoryId}` for deterministic target lookup. */
function toTargetKey(query: MonthlyCategoryTargetQuery): string {
  return `${query.yearMonth}::${query.categoryId}`;
}

/** Returns a defensive copy so callers cannot mutate persisted target state through references. */
function cloneTarget(target: MonthlyCategoryTarget): MonthlyCategoryTarget {
  return {
    yearMonth: target.yearMonth,
    categoryId: target.categoryId,
    targetMinor: target.targetMinor,
  };
}

/** Creates an in-memory target store, validating and loading optional initial monthly targets. */
export function createMonthlyCategoryTargetStore(
  initialTargets: MonthlyCategoryTarget[] = []
): MonthlyCategoryTargetStore {
  const targetsByMonthAndCategory = new Map<string, MonthlyCategoryTarget>();

  for (const target of initialTargets) {
    const validated = validateMonthlyCategoryTargetInput(target);
    const key = toTargetKey({ yearMonth: validated.yearMonth, categoryId: validated.categoryId });
    targetsByMonthAndCategory.set(key, cloneTarget(validated));
  }

  return { targetsByMonthAndCategory };
}

/** Creates a new monthly category target; throws if a target already exists for the same month/category. */
export function createMonthlyCategoryTarget(
  store: MonthlyCategoryTargetStore,
  input: MonthlyCategoryTargetInput
): MonthlyCategoryTarget {
  const validated = validateMonthlyCategoryTargetInput(input);
  const query = { yearMonth: validated.yearMonth, categoryId: validated.categoryId };
  const key = toTargetKey(query);
  if (store.targetsByMonthAndCategory.has(key)) {
    throw new Error(`Monthly target already exists for ${validated.yearMonth}/${validated.categoryId}`);
  }

  const persisted = cloneTarget(validated);
  store.targetsByMonthAndCategory.set(key, persisted);
  return cloneTarget(persisted);
}

/** Updates an existing monthly category target; throws when the target does not already exist. */
export function updateMonthlyCategoryTarget(
  store: MonthlyCategoryTargetStore,
  input: MonthlyCategoryTargetInput
): MonthlyCategoryTarget {
  const validated = validateMonthlyCategoryTargetInput(input);
  const query = { yearMonth: validated.yearMonth, categoryId: validated.categoryId };
  const key = toTargetKey(query);
  if (!store.targetsByMonthAndCategory.has(key)) {
    throw new Error(`Monthly target is missing for ${validated.yearMonth}/${validated.categoryId}`);
  }

  const persisted = cloneTarget(validated);
  store.targetsByMonthAndCategory.set(key, persisted);
  return cloneTarget(persisted);
}

/** Reads a target by month/category and returns null when no persisted target exists. */
export function readMonthlyCategoryTarget(
  store: MonthlyCategoryTargetStore,
  query: MonthlyCategoryTargetQuery
): MonthlyCategoryTarget | null {
  const validated = validateMonthlyCategoryTargetQuery(query);
  const target = store.targetsByMonthAndCategory.get(toTargetKey(validated));
  return target ? cloneTarget(target) : null;
}

/** Reloads all targets for a month, returning rows sorted by categoryId for stable deterministic ordering. */
export function reloadMonthlyCategoryTargets(
  store: MonthlyCategoryTargetStore,
  yearMonth: string
): MonthlyCategoryTarget[] {
  if (!isYearMonth(yearMonth)) {
    throw new Error(`Invalid target reload yearMonth: ${yearMonth}`);
  }

  const rows: MonthlyCategoryTarget[] = [];

  for (const target of store.targetsByMonthAndCategory.values()) {
    if (target.yearMonth === yearMonth) {
      rows.push(cloneTarget(target));
    }
  }

  rows.sort((a, b) => a.categoryId.localeCompare(b.categoryId));
  return rows;
}

/**
 * Composes deterministic target-vs-actual rows for the selected month.
 * Rows include explicit target/actual/delta fields, with target/delta set to null for no-target categories.
 * Category rows are sorted by categoryId ascending, with uncategorized actuals appended last.
 */
export function queryTargetVsActualCategoryRows(
  transactions: Transaction[],
  store: MonthlyCategoryTargetStore,
  selectedYearMonth: string
): TargetVsActualCategoryRows {
  if (!isYearMonth(selectedYearMonth)) {
    throw new Error(`Invalid target-vs-actual yearMonth: ${selectedYearMonth}`);
  }

  // queryCategoryBreakdown reports absolute totals for both income and expense transactions.
  const monthlyBreakdown = queryCategoryBreakdown(transactions, selectedYearMonth);
  const monthlyTargets = reloadMonthlyCategoryTargets(store, selectedYearMonth);
  const actualByCategoryId = new Map<string | null, number>();
  const targetByCategoryId = new Map<string, number>();

  for (const entry of monthlyBreakdown.entries) {
    actualByCategoryId.set(entry.categoryId, entry.totalMinor);
  }

  for (const target of monthlyTargets) {
    targetByCategoryId.set(target.categoryId, target.targetMinor);
  }

  const categorizedIds = new Set<string>();
  for (const categoryId of actualByCategoryId.keys()) {
    if (categoryId !== null) {
      categorizedIds.add(categoryId);
    }
  }
  for (const categoryId of targetByCategoryId.keys()) {
    categorizedIds.add(categoryId);
  }

  const sortedCategoryIds = Array.from(categorizedIds).sort((a, b) => a.localeCompare(b));
  const rows: TargetVsActualCategoryRow[] = [];

  for (const categoryId of sortedCategoryIds) {
    const actualMinor = actualByCategoryId.get(categoryId) ?? 0;
    const targetMinor = targetByCategoryId.get(categoryId) ?? null;
    rows.push({
      categoryId,
      targetMinor,
      actualMinor,
      deltaMinor: targetMinor === null ? null : actualMinor - targetMinor,
    });
  }

  if (actualByCategoryId.has(null)) {
    const uncategorizedActual = actualByCategoryId.get(null) ?? 0;
    rows.push({
      categoryId: null,
      targetMinor: null,
      actualMinor: uncategorizedActual,
      deltaMinor: null,
    });
  }

  return {
    yearMonth: selectedYearMonth,
    rows,
  };
}

/**
 * Builds the dashboard data contract, composing historical monthly totals with
 * a deterministic forecast.  Existing totals are passed through unchanged so
 * that adding forecast output cannot break existing totals or category flows.
 */
export function buildDashboardData(input: DashboardInput): DashboardData {
  const { monthlyTotals, forecastPeriods, fallbackStartYearMonth } = input;
  const forecast = simpleForecast(monthlyTotals, forecastPeriods, fallbackStartYearMonth);
  return { monthlyTotals, forecast };
}

/**
 * Returns deterministic income, expense, and net totals for a selected calendar month.
 * Only transactions whose bookedAtIso falls within the given YYYY-MM month are included.
 */
export function queryMonthlyTotals(
  transactions: Transaction[],
  yearMonth: string
): MonthlyBreakdown {
  return computeMonthlyTotals(transactions, yearMonth);
}

/**
 * Returns a deterministic category breakdown for a selected calendar month.
 * Entries are ordered by totalMinor descending; the uncategorized entry (if any) appears last.
 */
export function buildNokMonthlyReport(input: NokMonthlyReportInput): NokMonthlyReport {
  if (!isYearMonth(input.yearMonth)) {
    throw new Error(`Invalid NOK report yearMonth: ${input.yearMonth}`);
  }

  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const monthlyTransactions = input.transactions
    .filter((transaction) => transaction.bookedAtIso.startsWith(input.yearMonth))
    .sort((left, right) =>
      left.bookedAtIso.localeCompare(right.bookedAtIso) ||
      left.id.localeCompare(right.id)
    );
  const nativeTotals = new Map<CurrencyCode, number>();
  const incompleteCurrencies = new Set<CurrencyCode>();
  const transactions: NokMonthlyReportTransaction[] = [];
  let partialNokSubtotalMinor = 0;

  for (const transaction of monthlyTransactions) {
    const account = accountsById.get(transaction.accountId);
    if (account === undefined) {
      throw new Error(`Account not found for transaction ${transaction.id}.`);
    }
    const currencyCode = transaction.currencyCode ?? account.currencyCode;
    const nativeTotal = (nativeTotals.get(currencyCode) ?? 0) + transaction.amountMinor;
    if (!Number.isSafeInteger(nativeTotal)) {
      throw new RangeError(`Native ${currencyCode} subtotal exceeds the safe integer range.`);
    }
    nativeTotals.set(
      currencyCode,
      nativeTotal
    );
    const conversion = convertCurrencyAmount({
      amountMinor: transaction.amountMinor,
      currencyCode,
      asOfDateIso: transaction.bookedAtIso.slice(0, 10),
      rates: input.rates,
      ...(input.monthlyReferenceRateIds?.[currencyCode] === undefined
        ? {}
        : { monthlyReferenceRateId: input.monthlyReferenceRateIds[currencyCode] }),
      ...(input.useLatestRateScenario === undefined
        ? {}
        : { useLatestRateScenario: input.useLatestRateScenario }),
    });

    if (conversion.state === "incomplete") {
      incompleteCurrencies.add(currencyCode);
    } else {
      partialNokSubtotalMinor += conversion.nokAmountMinor;
      if (!Number.isSafeInteger(partialNokSubtotalMinor)) {
        throw new RangeError("NOK report subtotal exceeds the safe integer range.");
      }
    }

    transactions.push({
      transactionId: transaction.id,
      bookedAtIso: transaction.bookedAtIso,
      merchantRaw: transaction.merchantRaw,
      nativeAmountMinor: transaction.amountMinor,
      nativeCurrencyCode: currencyCode,
      nokAmountMinor: conversion.nokAmountMinor,
      exchangeRate: conversion.exchangeRate,
      isEstimate: conversion.isEstimate,
      isScenarioRestatement: conversion.isScenarioRestatement,
    });
  }

  const nativeSubtotals = [...nativeTotals.entries()]
    .map(([currencyCode, totalMinor]) => ({ currencyCode, totalMinor }))
    .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));
  const sortedIncompleteCurrencies = [...incompleteCurrencies].sort((left, right) =>
    left.localeCompare(right)
  );

  return {
    yearMonth: input.yearMonth,
    nativeSubtotals,
    nokSubtotalMinor: sortedIncompleteCurrencies.length === 0 ? partialNokSubtotalMinor : null,
    partialNokSubtotalMinor,
    incompleteCurrencies: sortedIncompleteCurrencies,
    transactions,
  };
}

export function queryCategoryBreakdown(
  transactions: Transaction[],
  yearMonth: string
): CategoryBreakdown {
  return computeCategoryBreakdown(transactions, yearMonth);
}

export function queryMonthlyDashboardSnapshot(
  transactions: Transaction[],
  selectedYearMonth: string,
  monthlyCategoryTargetStore: MonthlyCategoryTargetStore = createMonthlyCategoryTargetStore()
): MonthlyDashboardSnapshot {
  return {
    selectedYearMonth,
    categoryReviewCount: transactions.filter((transaction) =>
      transaction.bookedAtIso.startsWith(selectedYearMonth) && needsCategorizationReview(transaction)
    ).length,
    monthlyTotals: queryMonthlyTotals(transactions, selectedYearMonth),
    categoryBreakdown: queryCategoryBreakdown(transactions, selectedYearMonth),
    targetVsActualCategoryRows: queryTargetVsActualCategoryRows(
      transactions,
      monthlyCategoryTargetStore,
      selectedYearMonth
    ),
  };
}

export function getMonthlyAttentionSummary(
  viewContract: DashboardViewContract
): MonthlyAttentionSummary | null {
  if (viewContract.state === "loading") {
    return null;
  }

  const rows = viewContract.snapshot.targetVsActualCategoryRows.rows;
  return {
    hasUncategorizedTransactions: rows.some((row) => row.categoryId === null),
    categoryReviewCount: viewContract.snapshot.categoryReviewCount,
    overTargetCategoryCount: rows.filter(
      (row) => row.categoryId !== null && row.targetMinor !== null && row.deltaMinor !== null && row.deltaMinor > 0
    ).length,
  };
}

export function buildDashboardViewContract(input: DashboardViewContractInput): DashboardViewContract {
  const {
    transactions,
    selectedYearMonth,
    monthlyCategoryTargetStore = createMonthlyCategoryTargetStore(),
    isLoading = false,
  } = input;

  if (isLoading) {
    return { state: "loading", selectedYearMonth };
  }

  const snapshot = queryMonthlyDashboardSnapshot(
    transactions,
    selectedYearMonth,
    monthlyCategoryTargetStore
  );

  if (snapshot.categoryBreakdown.entries.length === 0) {
    return { state: "empty", snapshot };
  }

  return { state: "ready", snapshot };
}

export function refreshDashboardViewContractMonth(
  transactions: Transaction[],
  nextSelectedYearMonth: string,
  monthlyCategoryTargetStore?: MonthlyCategoryTargetStore
): DashboardViewContract {
  if (monthlyCategoryTargetStore) {
    return buildDashboardViewContract({
      transactions,
      selectedYearMonth: nextSelectedYearMonth,
      monthlyCategoryTargetStore,
    });
  }

  return buildDashboardViewContract({
    transactions,
    selectedYearMonth: nextSelectedYearMonth,
  });
}
