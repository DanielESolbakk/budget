import React from "react";
import type { DashboardData } from "../../app/dashboardApi.js";

export interface ForecastSectionProps {
  dashboardData: DashboardData;
}

function formatProjectedMinor(projectedMinor: number): string {
  return `${(projectedMinor / 100).toFixed(2)} NOK`;
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
            <strong>{entry.yearMonth}</strong>: {formatProjectedMinor(entry.projectedMinor)}
          </li>
        ))}
      </ul>
    </section>
  );
}
