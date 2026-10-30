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

function renderTargetOrDelta(minor: number | null): string {
  if (minor === null) {
    return "No target";
  }

  return formatMinor(minor);
}

function renderCategoryLabel(categoryId: string | null): string {
  if (categoryId === null) {
    return "Uncategorized";
  }

  return categoryId;
}

export interface TargetVsActualSectionProps {
  viewContract: DashboardViewContract;
}

export function TargetVsActualSection({ viewContract }: TargetVsActualSectionProps): React.JSX.Element {
  if (viewContract.state === "loading") {
    return (
      <section id="target-vs-actual" aria-label="Target vs Actual" tabIndex={0}>
        <h2>Target vs Actual</h2>
        <p>Loading...</p>
      </section>
    );
  }

  const { rows } = viewContract.snapshot.targetVsActualCategoryRows;
  const isIncomplete = (viewContract.snapshot.currencyReport?.incompleteCurrencies.length ?? 0) > 0;
  if (rows.length === 0) {
    return (
      <section id="target-vs-actual" aria-label="Target vs Actual" tabIndex={0}>
        <h2>Target vs Actual</h2>
        {isIncomplete && (
          <p className="field-help">Actuals show known NOK amounts only. Deltas remain incomplete until missing dated rates are recorded.</p>
        )}
        <p>No target rows for this month.</p>
      </section>
    );
  }

  return (
    <section id="target-vs-actual" aria-label="Target vs Actual" tabIndex={0}>
      <h2>Target vs Actual</h2>
      {isIncomplete && (
        <p className="field-help">Actuals show known NOK amounts only. Deltas remain incomplete until missing dated rates are recorded.</p>
      )}
      <table className="target-vs-actual-table">
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Target</th>
            <th scope="col">Actual</th>
            <th scope="col">Delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.categoryId ?? "uncategorized"}>
              <td data-label="Category">{renderCategoryLabel(row.categoryId)}</td>
              <td data-label="Target">{renderTargetOrDelta(row.targetMinor)}</td>
              <td data-label="Actual">{formatMinor(row.actualMinor)}</td>
              <td data-label="Delta">{isIncomplete && row.targetMinor !== null ? "Incomplete" : renderTargetOrDelta(row.deltaMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
