import React from "react";
import type { DashboardData, DashboardViewContract } from "../app/dashboardApi.js";
import { BackupSection } from "./backup/BackupSection.js";
import { CategoryBreakdownSection } from "./dashboard/CategoryBreakdownSection.js";
import { CategoryTargetEntrySection } from "./dashboard/CategoryTargetEntrySection.js";
import { ForecastSection } from "./dashboard/ForecastSection.js";
import { CsvImportSection } from "./import/CsvImportSection.js";
import { MonthlyTotalsSection } from "./dashboard/MonthlyTotalsSection.js";
import { RestoreSnapshotSection } from "./dashboard/RestoreSnapshotSection.js";
import { TargetVsActualSection } from "./dashboard/TargetVsActualSection.js";
import { loadDashboardData } from "./dashboard/loadDashboardData.js";

const DEFAULT_YEAR_MONTH = "2026-05";

type AppState =
  | { status: "loading" }
  | {
      status: "ready";
      dashboardData: DashboardData;
      viewContract: DashboardViewContract;
      selectedYearMonth: string;
      availableMonths: string[];
    }
  | { status: "error"; message: string };

export function App(): React.JSX.Element {
  const [appState, setAppState] = React.useState<AppState>({ status: "loading" });
  const [refreshCounter, setRefreshCounter] = React.useState(0);

  React.useEffect(() => {
    let isActive = true;

    setAppState({ status: "loading" });

    Promise.all([
      loadDashboardData(window.budgetApi),
      window.budgetApi.dashboard.getViewData(DEFAULT_YEAR_MONTH),
    ])
      .then(([dashboardData, viewContract]) => {
        if (!isActive) return;
        const availableMonths = dashboardData.monthlyTotals.map((t) => t.yearMonth);
        setAppState({
          status: "ready",
          dashboardData,
          viewContract,
          selectedYearMonth: DEFAULT_YEAR_MONTH,
          availableMonths,
        });
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        const message =
          error instanceof Error ? error.message : "Unknown dashboard loading error.";
        setAppState({ status: "error", message });
      });

    return () => {
      isActive = false;
    };
  }, [refreshCounter]);

  function handleMonthChange(yearMonth: string): void {
    if (appState.status !== "ready") return;
    window.budgetApi.dashboard
      .getViewData(yearMonth)
      .then((viewContract) => {
        setAppState((prev) => {
          if (prev.status !== "ready") return prev;
          return { ...prev, viewContract, selectedYearMonth: yearMonth };
        });
      })
      .catch(() => {
        // Keep the current view when the IPC call fails.
      });
  }

  return (
    <div>
      <h1>Budget Planner</h1>
      <p>Local-first budget planning for your household.</p>
      {appState.status === "loading" && <p>Loading forecast...</p>}
      {appState.status === "error" && (
        <p role="alert">Unable to load forecast: {appState.message}</p>
      )}
      {appState.status === "ready" && (
        <>
          <label htmlFor="month-select">Selected Month</label>
          <select
            id="month-select"
            aria-label="Select month"
            value={appState.selectedYearMonth}
            onChange={(e) => handleMonthChange(e.target.value)}
          >
            {appState.availableMonths.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
          <MonthlyTotalsSection viewContract={appState.viewContract} />
          <CategoryBreakdownSection viewContract={appState.viewContract} />
          <TargetVsActualSection viewContract={appState.viewContract} />
          <CategoryTargetEntrySection selectedYearMonth={appState.selectedYearMonth} />
          <ForecastSection dashboardData={appState.dashboardData} />
          <CsvImportSection onImportSuccess={() => setRefreshCounter((c) => c + 1)} />
          <BackupSection />
          <RestoreSnapshotSection onRestoreSuccess={() => setRefreshCounter((c) => c + 1)} />
        </>
      )}
    </div>
  );
}
