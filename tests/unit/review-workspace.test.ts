import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDashboardData,
  buildDashboardViewContract,
} from "../../src/shared/dashboard.js";
import { ReviewWorkspace } from "../../src/renderer/workspaces/ReviewWorkspace.js";
import type { ReviewState } from "../../src/renderer/workspaces/types.js";
import type { ReportingPeriodRule } from "../../src/shared/applicationPreferences.js";

describe("review period navigation", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps a navigated month selected even when it has no recorded activity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T12:00:00"));
    const markup = renderReview("2026-12", ["2026-11"]);
    expect(markup).toContain('<option value="2026-12" selected="">');
    expect(markup).toContain("Future period");
    expect(markup).toMatch(/aria-label="Next month[^"]*"[^>]*disabled=""/);
  });

  it("offers a return to the current month without calling history a preference override", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T12:00:00"));
    const markup = renderReview("2026-10", ["2026-10"]);
    expect(markup).toContain("Historical period");
    expect(markup).toContain("Current month");
    expect(markup).not.toContain("Custom view");
    expect(markup).not.toContain("Use household default");
    expect(markup).toContain("1 November 2026 - 30 November 2026");
    expect(markup).toContain('<option value="2026-11"');
  });

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

    expect(markup).toMatch(/<button[^>]*aria-label="Previous period[^"]*"[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*aria-label="Next period[^"]*"[^>]*disabled=""/);
    expect(markup).toMatch(/<select[^>]*aria-label="Select month"[^>]*disabled=""/);
  });
});

function renderReview(selectedYearMonth: string, availableMonths: string[]): string {
  return renderToStaticMarkup(React.createElement(ReviewWorkspace, {
    state: {
      status: "ready",
      dashboardData: buildDashboardData({ monthlyTotals: [] }),
      viewContract: buildDashboardViewContract({ transactions: [], selectedYearMonth }),
      selectedYearMonth,
      availableMonths,
    },
    isActive: true,
    isChangingMonth: false,
    isRefreshing: false,
    refreshKey: 0,
    monthChangeError: null,
    refreshError: null,
    savedReportingPeriodRule: { type: "calendar-month" },
    onMonthChange: () => undefined,
    onReportingModeChange: () => undefined,
    onOpenTransactions: () => undefined,
    onOpenCoverage: () => undefined,
    onTargetSaved: () => undefined,
    onRetry: () => undefined,
  }));
}
