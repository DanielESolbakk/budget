import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildDashboardData,
  buildDashboardViewContract,
} from "../../src/shared/dashboard.js";
import { ReviewWorkspace } from "../../src/renderer/workspaces/ReviewWorkspace.js";
import type { ReviewState } from "../../src/renderer/workspaces/types.js";
import type { ReportingPeriodRule } from "../../src/shared/applicationPreferences.js";

describe("review period navigation", () => {
  it("disables period controls while a period query is in progress", () => {
    const reportingPeriodRule: ReportingPeriodRule = { type: "last-weekday", weekday: 4 };
    const viewContract = buildDashboardViewContract({
      transactions: [],
      selectedYearMonth: "2026-10",
      reportingPeriodRule,
    });
    if (viewContract.state === "loading") {
      throw new Error("Expected an empty dashboard not to be loading.");
    }

    const state: ReviewState = {
      status: "ready",
      dashboardData: buildDashboardData({ monthlyTotals: [] }),
      viewContract,
      selectedYearMonth: "2026-10",
      availableMonths: ["2026-10", "2026-11", "2026-12"],
    };
    const markup = renderToStaticMarkup(React.createElement(ReviewWorkspace, {
      state,
      isActive: true,
      isChangingMonth: true,
      isRefreshing: false,
      refreshKey: 0,
      monthChangeError: null,
      refreshError: null,
      savedReportingPeriodRule: reportingPeriodRule,
      onMonthChange: () => undefined,
      onReportingModeChange: () => undefined,
      onOpenTransactions: () => undefined,
      onOpenCoverage: () => undefined,
      onTargetSaved: () => undefined,
      onRetry: () => undefined,
    }));

    expect(markup).toMatch(/<button[^>]*aria-label="Previous period"[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*aria-label="Next period"[^>]*disabled=""/);
    expect(markup).toMatch(/<select[^>]*aria-label="Select month"[^>]*disabled=""/);
  });
});
