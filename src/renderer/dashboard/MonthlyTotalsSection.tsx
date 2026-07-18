import React from "react";
import type { DashboardViewContract } from "../../app/dashboardApi.js";

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

  const { monthlyTotals } = viewContract.snapshot;

  return (
    <section aria-label="Monthly Totals">
      <h2>Monthly Totals</h2>
      <dl>
        <dt>Income</dt>
        <dd aria-label="Income">{formatMinor(monthlyTotals.incomeMinor)}</dd>
        <dt>Expenses</dt>
        <dd aria-label="Expenses">{formatMinor(monthlyTotals.expenseMinor)}</dd>
        <dt>Net</dt>
        <dd aria-label="Net">{formatMinor(monthlyTotals.netMinor)}</dd>
      </dl>
    </section>
  );
}
