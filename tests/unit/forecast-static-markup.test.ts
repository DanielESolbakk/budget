import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDashboardData } from "../../src/app/dashboardApi.js";
import { ForecastSection } from "../../src/renderer/dashboard/ForecastSection.js";
import type { MonthlyTotal } from "../../src/domain/types.js";

const monthlyTotals: MonthlyTotal[] = [
  { yearMonth: "2026-03", totalMinor: 48000 },
  { yearMonth: "2026-04", totalMinor: 51000 },
  { yearMonth: "2026-05", totalMinor: 54000 },
];

describe("forecast static markup (not interactive renderer)", () => {
  it("AC-1: renderer receives dashboard forecast data and displays projected months", async () => {
    const dashboardData = buildDashboardData({ monthlyTotals });
    const markup = renderToStaticMarkup(
      React.createElement(ForecastSection, { dashboardData })
    );

    expect(markup).toContain("Forecast");
    expect(markup).toContain("2026-06");
    expect(markup).toContain("2026-07");
    expect(markup).toContain("2026-08");
  });

  it("AC-2: rendering forecast leaves dashboard monthly totals unchanged", () => {
    const dashboardData = buildDashboardData({ monthlyTotals });
    renderToStaticMarkup(React.createElement(ForecastSection, { dashboardData }));

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

    expect(markup).toContain("Not enough history for an outlook.");
    expect(markup).not.toContain("<li");
    expect(markup).not.toContain("2026-04");
    expect(markup).not.toContain("0,00");
    expect(fallbackData.forecast.entries).toHaveLength(3);
  });

  it("shows a genuine zero net outlook when recorded history is available", () => {
    const dashboardData = buildDashboardData({
      monthlyTotals: [{ yearMonth: "2026-05", totalMinor: 0 }],
    });
    const markup = renderToStaticMarkup(
      React.createElement(ForecastSection, { dashboardData })
    );

    expect(markup).not.toContain("Not enough history");
    expect(markup).toContain("2026-06");
    expect(markup).toContain("0,00");
    expect(markup.match(/<li\b/g)).toHaveLength(3);
  });
});
