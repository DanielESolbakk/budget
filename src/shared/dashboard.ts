import {
  computeCategoryBreakdown,
  computeCategoryBreakdownForDateRange,
  type CategoryBreakdownFlow,
} from "../domain/aggregation/computeCategoryBreakdown.js";
import { computeDateRangeTotals, computeMonthlyTotals } from "../domain/aggregation/computeMonthlyTotals.js";
import { needsCategorizationReview } from "../domain/categorization/reviewQueue.js";
import {
  isIsoCalendarDate,
} from "../domain/date/calendarDate.js";
import {
  resolveReportingPeriodStartingOn,
  resolveReportingPeriod,
  type ReportingPeriodRange,
} from "../domain/date/reportingPeriods.js";
import {
  validateReportingPeriodRule,
  type ReportingPeriodRule,
} from "./applicationPreferences.js";
import { simpleForecast } from "../domain/forecast/simpleForecast.js";
import { convertCurrencyAmount } from "../domain/money/convertCurrencyAmount.js";
import type {
  Account,
  CategoryBreakdown,
  CurrencyCode,
  ExchangeRate,
  HoldingRecord,
  HoldingValuationSnapshot,
  LoanBalanceSnapshot,
  LoanRecord,
  MonthlyBreakdown,
  MonthlyCategoryTarget,
  MonthlyCategoryTargetInput,
  MonthlyCategoryTargetQuery,
  MonthlyTotal,
  MonthSeries,
  PropertyRecord,
  PropertyValuationSnapshot,
  TargetVsActualCategoryRow,
  TargetVsActualCategoryRows,
  Transaction,
} from "../domain/types.js";
import { isYearMonth, validateMonthlyCategoryTargetInput, validateMonthlyCategoryTargetQuery } from "../domain/types.js";
export { UNCATEGORIZED_LABEL } from "../domain/aggregation/computeCategoryBreakdown.js";
export type {
  CashflowScenarioRequest,
  CashflowScenarioResult,
} from "../domain/forecast/cashflowScenarios.js";
export {
  generateRecurringCommitmentOccurrences,
  getRecurringCommitmentPriceChange,
  validateRecurringCommitmentInput,
} from "../domain/forecast/recurringCommitments.js";
export type {
  SpendableUntilIncomeResult as SpendableCashEstimate,
} from "../domain/forecast/spendableUntilIncome.js";
export type { SpendableCashEstimateRequest } from "./spendableCashContracts.js";
export type { CategoryBreakdown, MonthlyBreakdown, MonthSeries, TargetVsActualCategoryRows };

export interface DashboardInput {
  monthlyTotals: MonthlyTotal[];
  forecastPeriods?: number;
  /** YYYY-MM month to begin fallback entries from when history is empty. Defaults to current UTC month. */
  fallbackStartYearMonth?: string;
}

export interface DashboardData extends MonthSeries {
  incompleteCurrencyMonths?: string[];
}

export interface MonthlyDashboardSnapshot {
  selectedYearMonth: string;
  reportingPeriodRule: ReportingPeriodRule;
  reportingPeriodRange: ReportingPeriodRange;
  categoryReviewCount: number;
  hasUncategorizedTransactions?: boolean;
  monthlyTotals: MonthlyBreakdown;
  categoryBreakdown: CategoryBreakdown;
  categoryBreakdownByFlow: {
    inflows: CategoryBreakdown;
    spending: CategoryBreakdown;
  };
  targetVsActualCategoryRows: TargetVsActualCategoryRows;
  currencyReport?: NokMonthlyReport;
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
  reportingPeriodRange?: ReportingPeriodRange;
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

export interface NokCurrencySubtotals {
  nativeSubtotals: Array<{ currencyCode: CurrencyCode; totalMinor: number }>;
  nokSubtotalMinor: number | null;
  partialNokSubtotalMinor: number;
  incompleteCurrencies: CurrencyCode[];
}

export interface NokMonthlyReport extends NokCurrencySubtotals {
  yearMonth: string;
  reportingPeriodRange?: ReportingPeriodRange;
  transactions: NokMonthlyReportTransaction[];
}

export interface NokValuationReportInput {
  valuationDateIso: string;
  properties: readonly PropertyRecord[];
  propertyValuations: readonly PropertyValuationSnapshot[];
  holdings: readonly HoldingRecord[];
  holdingValuations: readonly HoldingValuationSnapshot[];
  loans: readonly LoanRecord[];
  loanBalanceSnapshots: readonly LoanBalanceSnapshot[];
  rates: readonly ExchangeRate[];
  monthlyReferenceRateIds?: Readonly<Record<string, string>>;
}

export interface NokValuationReportEntry {
  id: string;
  label: string;
  valuationDateIso: string;
  nativeAmountMinor: number;
  nativeCurrencyCode: CurrencyCode;
  nokAmountMinor: number | null;
  exchangeRate: ExchangeRate | null;
  isEstimate: boolean;
}

export interface NokValuationReport {
  valuationDateIso: string;
  properties: NokValuationReportEntry[];
  holdings: NokValuationReportEntry[];
  liabilities: NokValuationReportEntry[];
  subtotals: {
    properties: NokCurrencySubtotals;
    holdings: NokCurrencySubtotals;
    liabilities: NokCurrencySubtotals;
  };
}

export interface DashboardViewContractInput {
  transactions: Transaction[];
  selectedYearMonth: string;
  selectedPeriodStartDateIso?: string;
  reportingPeriodRule?: ReportingPeriodRule;
  accounts?: readonly Account[];
  rates?: readonly ExchangeRate[];
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

interface NokSubtotalEntry {
  nativeAmountMinor: number;
  nativeCurrencyCode: CurrencyCode;
  nokAmountMinor: number | null;
}

function buildNokCurrencySubtotals(entries: readonly NokSubtotalEntry[]): NokCurrencySubtotals {
  const nativeTotals = new Map<CurrencyCode, number>();
  const incompleteCurrencies = new Set<CurrencyCode>();
  let partialNokSubtotalMinor = 0;

  for (const entry of entries) {
    const nativeTotal =
      (nativeTotals.get(entry.nativeCurrencyCode) ?? 0) + entry.nativeAmountMinor;
    if (!Number.isSafeInteger(nativeTotal)) {
      throw new RangeError(
        `Native ${entry.nativeCurrencyCode} subtotal exceeds the safe integer range.`
      );
    }
    nativeTotals.set(entry.nativeCurrencyCode, nativeTotal);

    if (entry.nokAmountMinor === null) {
      incompleteCurrencies.add(entry.nativeCurrencyCode);
      continue;
    }

    partialNokSubtotalMinor += entry.nokAmountMinor;
    if (!Number.isSafeInteger(partialNokSubtotalMinor)) {
      throw new RangeError("NOK report subtotal exceeds the safe integer range.");
    }
  }

  const nativeSubtotals = [...nativeTotals.entries()]
    .map(([currencyCode, totalMinor]) => ({ currencyCode, totalMinor }))
    .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));
  const sortedIncompleteCurrencies = [...incompleteCurrencies].sort((left, right) =>
    left.localeCompare(right)
  );

  return {
    nativeSubtotals,
    nokSubtotalMinor: sortedIncompleteCurrencies.length === 0 ? partialNokSubtotalMinor : null,
    partialNokSubtotalMinor,
    incompleteCurrencies: sortedIncompleteCurrencies,
  };
}

/**
 * Returns a deterministic category breakdown for a selected calendar month.
 * Entries are ordered by totalMinor descending; the uncategorized entry (if any) appears last.
 */
export function buildNokMonthlyReport(input: NokMonthlyReportInput): NokMonthlyReport {
  if (!isYearMonth(input.yearMonth)) {
    throw new Error(`Invalid NOK report yearMonth: ${input.yearMonth}`);
  }
  if (input.reportingPeriodRange !== undefined &&
    (!isIsoCalendarDate(input.reportingPeriodRange.startDateIso) ||
      !isIsoCalendarDate(input.reportingPeriodRange.endDateExclusiveIso) ||
      input.reportingPeriodRange.startDateIso >= input.reportingPeriodRange.endDateExclusiveIso)) {
    throw new Error("Invalid NOK report date range.");
  }

  const monthlyTransactions = input.transactions
    .filter((transaction) => {
      if (input.reportingPeriodRange === undefined) {
        return transaction.bookedAtIso.startsWith(input.yearMonth);
      }
      const bookedDate = transaction.bookedAtIso.slice(0, 10);
      if (!isIsoCalendarDate(bookedDate)) {
        throw new Error(`Invalid transaction date in NOK report: ${transaction.bookedAtIso}`);
      }
      return bookedDate >= input.reportingPeriodRange.startDateIso &&
        bookedDate < input.reportingPeriodRange.endDateExclusiveIso;
    });
  return {
    yearMonth: input.yearMonth,
    ...(input.reportingPeriodRange === undefined ? {} : { reportingPeriodRange: input.reportingPeriodRange }),
    ...buildNokTransactionReport({ ...input, transactions: monthlyTransactions }),
  };
}

export function buildNokTransactionReport(
  input: Pick<NokMonthlyReportInput, "transactions" | "accounts" | "rates" | "monthlyReferenceRateIds" | "useLatestRateScenario">
): NokCurrencySubtotals & { transactions: NokMonthlyReportTransaction[] } {
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const sortedTransactions = [...input.transactions].sort((left, right) =>
      left.bookedAtIso.localeCompare(right.bookedAtIso) ||
      left.id.localeCompare(right.id)
    );
  const transactions: NokMonthlyReportTransaction[] = [];

  for (const transaction of sortedTransactions) {
    const account = accountsById.get(transaction.accountId);
    if (account === undefined) {
      throw new Error(`Account not found for transaction ${transaction.id}.`);
    }
    const currencyCode = transaction.currencyCode ?? account.currencyCode;
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

  const subtotals = buildNokCurrencySubtotals(transactions);

  return {
    ...subtotals,
    transactions,
  };
}

export function queryCategoryBreakdown(
  transactions: Transaction[],
  yearMonth: string,
  flow: CategoryBreakdownFlow = "all"
): CategoryBreakdown {
  return computeCategoryBreakdown(transactions, yearMonth, flow);
}

export function queryMonthlyDashboardSnapshot(
  transactions: Transaction[],
  selectedYearMonth: string,
  monthlyCategoryTargetStore: MonthlyCategoryTargetStore = createMonthlyCategoryTargetStore(),
  currencyContext?: Pick<NokMonthlyReportInput, "accounts" | "rates">,
  reportingPeriodRule?: ReportingPeriodRule,
  selectedPeriodStartDateIso?: string
): MonthlyDashboardSnapshot {
  const rule = validateReportingPeriodRule(reportingPeriodRule ?? { type: "calendar-month" });
  if (
    selectedPeriodStartDateIso !== undefined &&
    selectedPeriodStartDateIso.slice(0, 7) !== selectedYearMonth
  ) {
    throw new RangeError("Reporting period start must belong to the selected month.");
  }
  const reportingPeriodRange = selectedPeriodStartDateIso === undefined
    ? resolveReportingPeriod(rule, selectedYearMonth)
    : resolveReportingPeriodStartingOn(rule, selectedPeriodStartDateIso);
  const reportingTransactions = transactions.filter((transaction) => {
    if (rule.type === "calendar-month") {
      return transaction.bookedAtIso.startsWith(selectedYearMonth);
    }
    const bookedDate = transaction.bookedAtIso.slice(0, 10);
    if (!isIsoCalendarDate(bookedDate)) {
      throw new Error(`Invalid transaction date in reporting period: ${transaction.bookedAtIso}`);
    }
    return bookedDate >= reportingPeriodRange.startDateIso &&
      bookedDate < reportingPeriodRange.endDateExclusiveIso;
  });
  if (currencyContext === undefined && reportingTransactions.some((transaction) =>
    transaction.currencyCode !== undefined && transaction.currencyCode !== "NOK"
  )) {
    throw new Error("Account and exchange-rate context is required for foreign-currency dashboard transactions.");
  }
  const currencyReport = currencyContext === undefined ? undefined : buildNokMonthlyReport({
    transactions: reportingTransactions,
    ...currencyContext,
    yearMonth: selectedYearMonth,
    ...(rule.type === "calendar-month" ? {} : { reportingPeriodRange }),
  });
  const sourceById = new Map(reportingTransactions.map((transaction) => [transaction.id, transaction]));
  const nokTransactions: Transaction[] = currencyReport === undefined ? transactions :
    currencyReport.transactions.flatMap((entry): Transaction[] => {
      if (entry.nokAmountMinor === null) return [];
      const source = sourceById.get(entry.transactionId);
      if (source === undefined) throw new Error(`Missing report transaction: ${entry.transactionId}`);
      let nativePrefixMinor = 0;
      let nokPrefixMinor = 0;
      const categoryAllocations = source.categoryAllocations?.map((allocation) => {
        nativePrefixMinor += allocation.amountMinor;
        const converted = convertCurrencyAmount({
          amountMinor: nativePrefixMinor,
          currencyCode: entry.nativeCurrencyCode,
          asOfDateIso: entry.bookedAtIso.slice(0, 10),
          rates: entry.exchangeRate === null ? [] : [entry.exchangeRate],
        });
        if (converted.state !== "converted") {
          throw new Error(`Missing allocation conversion for transaction: ${entry.transactionId}`);
        }
        // Round cumulative splits so their sum remains exactly the converted source amount.
        const amountMinor = converted.nokAmountMinor - nokPrefixMinor;
        nokPrefixMinor = converted.nokAmountMinor;
        return { ...allocation, amountMinor };
      });
      return [{
        ...source,
        amountMinor: entry.nokAmountMinor,
        currencyCode: "NOK",
        ...(categoryAllocations === undefined ? {} : { categoryAllocations }),
      }];
    });
  const dateRangeTotals = rule.type === "calendar-month" ? undefined :
    computeDateRangeTotals(
      nokTransactions,
      reportingPeriodRange.startDateIso,
      reportingPeriodRange.endDateExclusiveIso
    );
  return {
    selectedYearMonth,
    reportingPeriodRule: rule,
    reportingPeriodRange,
    categoryReviewCount: reportingTransactions.filter(needsCategorizationReview).length,
    monthlyTotals: dateRangeTotals === undefined
      ? queryMonthlyTotals(nokTransactions, selectedYearMonth)
      : {
        yearMonth: selectedYearMonth,
        incomeMinor: dateRangeTotals.incomeMinor,
        expenseMinor: dateRangeTotals.expenseMinor,
        netMinor: dateRangeTotals.netMinor,
      },
    categoryBreakdown: rule.type === "calendar-month"
      ? queryCategoryBreakdown(nokTransactions, selectedYearMonth)
      : computeCategoryBreakdownForDateRange(
        nokTransactions,
        reportingPeriodRange.startDateIso,
        reportingPeriodRange.endDateExclusiveIso
      ),
    categoryBreakdownByFlow: {
      inflows: rule.type === "calendar-month"
        ? queryCategoryBreakdown(nokTransactions, selectedYearMonth, "inflows")
        : computeCategoryBreakdownForDateRange(
          nokTransactions,
          reportingPeriodRange.startDateIso,
          reportingPeriodRange.endDateExclusiveIso,
          "inflows"
        ),
      spending: rule.type === "calendar-month"
        ? queryCategoryBreakdown(nokTransactions, selectedYearMonth, "spending")
        : computeCategoryBreakdownForDateRange(
          nokTransactions,
          reportingPeriodRange.startDateIso,
          reportingPeriodRange.endDateExclusiveIso,
          "spending"
        ),
    },
    targetVsActualCategoryRows: queryTargetVsActualCategoryRows(
      rule.type === "calendar-month" ? nokTransactions : [],
      rule.type === "calendar-month" ? monthlyCategoryTargetStore : createMonthlyCategoryTargetStore(),
      selectedYearMonth
    ),
    ...(currencyReport === undefined ? {} : {
      currencyReport,
      hasUncategorizedTransactions: reportingTransactions.some((transaction) =>
        transaction.categoryId === undefined && !transaction.categoryAllocations?.length
      ),
    }),
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
    hasUncategorizedTransactions: viewContract.snapshot.hasUncategorizedTransactions ??
      rows.some((row) => row.categoryId === null),
    categoryReviewCount: viewContract.snapshot.categoryReviewCount,
    overTargetCategoryCount: rows.filter(
      (row) => row.categoryId !== null && row.targetMinor !== null && row.deltaMinor !== null && row.deltaMinor > 0
    ).length,
  };
}

interface CorrectableValuationSnapshot {
  id: string;
  effectiveDateIso: string;
  recordedAtIso: string;
  correction?: { targetValuationId: string; action?: "supersede" | "void" };
}

function latestValuationAtDate<T extends CorrectableValuationSnapshot>(
  valuations: readonly T[],
  valuationDateIso: string
): T | undefined {
  const correctedValuationIds = new Set(
    valuations
      .filter((valuation) => valuation.effectiveDateIso <= valuationDateIso)
      .flatMap((valuation) =>
      valuation.correction === undefined ? [] : [valuation.correction.targetValuationId]
      )
  );
  return valuations
    .filter((valuation) =>
      valuation.effectiveDateIso <= valuationDateIso &&
      valuation.correction?.action !== "void" &&
      !correctedValuationIds.has(valuation.id)
    )
    .sort((left, right) =>
      right.effectiveDateIso.localeCompare(left.effectiveDateIso) ||
      right.recordedAtIso.localeCompare(left.recordedAtIso) ||
      left.id.localeCompare(right.id)
    )[0];
}

function buildNokValuationReportEntry(
  input: {
    id: string;
    label: string;
    valuationDateIso: string;
    amountMinor: number;
    currencyCode: CurrencyCode;
  },
  rates: readonly ExchangeRate[],
  monthlyReferenceRateIds: Readonly<Record<string, string>> = {}
): NokValuationReportEntry {
  const conversion = convertCurrencyAmount({
    amountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
    asOfDateIso: input.valuationDateIso,
    rates,
    ...(monthlyReferenceRateIds[input.currencyCode] === undefined
      ? {}
      : { monthlyReferenceRateId: monthlyReferenceRateIds[input.currencyCode] }),
  });
  return {
    id: input.id,
    label: input.label,
    valuationDateIso: input.valuationDateIso,
    nativeAmountMinor: input.amountMinor,
    nativeCurrencyCode: input.currencyCode,
    nokAmountMinor: conversion.nokAmountMinor,
    exchangeRate: conversion.exchangeRate,
    isEstimate: conversion.isEstimate,
  };
}

export function buildNokValuationReport(input: NokValuationReportInput): NokValuationReport {
  if (!isIsoCalendarDate(input.valuationDateIso)) {
    throw new Error(`Invalid NOK valuation report date: ${input.valuationDateIso}`);
  }

  const properties = input.properties
    .flatMap((property) => {
      const valuation = latestValuationAtDate(
        input.propertyValuations.filter((candidate) => candidate.propertyId === property.id),
        input.valuationDateIso
      );
      return valuation === undefined
        ? []
        : [buildNokValuationReportEntry({
            id: property.id,
            label: property.label,
            valuationDateIso: valuation.effectiveDateIso,
            amountMinor: valuation.amountMinor,
            currencyCode: valuation.currencyCode,
          }, input.rates, input.monthlyReferenceRateIds)];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const holdings = input.holdings
    .flatMap((holding) => {
      const valuation = latestValuationAtDate(
        input.holdingValuations.filter((candidate) => candidate.holdingId === holding.id),
        input.valuationDateIso
      );
      return valuation === undefined
        ? []
        : [buildNokValuationReportEntry({
            id: holding.id,
            label: holding.label,
            valuationDateIso: valuation.effectiveDateIso,
            amountMinor: valuation.amountMinor,
            currencyCode: valuation.currencyCode,
          }, input.rates, input.monthlyReferenceRateIds)];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const liabilities = input.loans
    .flatMap((loan) => {
      const balance = latestValuationAtDate(
        input.loanBalanceSnapshots.filter((candidate) => candidate.loanId === loan.id),
        input.valuationDateIso
      );
      return balance === undefined
        ? []
        : [buildNokValuationReportEntry({
            id: loan.id,
            label: loan.label,
            valuationDateIso: balance.effectiveDateIso,
            amountMinor: balance.amountMinor,
            currencyCode: balance.currencyCode,
          }, input.rates, input.monthlyReferenceRateIds)];
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    valuationDateIso: input.valuationDateIso,
    properties,
    holdings,
    liabilities,
    subtotals: {
      properties: buildNokCurrencySubtotals(properties),
      holdings: buildNokCurrencySubtotals(holdings),
      liabilities: buildNokCurrencySubtotals(liabilities),
    },
  };
}

export function buildDashboardViewContract(input: DashboardViewContractInput): DashboardViewContract {
  const {
    transactions,
    selectedYearMonth,
    selectedPeriodStartDateIso,
    reportingPeriodRule,
    monthlyCategoryTargetStore = createMonthlyCategoryTargetStore(),
    accounts,
    rates = [],
    isLoading = false,
  } = input;

  if (isLoading) {
    return { state: "loading", selectedYearMonth };
  }

  const snapshot = queryMonthlyDashboardSnapshot(
    transactions,
    selectedYearMonth,
    monthlyCategoryTargetStore,
    accounts === undefined ? undefined : { accounts, rates },
    reportingPeriodRule,
    selectedPeriodStartDateIso
  );

  if (snapshot.categoryBreakdown.entries.length === 0 && !snapshot.currencyReport?.transactions.length) {
    return { state: "empty", snapshot };
  }

  return { state: "ready", snapshot };
}

export function refreshDashboardViewContractMonth(
  transactions: Transaction[],
  nextSelectedYearMonth: string,
  monthlyCategoryTargetStore?: MonthlyCategoryTargetStore,
  currencyContext?: Pick<NokMonthlyReportInput, "accounts" | "rates">,
): DashboardViewContract {
  return buildDashboardViewContract({
    transactions,
    selectedYearMonth: nextSelectedYearMonth,
    ...currencyContext,
    ...(monthlyCategoryTargetStore === undefined ? {} : { monthlyCategoryTargetStore }),
  });
}