import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDashboardData } from "../../src/app/dashboardApi.js";
import { ForecastSection } from "../../src/renderer/dashboard/ForecastSection.js";
import { loadDashboardData } from "../../src/renderer/dashboard/loadDashboardData.js";
import type { MonthlyTotal } from "../../src/domain/types.js";
import type { BudgetApi } from "../../src/renderer/preload.js";

const monthlyTotals: MonthlyTotal[] = [
  { yearMonth: "2026-03", totalMinor: 48000 },
  { yearMonth: "2026-04", totalMinor: 51000 },
  { yearMonth: "2026-05", totalMinor: 54000 },
];

function createStubBudgetApi(): BudgetApi {
  const dashboardData = buildDashboardData({ monthlyTotals });

  return {
    dashboard: {
      getData: async () => dashboardData,
    },
    forecast: {
      getEntries: async () => dashboardData.forecast.entries,
    },
  };
}

describe("forecast display smoke", () => {
  it("AC-1: renderer receives dashboard forecast data and displays projected months", async () => {
    const dashboardData = await loadDashboardData(createStubBudgetApi());
    const markup = renderToStaticMarkup(
      React.createElement(ForecastSection, { dashboardData })
    );

    expect(markup).toContain("Forecast");
    expect(markup).toContain("2026-06");
    expect(markup).toContain("2026-07");
    expect(markup).toContain("2026-08");
  });

  it("AC-2: renderer consumption leaves dashboard monthly totals unchanged", async () => {
    const dashboardData = await loadDashboardData(createStubBudgetApi());

    expect(dashboardData.monthlyTotals).toEqual(monthlyTotals);
  });

  it("AC-3: insufficient history fallback is explicitly labeled in the renderer", () => {
    const fallbackData = buildDashboardData({
      monthlyTotals: [],
      fallbackStartYearMonth: "2026-04",
    });
    const markup = renderToStaticMarkup(
      React.createElement(ForecastSection, { dashboardData: fallbackData })
    );

    expect(markup).toContain("Insufficient history: showing fallback forecast.");
    expect(markup).toContain("2026-04");
  });
});
