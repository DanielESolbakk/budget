import React from "react";
import type { DashboardViewContract } from "../../shared/dashboard.js";
import {
  getAdjacentReportingPeriod,
  type ReportingPeriodRange,
} from "../../domain/date/reportingPeriods.js";
import { formatCurrencyAmount } from "../formatCurrencyAmount.js";
import { formatReportingPeriodRange } from "../reportingPeriodDisplay.js";

const MINOR_UNITS_PER_NOK = 100;
const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMinor(minor: number): string {
  return nokCurrencyFormatter.format(minor / MINOR_UNITS_PER_NOK);
}

function CashPlanningNavigation({
  onOpenPlanningTools,
}: {
  onOpenPlanningTools: () => void;
}): React.JSX.Element {
  return (
    <nav className="cash-planning-shortcuts" aria-label="Cash planning">
      <strong>Cash planning</strong>
      <a href="#spendable-cash" onClick={onOpenPlanningTools}>Estimate spendable cash</a>
      <a href="#cashflow-scenarios" onClick={onOpenPlanningTools}>Compare cashflow scenarios</a>
    </nav>
  );
}

export interface MonthlyTotalsSectionProps {
  viewContract: DashboardViewContract;
  refreshKey: number;
  onOpenPlanningTools: () => void;
}

type LoadedDashboardViewContract = Exclude<DashboardViewContract, { state: "loading" }>;

export function MonthlyTotalsSection({
  viewContract,
  refreshKey,
  onOpenPlanningTools,
}: MonthlyTotalsSectionProps): React.JSX.Element {
  if (viewContract.state === "loading") {
    return (
      <section aria-label="Monthly Totals">
        <h2>Monthly Totals</h2>
        <p>Loading...</p>
      </section>
    );
  }

  if (viewContract.state === "empty") {
    const isPaydayPeriod = viewContract.snapshot.reportingPeriodRule.type !== "calendar-month";
    const sectionLabel = isPaydayPeriod ? "Payday-period totals" : "Monthly Totals";
    return (
      <section aria-label={sectionLabel}>
        <h2>{sectionLabel}</h2>
        <MonthlyComparisonSummary viewContract={viewContract} refreshKey={refreshKey} />
        <CashPlanningNavigation onOpenPlanningTools={onOpenPlanningTools} />
      </section>
    );
  }

  const { monthlyTotals, currencyReport } = viewContract.snapshot;
  const isIncomplete = (currencyReport?.incompleteCurrencies.length ?? 0) > 0;
  const isPaydayPeriod = viewContract.snapshot.reportingPeriodRule.type !== "calendar-month";
  const sectionLabel = isPaydayPeriod ? "Payday-period totals" : "Monthly Totals";
  const netLabel = isPaydayPeriod ? "Period net" : "Monthly net";

  return (
    <section aria-label={sectionLabel}>
      <h2>{sectionLabel}</h2>
      {isIncomplete && (
        <p className="currency-warning" role="status">
          <strong>Incomplete NOK subtotal.</strong> Missing dated rates: {currencyReport?.incompleteCurrencies.join(", ")}.
          {" "}Income, expenses and net include only amounts convertible to NOK.
          Record local rates in Household &gt; Settings &gt; Exchange rates to complete this period.
        </p>
      )}
      <dl>
        <div className="monthly-total" role="group" aria-label="Income total">
          <dt>Income</dt>
          <dd aria-label="Income">{formatMinor(monthlyTotals.incomeMinor)}</dd>
        </div>
        <div className="monthly-total" role="group" aria-label="Expenses total">
          <dt>Expenses</dt>
          <dd aria-label="Expenses">{formatMinor(monthlyTotals.expenseMinor)}</dd>
        </div>
        <div className="monthly-total" role="group" aria-label={`${netLabel} total`}>
          <dt>{netLabel}</dt>
          <dd aria-label={netLabel}>{formatMinor(monthlyTotals.netMinor)}</dd>
        </div>
      </dl>
      <p className="monthly-net-meaning">
        {isPaydayPeriod
          ? "Period net is this reporting period's income minus expenses; it is not spendable cash until your next income."
          : "Monthly net is this month's income minus expenses; it is not spendable cash until your next income."}
      </p>
      <CashPlanningNavigation onOpenPlanningTools={onOpenPlanningTools} />
      <MonthlyComparisonSummary viewContract={viewContract} refreshKey={refreshKey} />
      {currencyReport?.nativeSubtotals.some((subtotal) => subtotal.currencyCode !== "NOK") && (
        <div className="native-currency-subtotals">
          <h3>Native net subtotals</h3>
          <p>Original amounts, kept separate by currency. Never added across currencies.</p>
          <ul className="financial-rows" aria-label="Native currency subtotals">
            {currencyReport.nativeSubtotals.map((subtotal) => (
              <li key={subtotal.currencyCode}>
                <span>{subtotal.currencyCode}</span>
                <span className="financial-row-value">
                  {formatCurrencyAmount(subtotal.totalMinor, subtotal.currencyCode)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type MonthlyComparisonState =
  | { status: "loading"; previousYearMonth: string }
  | { status: "ready"; previousYearMonth: string; previousExpenseMinor: number; isIncomplete: boolean; isEmpty: boolean }
  | { status: "error"; previousYearMonth: string };

function MonthlyComparisonSummary({
  viewContract,
  refreshKey,
}: {
  viewContract: LoadedDashboardViewContract;
  refreshKey: number;
}): React.JSX.Element | null {
  const selectedYearMonth = viewContract.snapshot.selectedYearMonth;
  const reportingPeriodRule = viewContract.snapshot.reportingPeriodRule;
  const currentRange = viewContract.snapshot.reportingPeriodRange;
  const previousRange: ReportingPeriodRange | null = currentRange.startDateIso.startsWith("0000-01")
    ? null
    : getAdjacentReportingPeriod(reportingPeriodRule, currentRange.startDateIso, "previous");
  const isPaydayPeriod = reportingPeriodRule.type !== "calendar-month";
  const previousYearMonth = previousRange?.startDateIso.slice(0, 7) ?? null;
  const previousPeriodStartDateIso = isPaydayPeriod ? previousRange?.startDateIso : undefined;
  const year = Number(selectedYearMonth.slice(0, 4));
  const month = Number(selectedYearMonth.slice(5, 7));
  const previousMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const previousMonthLabel = new Intl.DateTimeFormat("nb-NO", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(previousMonthDate);
  const previousPeriodLabel = previousRange === null
    ? null
    : isPaydayPeriod
      ? formatReportingPeriodRange(previousRange)
      : previousMonthLabel;
  const currentExpenseMinor = viewContract.snapshot.monthlyTotals.expenseMinor;
  const currentIsIncomplete = (viewContract.snapshot.currencyReport?.incompleteCurrencies.length ?? 0) > 0;
  const [retryCount, setRetryCount] = React.useState(0);
  const [comparison, setComparison] = React.useState<MonthlyComparisonState>({
    status: "loading",
    previousYearMonth: previousYearMonth ?? selectedYearMonth,
  });

  React.useEffect(() => {
    let isActive = true;
    if (previousYearMonth === null) {
      return () => {
        isActive = false;
      };
    }

    setComparison({ status: "loading", previousYearMonth });

    window.budgetApi.dashboard
      .getViewData(previousYearMonth, reportingPeriodRule, previousPeriodStartDateIso)
      .then((previousView) => {
        if (!isActive) return;
        if (previousView.state === "loading") {
          setComparison({ status: "error", previousYearMonth });
          return;
        }
        setComparison({
          status: "ready",
          previousYearMonth,
          previousExpenseMinor: previousView.snapshot.monthlyTotals.expenseMinor,
          isIncomplete: (previousView.snapshot.currencyReport?.incompleteCurrencies.length ?? 0) > 0,
          isEmpty: previousView.state === "empty",
        });
      })
      .catch(() => {
        if (isActive) setComparison({ status: "error", previousYearMonth });
      });

    return () => {
      isActive = false;
    };
  }, [previousPeriodStartDateIso, previousYearMonth, reportingPeriodRule, refreshKey, retryCount]);
  const comparisonIsCurrent = previousYearMonth !== null &&
    comparison.previousYearMonth === previousYearMonth;
  const isLoading = previousYearMonth !== null &&
    (!comparisonIsCurrent || comparison.status === "loading");

  return (
    <div
      className="monthly-comparison"
      role="group"
      aria-label={isPaydayPeriod ? "Payday period comparison" : "Monthly comparison"}
      aria-busy={isLoading}
    >
      <h3>{isPaydayPeriod ? "Previous payday period" : "Month-to-month spending"}</h3>
      {previousPeriodLabel === null ? (
        <p role="status">No previous reporting period is available.</p>
      ) : isLoading ? (
        <p role="status">Loading {isPaydayPeriod ? "previous-period" : "previous-month"} comparison...</p>
      ) : comparison.status === "error" ? (
        <div role="alert">
          <p>Unable to load the {isPaydayPeriod ? "previous-period" : "previous-month"} comparison.</p>
          <button type="button" onClick={() => setRetryCount((count) => count + 1)}>
            Retry comparison
          </button>
        </div>
      ) : comparison.status === "ready" ? (
        currentIsIncomplete || comparison.isIncomplete ? (
          <p role="status">Spending comparison is incomplete until missing dated exchange rates are recorded.</p>
        ) : viewContract.state === "empty" && comparison.isEmpty ? (
          <p role="status">No activity to compare with {previousPeriodLabel}.</p>
        ) : (
          <p role="status">
            {currentExpenseMinor === comparison.previousExpenseMinor
              ? `Spending was unchanged at ${formatCurrencyAmount(currentExpenseMinor, "NOK")} compared with ${previousPeriodLabel}.`
              : `Spending ${currentExpenseMinor > comparison.previousExpenseMinor ? "increased" : "decreased"} by ${
                formatCurrencyAmount(Math.abs(currentExpenseMinor - comparison.previousExpenseMinor), "NOK")
              } compared with ${previousPeriodLabel} (from ${
                formatCurrencyAmount(comparison.previousExpenseMinor, "NOK")
              } to ${formatCurrencyAmount(currentExpenseMinor, "NOK")}).`}
          </p>
        )
      ) : (
        <p role="status">Loading {isPaydayPeriod ? "previous-period" : "previous-month"} comparison...</p>
      )}
    </div>
  );
}
