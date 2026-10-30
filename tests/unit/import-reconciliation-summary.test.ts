import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportReconciliationSummary } from "../../src/renderer/import/ImportReconciliationSummary.js";
import type { ImportReconciliation, ImportReconciliationRow } from "../../src/domain/import/importReconciliation.js";

function renderDisposition(disposition: ImportReconciliationRow["disposition"], amountMinor: number | null = -1000): string {
  const reconciliation: ImportReconciliation = {
    importJobId: "synthetic-import",
    fullyReconciled: false,
    rows: [{ sourceRowIndex: 0, disposition, currencyCode: "NOK", ...(amountMinor === null ? {} : { amountMinor }) }],
    amounts: [{
      currencyCode: "NOK", direction: "outgoing",
      sourceTotalMinor: -1000, persistedTotalMinor: 0, differenceMinor: -1000, matched: false,
    }],
  };
  return renderToStaticMarkup(React.createElement(ImportReconciliationSummary, { reconciliation }));
}

describe("import reconciliation outcome communication", () => {
  it.each(["skipped", "duplicate", "pending"] as const)("explains %s without claiming unresolved action", (disposition) => {
    const markup = renderDisposition(disposition);
    expect(markup).toContain("All source rows accounted for");
    expect(markup).not.toContain("Needs review");
    expect(markup).toContain("Mismatch");
    expect(markup).toContain("0 need action");
  });

  it.each(["invalid", "unresolved", "not-persisted", "unaccounted"] as const)("keeps %s actionable", (disposition) => {
    const markup = renderDisposition(disposition);
    expect(markup).toContain("Needs review");
    expect(markup).toContain("1 need action");
  });

  it("does not claim an unknown skipped amount explains a difference", () => {
    expect(renderDisposition("skipped", null)).toContain("Needs review");
  });

  it("does not claim a mismatched persisted total is explained", () => {
    expect(renderDisposition("persisted")).toContain("Needs review");
  });
});
