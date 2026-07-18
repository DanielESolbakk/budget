import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildDashboardViewContract,
  createMonthlyCategoryTargetStore,
} from "../../src/app/dashboardApi.js";
import { TargetVsActualSection } from "../../src/renderer/dashboard/TargetVsActualSection.js";
import type { Transaction } from "../../src/domain/types.js";

const transactions: Transaction[] = [
  {
    id: "tx-1",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-05-03T10:00:00Z",
    amountMinor: -12000,
    merchantRaw: "Rema 1000",
    categoryId: "groceries",
  },
  {
    id: "tx-2",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-05-07T10:00:00Z",
    amountMinor: -2000,
    merchantRaw: "Kolumbus",
    categoryId: "transport",
  },
];

describe("target-vs-actual display smoke", () => {
  it("AC-1: renders target, actual, and delta columns with category rows", () => {
    const store = createMonthlyCategoryTargetStore([
      { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 10000 },
    ]);
    const viewContract = buildDashboardViewContract({
      transactions,
      selectedYearMonth: "2026-05",
      monthlyCategoryTargetStore: store,
    });
    const markup = renderToStaticMarkup(
      React.createElement(TargetVsActualSection, { viewContract })
    );

    expect(markup).toContain("Target vs Actual");
    expect(markup).toContain("<th>Target</th>");
    expect(markup).toContain("<th>Actual</th>");
    expect(markup).toContain("<th>Delta</th>");
    expect(markup).toContain("groceries");
  });

  it("AC-3: explicitly renders no-target rows using the null contract policy", () => {
    const store = createMonthlyCategoryTargetStore([
      { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 10000 },
    ]);
    const viewContract = buildDashboardViewContract({
      transactions,
      selectedYearMonth: "2026-05",
      monthlyCategoryTargetStore: store,
    });
    const markup = renderToStaticMarkup(
      React.createElement(TargetVsActualSection, { viewContract })
    );

    expect(markup).toContain("transport");
    expect(markup).toContain("No target");
  });
});
