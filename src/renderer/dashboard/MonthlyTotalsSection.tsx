import React from "react";
import type { DashboardViewContract } from "../../app/dashboardApi.js";
import { formatCurrencyAmount } from "../formatCurrencyAmount.js";

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

function CashPlanningNavigation(): React.JSX.Element {
  return (
    <nav className="cash-planning-shortcuts" aria-label="Cash planning">
      <strong>Cash planning</strong>
      <a href="#spendable-cash">Estimate spendable cash</a>
      <a href="#cashflow-scenarios">Compare cashflow scenarios</a>
    </nav>
  );
}

export interface MonthlyTotalsSectionProps {
  viewContract: DashboardViewContract;
  refreshKey: number;
}

type LoadedDashboardViewContract = Exclude<DashboardViewContract, { state: "loading" }>;

export function MonthlyTotalsSection({ viewContract, refreshKey }: MonthlyTotalsSectionProps): React.JSX.Element {
  if (viewContract.state === "loading") {
    return (
      <section aria-label="Monthly Totals">
        <h2>Monthly Totals</h2>
        <p>Loading...</p>
      </section>
    );
  }

  if (viewContract.state === "empty") {
    return (
      <section aria-label="Monthly Totals">
        <h2>Monthly Totals</h2>
        <p>No transactions for this month.</p>
        <MonthlyComparisonSummary viewContract={viewContract} refreshKey={refreshKey} />
        <CashPlanningNavigation />
      </section>
    );
  }

  const { monthlyTotals, currencyReport } = viewContract.snapshot;
  const isIncomplete = (currencyReport?.incompleteCurrencies.length ?? 0) > 0;

  return (
    <section aria-label="Monthly Totals">
      <h2>Monthly Totals</h2>
      {isIncomplete && (
        <p className="currency-warning" role="status">
          <strong>Incomplete NOK subtotal.</strong> Missing dated rates: {currencyReport?.incompleteCurrencies.join(", ")}.
          {" "}Income, expenses and net include only amounts convertible to NOK.
          Record local rates in Household &gt; Exchange rates to complete this month.
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
        <div className="monthly-total" role="group" aria-label="Monthly net total">
          <dt>Monthly net</dt>
          <dd aria-label="Monthly net">{formatMinor(monthlyTotals.netMinor)}</dd>
        </div>
      </dl>
      <p className="monthly-net-meaning">
        Monthly net is this month&apos;s income minus expenses; it is not spendable cash until your next income.
      </p>
      <CashPlanningNavigation />
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
  | { status: "ready"; previousYearMonth: string; previousExpenseMinor: number; isIncomplete: boolean }
  | { status: "error"; previousYearMonth: string };

function MonthlyComparisonSummary({
  viewContract,
  refreshKey,
}: {
  viewContract: LoadedDashboardViewContract;
  refreshKey: number;
}): React.JSX.Element | null {
  const selectedYearMonth = viewContract.snapshot.selectedYearMonth;
  const year = Number(selectedYearMonth.slice(0, 4));
  const month = Number(selectedYearMonth.slice(5, 7));
  const previousMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const previousYearMonth = `${previousMonthDate.getUTCFullYear()}-${String(
    previousMonthDate.getUTCMonth() + 1
  ).padStart(2, "0")}`;
  const previousMonthLabel = new Intl.DateTimeFormat("nb-NO", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(previousMonthDate);
  const currentExpenseMinor = viewContract.snapshot.monthlyTotals.expenseMinor;
  const currentIsIncomplete = (viewContract.snapshot.currencyReport?.incompleteCurrencies.length ?? 0) > 0;
  const [retryCount, setRetryCount] = React.useState(0);
  const [comparison, setComparison] = React.useState<MonthlyComparisonState>({
    status: "loading",
    previousYearMonth,
  });

  React.useEffect(() => {
    let isActive = true;
    setComparison({ status: "loading", previousYearMonth });

    window.budgetApi.dashboard
      .getViewData(previousYearMonth)
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
        });
      })
      .catch(() => {
        if (isActive) setComparison({ status: "error", previousYearMonth });
      });

    return () => {
      isActive = false;
    };
  }, [previousYearMonth, refreshKey, retryCount]);

  const comparisonIsCurrent = comparison.previousYearMonth === previousYearMonth;
  const isLoading = !comparisonIsCurrent || comparison.status === "loading";

  return (
    <div
      className="monthly-comparison"
      role="group"
      aria-label="Monthly comparison"
      aria-busy={isLoading}
    >
      <h3>Month-to-month spending</h3>
      {isLoading ? (
        <p role="status">Loading previous-month comparison...</p>
      ) : comparison.status === "error" ? (
        <div role="alert">
          <p>Unable to load the previous-month comparison.</p>
          <button type="button" onClick={() => setRetryCount((count) => count + 1)}>
            Retry comparison
          </button>
        </div>
      ) : currentIsIncomplete || comparison.isIncomplete ? (
        <p role="status">Spending comparison is incomplete until missing dated exchange rates are recorded.</p>
      ) : (
        <p role="status">
          {currentExpenseMinor === comparison.previousExpenseMinor
            ? `Spending was unchanged at ${formatCurrencyAmount(currentExpenseMinor, "NOK")} compared with ${previousMonthLabel}.`
            : `Spending ${currentExpenseMinor > comparison.previousExpenseMinor ? "increased" : "decreased"} by ${
              formatCurrencyAmount(Math.abs(currentExpenseMinor - comparison.previousExpenseMinor), "NOK")
            } compared with ${previousMonthLabel} (from ${
              formatCurrencyAmount(comparison.previousExpenseMinor, "NOK")
            } to ${formatCurrencyAmount(currentExpenseMinor, "NOK")}).`}
        </p>
      )}
    </div>
  );
}
