import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDashboardData,
  buildDashboardViewContract,
} from "../../src/shared/dashboard.js";
import { ReviewWorkspace } from "../../src/renderer/workspaces/ReviewWorkspace.js";
import { TargetVsActualSection } from "../../src/renderer/dashboard/TargetVsActualSection.js";
import type { ReviewState } from "../../src/renderer/workspaces/types.js";
import type { ReportingPeriodRule } from "../../src/shared/applicationPreferences.js";

describe("review period navigation", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the review focused on recorded results with planning outside the totals", () => {
    const markup = renderReview("2026-10", []);
    expect(markup).not.toContain("See the month clearly");
    expect(markup).not.toContain('aria-label="Cash planning"');
    expect(markup).not.toContain("Review all transactions");
    expect(markup).toContain("View transactions for this period");
    expect(markup).toContain('aria-label="Planning tools"');
    expect(markup).toContain("Plan ahead");
  });

  it("does not repeat category spending in a target table when no targets are configured", () => {
    const viewContract = buildDashboardViewContract({
      selectedYearMonth: "2026-10",
      transactions: [{
        id: "synthetic-expense", householdId: "household", accountId: "account",
        bookedAtIso: "2026-10-10", amountMinor: -5000, merchantRaw: "SYNTHETIC KIWI",
        categoryId: "groceries", currencyCode: "NOK",
      }],
    });
    const markup = renderToStaticMarkup(React.createElement(TargetVsActualSection, { viewContract }));
    expect(markup).not.toContain("<table");
    expect(markup).toContain("No targets set for this month");
    expect(markup).toContain("Manage category targets");
  });

  it("keeps a navigated month selected even when it has no recorded activity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T12:00:00"));
    const markup = renderReview("2026-12", ["2026-11"]);
    expect(markup).toMatch(/<input[^>]*type="month"[^>]*value="2026-12"/);
    expect(markup).toMatch(/<input[^>]*type="month"[^>]*lang="en-GB"/);
    expect(markup).toContain("Future period");
    expect(markup).not.toMatch(/aria-label="Next month[^"]*"[^>]*disabled=""/);
  });

  it("offers a return to the current month without calling history a preference override", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T12:00:00"));
    const markup = renderReview("2026-10", ["2026-10"]);
    expect(markup).not.toContain("Historical period");
    expect(markup).toContain("Current month");
    expect(markup).not.toContain("Custom view");
    expect(markup).not.toContain("Use household default");
    expect(markup).toContain("1 November 2026 - 30 November 2026");
    expect(markup).toContain('type="month"');
  });

  it("identifies an unfinished period and offers its transactions without expanding controls", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T12:00:00"));
    const markup = renderReview("2026-11", []);
    expect(markup).toContain("In progress");
    expect(markup).toContain("View transactions for this period");
  });

  it("explains an empty report once without an additional missing-activity comparison", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T12:00:00"));
    const markup = renderReview("2026-10", []);
    expect(markup).toContain("Statement coverage may be incomplete.");
    expect(markup).not.toContain("Loading previous-month comparison");
    expect(markup.match(/No activity has been recorded/g)).toHaveLength(1);
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
      onOpenPeriodTransactions: () => undefined,
      onOpenCoverage: () => undefined,
      onOpenExchangeRates: () => undefined,
      onTargetSaved: () => undefined,
      onRetry: () => undefined,
    }));

    expect(markup).toMatch(/<button[^>]*aria-label="Previous period[^"]*"[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*aria-label="Next period[^"]*"[^>]*disabled=""/);
    expect(markup).toMatch(/<input[^>]*aria-label="Select month"[^>]*disabled=""/);
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
    onOpenPeriodTransactions: () => undefined,
    onOpenCoverage: () => undefined,
    onOpenExchangeRates: () => undefined,
    onTargetSaved: () => undefined,
    onRetry: () => undefined,
  }));
}
