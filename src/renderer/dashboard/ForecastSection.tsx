import React from "react";
import type { DashboardData } from "../../app/dashboardApi.js";

const MINOR_UNITS_PER_NOK = 100;
const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface ForecastSectionProps {
  dashboardData: DashboardData;
}

function formatProjectedMinor(projectedMinor: number): string {
  return nokCurrencyFormatter.format(projectedMinor / MINOR_UNITS_PER_NOK);
}

export function ForecastSection({ dashboardData }: ForecastSectionProps): React.JSX.Element {
  const recentMonths = dashboardData.monthlyTotals.slice(-3);
  const latestMonth = recentMonths.at(-1)?.yearMonth;
  const isIncomplete = recentMonths.some((month) =>
    dashboardData.incompleteCurrencyMonths?.includes(month.yearMonth)
  );
  return (
    <section aria-label="Forecast">
      <h2>Forecast</h2>
      <p className="field-help">
        Monthly net outlook: income minus expenses, not an account balance.
        {latestMonth === undefined ? " No recorded history yet." : ` Based on recorded history through ${latestMonth}.`}
        {" "}This outlook does not follow the review month selector.
      </p>
      {isIncomplete ? (
        <p className="currency-warning" role="status">
          Forecast unavailable: incomplete NOK history. Record missing dated exchange rates before relying on an outlook.
        </p>
      ) : <>
      {dashboardData.forecast.usedFallback ? (
        <p>Not enough recorded months yet; showing a zero-value fallback estimate.</p>
      ) : (
        <p>Estimated from the average of up to three recent monthly totals.</p>
      )}
      <ul className="financial-rows">
        {dashboardData.forecast.entries.map((entry) => (
          <li key={entry.yearMonth}>
            <strong>{entry.yearMonth}</strong>
            <span className="financial-row-value" aria-label={`Projected amount ${formatProjectedMinor(entry.projectedMinor)}`}>
              {formatProjectedMinor(entry.projectedMinor)}
            </span>
          </li>
        ))}
      </ul>
      </>}
    </section>
  );
}
