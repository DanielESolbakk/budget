import { assessAccountCoverage } from "../domain/ledger/accountCoverage.js";
import type { AccountCoverageAssessment, AccountCoverageAssessmentInput } from "../domain/types.js";
import { resolveReportingPeriod } from "../domain/date/reportingPeriods.js";
import { validateReportingPeriodRule, type ReportingPeriodRule } from "../shared/applicationPreferences.js";
import {
  buildDashboardData,
  buildNokValuationReport,
  buildDashboardViewContract,
  createMonthlyCategoryTargetStore,
  queryMonthlyDashboardSnapshot,
  type DashboardData,
  type DashboardViewContract,
  type MonthlyCategoryTargetStore,
  type NokValuationReport,
} from "../shared/dashboard.js";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
export * from "../shared/dashboard.js";

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

export function queryHouseholdDashboardData(
  database: Pick<LocalLedgerDatabase,
    "getAccountsForHousehold" | "listExchangeRates" | "listMonthlyTotals" | "getTransactionsForMonth">,
  householdId: string,
): DashboardData {
  const currencyContext = {
    accounts: database.getAccountsForHousehold(householdId),
    rates: database.listExchangeRates(),
  };
  const snapshots = database.listMonthlyTotals(householdId).map(({ yearMonth }) =>
    queryMonthlyDashboardSnapshot(
      database.getTransactionsForMonth(householdId, yearMonth),
      yearMonth,
      undefined,
      currencyContext,
    )
  );
  return {
    ...buildDashboardData({
      monthlyTotals: snapshots.map((snapshot) => ({
        yearMonth: snapshot.selectedYearMonth,
        totalMinor: snapshot.monthlyTotals.netMinor,
      })),
    }),
    incompleteCurrencyMonths: snapshots
      .filter((snapshot) => snapshot.currencyReport?.incompleteCurrencies.length)
      .map((snapshot) => snapshot.selectedYearMonth),
  };
}

export function queryHouseholdDashboardView(
  database: Pick<LocalLedgerDatabase,
    | "getReportingPeriodRule"
    | "getTransactionsForDateRange"
    | "getAccountsForHousehold"
    | "listExchangeRates"
  >,
  householdId: string,
  selectedYearMonth: string,
  reportingPeriodRule?: ReportingPeriodRule,
  monthlyCategoryTargetStore: MonthlyCategoryTargetStore = createMonthlyCategoryTargetStore()
): DashboardViewContract {
  const rule = validateReportingPeriodRule(
    reportingPeriodRule ?? database.getReportingPeriodRule(householdId)
  );
  const range = resolveReportingPeriod(rule, selectedYearMonth);
  return buildDashboardViewContract({
    transactions: database.getTransactionsForDateRange(
      householdId,
      range.startDateIso,
      range.endDateExclusiveIso
    ),
    selectedYearMonth,
    reportingPeriodRule: rule,
    accounts: database.getAccountsForHousehold(householdId),
    rates: database.listExchangeRates(),
    monthlyCategoryTargetStore,
  });
}

export function queryNokValuationReport(
  database: Pick<LocalLedgerDatabase, "loadLedgerSnapshotData" | "listExchangeRates">,
  valuationDateIso: string,
  monthlyReferenceRateIds?: Readonly<Record<string, string>>
): NokValuationReport {
  const snapshot = database.loadLedgerSnapshotData();
  return buildNokValuationReport({
    valuationDateIso,
    properties: snapshot.properties ?? [],
    propertyValuations: snapshot.propertyValuations ?? [],
    holdings: snapshot.holdings ?? [],
    holdingValuations: snapshot.holdingValuations ?? [],
    loans: snapshot.loanRecords ?? [],
    loanBalanceSnapshots: snapshot.loanBalanceSnapshots ?? [],
    rates: database.listExchangeRates(),
    ...(monthlyReferenceRateIds === undefined ? {} : { monthlyReferenceRateIds }),
  });
}
