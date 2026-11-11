import React from "react";
import type { DashboardViewContract } from "../../shared/dashboard.js";
import {
  getAdjacentReportingPeriod,
  type ReportingPeriodRange,
} from "../../domain/date/reportingPeriods.js";
import { formatCurrencyAmount } from "../formatCurrencyAmount.js";
import { formatReportingPeriodRange } from "../reportingPeriodDisplay.js";
import { toLocalIsoDate } from "../../domain/date/localDateDefaults.js";

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

export interface MonthlyTotalsSectionProps {
  viewContract: DashboardViewContract;
  refreshKey: number;
  periodControls?: React.ReactNode;
  onOpenTransactions?: () => void;
  isChangingPeriod?: boolean;
}

type LoadedDashboardViewContract = Exclude<DashboardViewContract, { state: "loading" }>;

export function MonthlyTotalsSection({
  viewContract,
  refreshKey,
  periodControls,
  onOpenTransactions,
  isChangingPeriod = false,
}: MonthlyTotalsSectionProps): React.JSX.Element {
  const isPaydayPeriod = viewContract.state !== "loading" &&
    viewContract.snapshot.reportingPeriodRule.type !== "calendar-month";
  const sectionLabel = isPaydayPeriod ? "Payday-period totals" : "Monthly Totals";
  const heading = (
    <header className="monthly-totals-header">
      <h2>{sectionLabel}</h2>
      {periodControls}
    </header>
  );
  if (viewContract.state === "loading") {
    return (
      <section aria-label="Monthly Totals">
        {heading}
        <p>Loading...</p>
      </section>
    );
  }

  const { monthlyTotals, currencyReport } = viewContract.snapshot;
  const isIncomplete = (currencyReport?.incompleteCurrencies.length ?? 0) > 0;
  const netLabel = isPaydayPeriod ? "Period net" : "Monthly net";

  return (
    <section aria-label={sectionLabel}>
      {heading}
      {viewContract.state === "empty" && (
        <p className="rail-status is-empty-month" role="status" aria-label="Monthly activity">
          No activity has been recorded for {isPaydayPeriod ? "this period." : "this month."}
          {" "}Zero recorded totals do not establish that there was no spending.
        </p>
      )}
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
        Income minus expenses; not spendable cash until your next income.
      </p>
      <MonthlyComparisonSummary viewContract={viewContract} refreshKey={refreshKey} />
      <div className="monthly-report-actions">
        {onOpenTransactions !== undefined && (
          <button
            type="button"
            className="action-secondary"
            disabled={isChangingPeriod}
            onClick={onOpenTransactions}
          >
            View transactions for this period
          </button>
        )}
      </div>
      <p className="comparison-basis-note">Recorded transactions only. Statement coverage may be incomplete.</p>
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
  const previousMonthLabel = previousRange === null ? null : new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${previousRange.startDateIso}T00:00:00.000Z`));
  const previousPeriodLabel = previousRange === null
    ? null
    : isPaydayPeriod
      ? formatReportingPeriodRange(previousRange)
      : previousMonthLabel;
  const currentExpenseMinor = viewContract.snapshot.monthlyTotals.expenseMinor;
  const today = toLocalIsoDate(new Date());
  const isFuturePeriod = currentRange.startDateIso > today;
  const isInProgress = currentRange.startDateIso <= today && today < currentRange.endDateExclusiveIso;
  const currentIsIncomplete = (viewContract.snapshot.currencyReport?.incompleteCurrencies.length ?? 0) > 0;
  const [retryCount, setRetryCount] = React.useState(0);
  const [comparison, setComparison] = React.useState<MonthlyComparisonState>({
    status: "loading",
    previousYearMonth: previousYearMonth ?? selectedYearMonth,
  });

  React.useEffect(() => {
    let isActive = true;
    if (previousYearMonth === null || viewContract.state === "empty" || isFuturePeriod) {
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
  }, [previousPeriodStartDateIso, previousYearMonth, reportingPeriodRule, refreshKey, retryCount, viewContract.state, isFuturePeriod]);
  const comparisonIsCurrent = previousYearMonth !== null &&
    comparison.previousYearMonth === previousYearMonth;
  const isLoading = previousYearMonth !== null &&
    (!comparisonIsCurrent || comparison.status === "loading");

  if (viewContract.state === "empty" && !isFuturePeriod) return null;

  return (
    <div
      className="monthly-comparison"
      role="group"
      aria-label={isPaydayPeriod ? "Payday period comparison" : "Monthly comparison"}
      aria-busy={!isFuturePeriod && isLoading}
    >
      {isFuturePeriod ? (
        <p role="status">These dates are in the future. Totals show recorded transactions only, not a forecast.</p>
      ) : previousPeriodLabel === null ? (
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
        ) : viewContract.state === "empty" || comparison.isEmpty ? (
          <p role="status">
            No recorded activity {viewContract.state === "empty" ? "in the selected period" : `for ${previousPeriodLabel}`}.
            {" "}A spending change cannot be established from missing activity.
          </p>
        ) : (
          <>
            <p role="status">
              {isInProgress
                ? "This period is still in progress; it is not a like-for-like comparison with an ended period."
                : currentExpenseMinor === comparison.previousExpenseMinor
              ? `Spending was unchanged at ${formatCurrencyAmount(currentExpenseMinor, "NOK")} compared with ${previousPeriodLabel}.`
              : `Spending ${currentExpenseMinor > comparison.previousExpenseMinor ? "increased" : "decreased"} by ${
                formatCurrencyAmount(Math.abs(currentExpenseMinor - comparison.previousExpenseMinor), "NOK")
              } compared with ${previousPeriodLabel}.`}
            </p>
            <details className="comparison-details">
              <summary>Comparison details</summary>
              <dl className="period-spending-comparison">
                <div role="group" aria-label="Selected period spending">
                  <dt>Selected period · {isInProgress ? "In progress" : "Ended"}</dt>
                  <dd className="comparison-amount">{formatCurrencyAmount(currentExpenseMinor, "NOK")}</dd>
                  <dd className="comparison-dates">{formatReportingPeriodRange(currentRange)}</dd>
                </div>
                <div role="group" aria-label="Previous period spending">
                  <dt>Previous period · Ended</dt>
                  <dd className="comparison-amount">{formatCurrencyAmount(comparison.previousExpenseMinor, "NOK")}</dd>
                  <dd className="comparison-dates">{previousRange === null ? "" : formatReportingPeriodRange(previousRange)}</dd>
                </div>
              </dl>
            </details>
          </>
        )
      ) : (
        <p role="status">Loading {isPaydayPeriod ? "previous-period" : "previous-month"} comparison...</p>
      )}
    </div>
  );
}
