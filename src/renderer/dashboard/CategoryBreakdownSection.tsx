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

export interface CategoryBreakdownSectionProps {
  viewContract: DashboardViewContract;
}

export function CategoryBreakdownSection({ viewContract }: CategoryBreakdownSectionProps): React.JSX.Element {
  if (viewContract.state === "loading") {
    return (
      <section aria-label="Category Breakdown">
        <h2>Category Breakdown</h2>
        <p>Loading...</p>
      </section>
    );
  }

  if (viewContract.state === "empty") {
    return (
      <section aria-label="Category Breakdown">
        <h2>Category Breakdown</h2>
        <p>No categories for this month.</p>
      </section>
    );
  }

  const { categoryBreakdown } = viewContract.snapshot;

  return (
    <section aria-label="Category Breakdown">
      <h2>Category Breakdown</h2>
      <ul className="financial-rows">
        {categoryBreakdown.entries.map((entry) => (
          <li
            key={entry.categoryId ?? "uncategorized"}
            aria-label={`Category ${entry.label}`}
          >
            <span>{entry.label}</span>
            <span className="financial-row-value">{formatMinor(entry.totalMinor)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
