import React from "react";
import type { DashboardViewContract } from "../../shared/dashboard.js";
import { categoryDisplayName } from "./categoryDisplayName.js";
import { formatNokAmountMinor } from "../formatNokAmountMinor.js";

function renderTarget(minor: number | null): string {
  if (minor === null) {
    return "No target";
  }

  return formatNokAmountMinor(minor);
}

function renderDifference(minor: number | null): string {
  if (minor === null) return "No target";
  if (minor === 0) return "At target";
  return `${formatNokAmountMinor(Math.abs(minor))} ${minor > 0 ? "over" : "under"} target`;
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
          <p className="field-help">Actuals show known NOK amounts only. Over/under target amounts remain incomplete until missing dated rates are recorded.</p>
        )}
        <p>No target rows for this month.</p>
      </section>
    );
  }

  return (
    <section id="target-vs-actual" aria-label="Target vs Actual" tabIndex={0}>
      <h2>Target vs Actual</h2>
      <p className="field-help">
        Actual is the recorded category amount for this month. Over target means actual is higher than the target;
        under target means it is lower.
      </p>
      {isIncomplete && (
        <p className="field-help">Actuals show known NOK amounts only. Over/under target amounts remain incomplete until missing dated rates are recorded.</p>
      )}
      <table className="target-vs-actual-table">
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Target</th>
            <th scope="col">Actual</th>
            <th scope="col">Over/under target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.categoryId ?? "uncategorized"}>
              <td data-label="Category">{categoryDisplayName(row.categoryId)}</td>
              <td data-label="Target">{renderTarget(row.targetMinor)}</td>
              <td data-label="Actual">{formatNokAmountMinor(row.actualMinor)}</td>
              <td data-label="Over/under target">{isIncomplete && row.targetMinor !== null ? "Incomplete" : renderDifference(row.deltaMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
