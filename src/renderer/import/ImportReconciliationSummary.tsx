import React from "react";
import type {
  ImportReconciliation,
  ImportReconciliationRow,
} from "../../domain/import/importReconciliation.js";

interface ImportReconciliationSummaryProps {
  reconciliation: ImportReconciliation;
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();
const DISPOSITION_LABELS: Record<ImportReconciliationRow["disposition"], string> = {
  persisted: "Persisted",
  pending: "Pending, not yet in transactions",
  unresolved: "Unresolved, sent to review",
  invalid: "Invalid, sent to review",
  duplicate: "Duplicate, skipped",
  skipped: "Skipped",
  "not-persisted": "Not persisted",
  unaccounted: "No disposition recorded",
};

function formatMinorUnits(amountMinor: number, currencyCode: string): string {
  let formatter = currencyFormatters.get(currencyCode);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "code",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(currencyCode, formatter);
  }
  return formatter.format(amountMinor / 100);
}

function dispositionLabel(disposition: ImportReconciliationRow["disposition"]): string {
  return DISPOSITION_LABELS[disposition];
}

function reviewItemLabel(
  disposition: ImportReconciliationRow["disposition"]
): string | undefined {
  if (disposition === "invalid" || disposition === "unresolved") {
    return "A review item is available below.";
  }
  return undefined;
}

export function ImportReconciliationSummary({
  reconciliation,
}: ImportReconciliationSummaryProps): React.JSX.Element {
  const rowsNeedingAttention = reconciliation.rows.filter((row) => row.disposition !== "persisted");
  const persistedRowCount = reconciliation.rows.length - rowsNeedingAttention.length;

  return (
    <section className="import-reconciliation" aria-label="Import reconciliation">
      <h4>Statement reconciliation</h4>
      <p
        className={reconciliation.fullyReconciled ? "import-reconciliation-status is-matched" : "import-reconciliation-status is-unmatched"}
        role="status"
        aria-label="Reconciliation status"
      >
        {reconciliation.fullyReconciled
          ? "Matched: all source rows were persisted and the totals agree."
          : "Needs review: totals differ or one or more source rows were not persisted."}
      </p>
      {reconciliation.amounts.length === 0 ? (
        <p className="import-reconciliation-empty">
          No source amount totals could be compared. Review the source rows before relying on this import.
        </p>
      ) : (
        <table
          className="import-reconciliation-table"
          aria-label="Import totals by currency and direction"
        >
          <thead>
            <tr>
              <th scope="col">Currency</th>
              <th scope="col">Direction</th>
              <th scope="col">Source total</th>
              <th scope="col">Persisted transactions</th>
              <th scope="col">Difference</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {reconciliation.amounts.map((amount) => (
              <tr key={`${amount.currencyCode}-${amount.direction}`}>
                <td data-label="Currency">{amount.currencyCode}</td>
                <td data-label="Direction">
                  {amount.direction === "incoming" ? "Incoming" : "Outgoing"}
                </td>
                <td data-label="Source total">
                  {formatMinorUnits(amount.sourceTotalMinor, amount.currencyCode)}
                </td>
                <td data-label="Persisted transactions">
                  {formatMinorUnits(amount.persistedTotalMinor, amount.currencyCode)}
                </td>
                <td data-label="Difference">
                  {formatMinorUnits(amount.differenceMinor, amount.currencyCode)}
                </td>
                <td data-label="Status">{amount.matched ? "Matched" : "Mismatch"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="import-reconciliation-dispositions">
        <p>
            {reconciliation.rows.length === 0
              ? "No source transaction rows were available."
              : `${persistedRowCount} of ${reconciliation.rows.length} source transaction rows persisted.`}
          </p>
          <ul aria-label="Source row dispositions">
            {reconciliation.rows.length === 0 ? (
              <li>No source transaction row dispositions were returned.</li>
            ) : rowsNeedingAttention.length === 0 ? (
              <li>Every source transaction row was persisted.</li>
          ) : rowsNeedingAttention.map((row) => (
            <li key={row.sourceRowIndex}>
              <span>
                Row {row.sourceRowIndex + 1}: {dispositionLabel(row.disposition)}
                {row.amountMinor === undefined
                  ? ""
                  : ` · ${formatMinorUnits(row.amountMinor, row.currencyCode)}`}
              </span>
              {row.reviewItemId !== undefined && row.disposition !== "persisted" && (
                <span className="import-reconciliation-review-note">
                  {reviewItemLabel(row.disposition)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
