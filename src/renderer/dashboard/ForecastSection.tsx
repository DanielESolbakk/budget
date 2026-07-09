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
  return (
    <section aria-label="Forecast">
      <h2>Forecast</h2>
      {dashboardData.forecast.usedFallback ? (
        <p>Insufficient history: showing fallback forecast.</p>
      ) : (
        <p>Projected months from the local dashboard forecast.</p>
      )}
      <ul>
        {dashboardData.forecast.entries.map((entry) => (
          <li key={entry.yearMonth}>
            <strong>{entry.yearMonth}</strong>:{" "}
            <span aria-label={`Projected amount ${formatProjectedMinor(entry.projectedMinor)}`}>
              {formatProjectedMinor(entry.projectedMinor)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
