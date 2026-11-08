import React from "react";
import type { DashboardViewContract } from "../../shared/dashboard.js";
import { categoryDisplayName } from "./categoryDisplayName.js";

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

  const { categoryBreakdown, categoryBreakdownByFlow } = viewContract.snapshot;

  return (
    <section aria-label="Category Breakdown">
      <h2>Category Breakdown</h2>
      {(viewContract.snapshot.currencyReport?.incompleteCurrencies.length ?? 0) > 0 && (
        <p className="field-help">Known NOK amounts only. Transactions missing dated exchange rates are excluded.</p>
      )}
      {categoryBreakdown.entries.length === 0 ? (
        <p>No category amounts can be converted to NOK yet.</p>
      ) : (
        <div className="category-breakdown-groups">
          <div className="category-breakdown-group" role="group" aria-label="Spending by category">
            <h3>Spending by category</h3>
            {categoryBreakdownByFlow.spending.entries.length === 0 ? (
              <p>No spending amounts are available for this month.</p>
            ) : (
              <ul className="financial-rows">
                {categoryBreakdownByFlow.spending.entries.map((entry) => {
                  const label = categoryDisplayName(entry.categoryId, entry.label);
                  return (
                    <li
                      key={entry.categoryId ?? "uncategorized"}
                      aria-label={`Spending category ${label}`}
                    >
                      <span>{label}</span>
                      <span className="financial-row-value">{formatMinor(entry.totalMinor)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="category-breakdown-group" role="group" aria-label="Money in by category">
            <h3>Money in by category</h3>
            {categoryBreakdownByFlow.inflows.entries.length === 0 ? (
              <p>No incoming amounts are available for this month.</p>
            ) : (
              <ul className="financial-rows">
                {categoryBreakdownByFlow.inflows.entries.map((entry) => {
                  const label = categoryDisplayName(entry.categoryId, entry.label);
                  return (
                    <li
                      key={entry.categoryId ?? "uncategorized"}
                      aria-label={`Money-in category ${label}`}
                    >
                      <span>{label}</span>
                      <span className="financial-row-value">{formatMinor(entry.totalMinor)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
