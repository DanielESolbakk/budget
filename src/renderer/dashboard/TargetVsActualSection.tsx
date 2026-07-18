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
      <section aria-label="Target vs Actual">
        <h2>Target vs Actual</h2>
        <p>Loading...</p>
      </section>
    );
  }

  const { rows } = viewContract.snapshot.targetVsActualCategoryRows;
  if (rows.length === 0) {
    return (
      <section aria-label="Target vs Actual">
        <h2>Target vs Actual</h2>
        <p>No target rows for this month.</p>
      </section>
    );
  }

  return (
    <section aria-label="Target vs Actual">
      <h2>Target vs Actual</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Target</th>
            <th>Actual</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.categoryId ?? "uncategorized"}>
              <td>{renderCategoryLabel(row.categoryId)}</td>
              <td>{renderTargetOrDelta(row.targetMinor)}</td>
              <td>{formatMinor(row.actualMinor)}</td>
              <td>{renderTargetOrDelta(row.deltaMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
