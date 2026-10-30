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

export interface MonthlyTotalsSectionProps {
  viewContract: DashboardViewContract;
}

export function MonthlyTotalsSection({ viewContract }: MonthlyTotalsSectionProps): React.JSX.Element {
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
        <div className="monthly-total" role="group" aria-label="Net total">
          <dt>Net</dt>
          <dd aria-label="Net">{formatMinor(monthlyTotals.netMinor)}</dd>
        </div>
      </dl>
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
