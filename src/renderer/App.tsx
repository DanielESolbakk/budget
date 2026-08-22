import React from "react";
import type { DashboardData, DashboardViewContract } from "../app/dashboardApi.js";
import "./app.css";
import { BackupSection } from "./backup/BackupSection.js";
import { CategoryBreakdownSection } from "./dashboard/CategoryBreakdownSection.js";
import { CategoryTargetEntrySection } from "./dashboard/CategoryTargetEntrySection.js";
import { ForecastSection } from "./dashboard/ForecastSection.js";
import { CsvImportSection } from "./import/CsvImportSection.js";
import { PdfImportSection } from "./import/PdfImportSection.js";
import { MonthlyTotalsSection } from "./dashboard/MonthlyTotalsSection.js";
import { RestoreSnapshotSection } from "./dashboard/RestoreSnapshotSection.js";
import { TargetVsActualSection } from "./dashboard/TargetVsActualSection.js";
import { loadDashboardData } from "./dashboard/loadDashboardData.js";

const DEFAULT_YEAR_MONTH = "2026-05";
const monthFormatter = new Intl.DateTimeFormat("nb-NO", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatYearMonth(yearMonth: string): string {
  const [yearPart, monthPart] = yearMonth.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return yearMonth;
  }

  return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1))).replace(/\.$/, "");
}

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
  const [isChangingMonth, setIsChangingMonth] = React.useState(false);
  const [monthChangeError, setMonthChangeError] = React.useState<string | null>(null);
  const hasLoadedInitialState = React.useRef(false);

  React.useEffect(() => {
    let isActive = true;

    if (!hasLoadedInitialState.current) {
      setAppState({ status: "loading" });
    }

    Promise.all([
      loadDashboardData(window.budgetApi),
      window.budgetApi.dashboard.getViewData(DEFAULT_YEAR_MONTH),
    ])
      .then(([dashboardData, viewContract]) => {
        if (!isActive) return;
        hasLoadedInitialState.current = true;
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

    setIsChangingMonth(true);
    setMonthChangeError(null);
    window.budgetApi.dashboard
      .getViewData(yearMonth)
      .then((viewContract) => {
        setAppState((prev) => {
          if (prev.status !== "ready") return prev;
          return { ...prev, viewContract, selectedYearMonth: yearMonth };
        });
        setIsChangingMonth(false);
      })
      .catch(() => {
        setIsChangingMonth(false);
        setMonthChangeError("Unable to change month. The current review is still shown.");
      });
  }

  const headerStatus =
    appState.status === "loading"
      ? "Loading review"
      : appState.status === "error"
        ? "Needs attention"
        : isChangingMonth
          ? "Updating review"
          : "Ready for review";
  const headerStatusClassName =
    appState.status === "error"
      ? "header-status is-error"
      : isChangingMonth || appState.status === "loading"
        ? "header-status is-loading"
        : "header-status";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-stamp" aria-hidden="true">BP</span>
          <div>
            <h1>Budget Planner</h1>
            <p>Local household ledger</p>
          </div>
        </div>
        <div className="header-meta" aria-label="Application status" aria-live="polite">
          <span>On device</span>
          <span className={headerStatusClassName}>
            <i aria-hidden="true" /> {headerStatus}
          </span>
        </div>
      </header>

      <main className="workspace" aria-labelledby="review-heading">
        <section className="review-intro" aria-labelledby="review-heading">
          <div>
            <p className="section-label">Monthly review</p>
            <h2 id="review-heading">Cut the month into something clear.</h2>
            <p className="intro-copy">
              Read the selected month first, then pin the work that keeps the ledger useful.
            </p>
          </div>
          {appState.status === "ready" && (
            <div className="month-picker">
              <label htmlFor="month-select">Reviewing</label>
              <select
                id="month-select"
                aria-label="Select month"
                value={appState.selectedYearMonth}
                onChange={(event) => handleMonthChange(event.target.value)}
              >
                {appState.availableMonths.map((month) => (
                  <option key={month} value={month}>
                    {formatYearMonth(month)}
                  </option>
                ))}
              </select>
              <span className="month-picker-code">{appState.selectedYearMonth}</span>
            </div>
          )}
        </section>

        {appState.status === "loading" && (
          <section className="status-panel status-loading" aria-live="polite">
            <div className="status-heading">
              <span className="status-marker" aria-hidden="true" />
              <h2>Loading the review rail</h2>
            </div>
            <div className="skeleton-line skeleton-line-wide" />
            <div className="skeleton-line skeleton-line-short" />
          </section>
        )}
      {appState.status === "error" && (
          <section className="status-panel status-error" role="alert">
            <div className="status-heading">
              <span className="status-marker" aria-hidden="true">!</span>
              <h2>Review rail unavailable</h2>
            </div>
            <p>{appState.message}</p>
            <button type="button" onClick={() => setRefreshCounter((counter) => counter + 1)}>
              Try again
            </button>
          </section>
      )}
      {appState.status === "ready" && (
        <>
          <section className="month-rail" aria-labelledby="rail-heading">
            <div className="rail-heading-row">
              <div>
                <p className="section-label">Review rail</p>
                <h2 id="rail-heading">Choose a frame</h2>
              </div>
              <span className="rail-count">
                {appState.availableMonths.length} available frame{appState.availableMonths.length === 1 ? "" : "s"}
              </span>
            </div>
            <nav aria-label="Available months" className="rail-track">
              <ol className="month-frames">
                {appState.availableMonths.map((month, index) => {
                  const isSelected = month === appState.selectedYearMonth;
                  return (
                    <li key={month} className={isSelected ? "month-frame is-selected" : "month-frame"}>
                      <button
                        type="button"
                        className="month-frame-button"
                        aria-current={isSelected ? "date" : undefined}
                        aria-label={`Select ${formatYearMonth(month)} for review`}
                        onClick={() => handleMonthChange(month)}
                      >
                        <span className="frame-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="frame-month">{formatYearMonth(month)}</span>
                        <span className="frame-code">{month}</span>
                        <span className="frame-state">{isSelected ? "Selected" : "Frame"}</span>
                        {isSelected && <span className="frame-flag">Current</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
            {isChangingMonth && (
              <p className="rail-status" role="status">Cutting to {formatYearMonth(appState.selectedYearMonth)}...</p>
            )}
            {monthChangeError !== null && <p className="rail-status is-error" role="alert">{monthChangeError}</p>}
          </section>

          <div className="review-grid" aria-busy={isChangingMonth}>
            <div className="review-primary">
              <MonthlyTotalsSection viewContract={appState.viewContract} />
              <TargetVsActualSection viewContract={appState.viewContract} />
              <CategoryTargetEntrySection selectedYearMonth={appState.selectedYearMonth} />
            </div>
            <aside className="review-support" aria-label="Monthly context">
              <CategoryBreakdownSection viewContract={appState.viewContract} />
              <ForecastSection dashboardData={appState.dashboardData} />
            </aside>
          </div>

          <section className="work-bin" aria-labelledby="work-bin-heading">
            <div className="work-bin-heading">
              <div>
                <p className="section-label">Pinned work</p>
                <h2 id="work-bin-heading">Keep the ledger recoverable.</h2>
              </div>
              <p>Imports, snapshots, and restores stay close without competing with the monthly read.</p>
            </div>
            <div className="work-bin-grid">
              <CsvImportSection onImportSuccess={() => setRefreshCounter((counter) => counter + 1)} />
              <PdfImportSection onImportSuccess={() => setRefreshCounter((counter) => counter + 1)} />
              <BackupSection />
              <RestoreSnapshotSection onRestoreSuccess={() => setRefreshCounter((counter) => counter + 1)} />
            </div>
          </section>
        </>
      )}
      </main>
    </div>
  );
}
