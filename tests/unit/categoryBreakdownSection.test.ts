import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DashboardViewContract } from "../../src/app/dashboardApi.js";
import { CategoryBreakdownSection } from "../../src/renderer/dashboard/CategoryBreakdownSection.js";

describe("CategoryBreakdownSection", () => {
  it("humanizes custom category identifiers in the visible breakdown", () => {
    const categoryEntry = {
      categoryId: "home-office",
      label: "home-office",
      totalMinor: 1250,
      transactionCount: 1,
    };
    const viewContract: DashboardViewContract = {
      state: "ready",
      snapshot: {
        selectedYearMonth: "2026-05",
        reportingPeriodRule: { type: "calendar-month" },
        reportingPeriodRange: {
          startDateIso: "2026-05-01",
          endDateExclusiveIso: "2026-06-01",
        },
        categoryReviewCount: 0,
        monthlyTotals: {
          yearMonth: "2026-05",
          incomeMinor: 0,
          expenseMinor: 1250,
          netMinor: -1250,
        },
        categoryBreakdown: {
          yearMonth: "2026-05",
          entries: [categoryEntry],
        },
        categoryBreakdownByFlow: {
          inflows: { yearMonth: "2026-05", entries: [] },
          spending: { yearMonth: "2026-05", entries: [categoryEntry] },
        },
        targetVsActualCategoryRows: { yearMonth: "2026-05", rows: [] },
      },
    };

    const markup = renderToStaticMarkup(
      React.createElement(CategoryBreakdownSection, { viewContract })
    );

    expect(markup).toContain("Home Office");
    expect(markup).not.toContain("home-office");
  });

  it("uses one empty message when no category amounts can be displayed", () => {
    const viewContract: DashboardViewContract = {
      state: "ready",
      snapshot: {
        selectedYearMonth: "2026-05",
        reportingPeriodRule: { type: "calendar-month" },
        reportingPeriodRange: {
          startDateIso: "2026-05-01",
          endDateExclusiveIso: "2026-06-01",
        },
        categoryReviewCount: 0,
        monthlyTotals: {
          yearMonth: "2026-05",
          incomeMinor: 0,
          expenseMinor: 0,
          netMinor: 0,
        },
        categoryBreakdown: { yearMonth: "2026-05", entries: [] },
        categoryBreakdownByFlow: {
          inflows: { yearMonth: "2026-05", entries: [] },
          spending: { yearMonth: "2026-05", entries: [] },
        },
        targetVsActualCategoryRows: { yearMonth: "2026-05", rows: [] },
      },
    };

    const markup = renderToStaticMarkup(
      React.createElement(CategoryBreakdownSection, { viewContract })
    );

    expect(markup.match(/No category amounts can be converted to NOK yet\./g)).toHaveLength(1);
    expect(markup).not.toContain("No spending amounts are available for this month.");
    expect(markup).not.toContain("No incoming amounts are available for this month.");
  });
});
