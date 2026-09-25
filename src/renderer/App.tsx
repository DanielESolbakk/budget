import React from "react";
import type { DashboardData, DashboardViewContract } from "../app/dashboardApi.js";
import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "./app.css";
import { BackupSection } from "./backup/BackupSection.js";
import { ExportSection } from "./backup/ExportSection.js";
import { CategoryBreakdownSection } from "./dashboard/CategoryBreakdownSection.js";
import { CategoryTargetEntrySection } from "./dashboard/CategoryTargetEntrySection.js";
import { ForecastSection } from "./dashboard/ForecastSection.js";
import { CsvImportSection } from "./import/CsvImportSection.js";
import { ManualEntrySection } from "./import/ManualEntrySection.js";
import { PdfImportSection } from "./import/PdfImportSection.js";
import { CategoryReviewSection } from "./import/CategoryReviewSection.js";
import { MonthlyTotalsSection } from "./dashboard/MonthlyTotalsSection.js";
import { LedgerSection } from "./dashboard/LedgerSection.js";
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
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [monthChangeError, setMonthChangeError] = React.useState<string | null>(null);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);
  const hasLoadedInitialState = React.useRef(false);
  const selectedYearMonthRef = React.useRef(DEFAULT_YEAR_MONTH);
  const latestViewRequestRef = React.useRef(0);

  React.useEffect(() => {
    let isActive = true;
    const requestId = latestViewRequestRef.current + 1;
    latestViewRequestRef.current = requestId;
    const requestedYearMonth = selectedYearMonthRef.current;

    setMonthChangeError(null);
    setIsChangingMonth(false);
    if (!hasLoadedInitialState.current) {
      setAppState({ status: "loading" });
    } else {
      setIsRefreshing(true);
      setRefreshError(null);
    }

    Promise.all([
      loadDashboardData(window.budgetApi),
      window.budgetApi.dashboard.getViewData(requestedYearMonth),
    ])
      .then(([dashboardData, viewContract]) => {
        if (!isActive || requestId !== latestViewRequestRef.current) return;
        hasLoadedInitialState.current = true;
        setIsRefreshing(false);
        setRefreshError(null);
        const availableMonths = dashboardData.monthlyTotals.map((t) => t.yearMonth);
        selectedYearMonthRef.current = requestedYearMonth;
        setAppState({
          status: "ready",
          dashboardData,
          viewContract,
          selectedYearMonth: requestedYearMonth,
          availableMonths,
        });
      })
      .catch((error: unknown) => {
        if (!isActive || requestId !== latestViewRequestRef.current) return;
        const message =
          error instanceof Error ? error.message : "Unknown dashboard loading error.";
        setIsRefreshing(false);
        if (hasLoadedInitialState.current) {
          setRefreshError(message);
        } else {
          setAppState({ status: "error", message });
        }
      });

    return () => {
      isActive = false;
    };
  }, [refreshCounter]);

  function handleMonthChange(yearMonth: string): void {
    if (appState.status !== "ready") return;

    const requestId = latestViewRequestRef.current + 1;
    latestViewRequestRef.current = requestId;
    setIsChangingMonth(true);
    setMonthChangeError(null);
    window.budgetApi.dashboard
      .getViewData(yearMonth)
      .then((viewContract) => {
        if (requestId !== latestViewRequestRef.current) return;
        setAppState((prev) => {
          if (prev.status !== "ready") return prev;
          return { ...prev, viewContract, selectedYearMonth: yearMonth };
        });
        selectedYearMonthRef.current = yearMonth;
        setIsChangingMonth(false);
      })
      .catch(() => {
        if (requestId !== latestViewRequestRef.current) return;
        setIsChangingMonth(false);
        setMonthChangeError("Unable to change month. The current review is still shown.");
      });
  }

  const headerStatus =
    appState.status === "loading"
      ? "Loading review"
      : appState.status === "error"
        ? "Needs attention"
        : refreshError !== null
          ? "Needs attention"
        : isChangingMonth || isRefreshing
          ? "Updating review"
          : "Ready for review";
  const headerStatusClassName =
    appState.status === "error"
      ? "header-status is-error"
      : refreshError !== null
        ? "header-status is-error"
      : isChangingMonth || isRefreshing || appState.status === "loading"
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
            <h2 id="review-heading">Review your household spending.</h2>
            <p className="intro-copy">
              Start with one month, then bring in or tidy the transactions that explain it.
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
          {refreshError !== null && (
            <section className="status-panel status-error" role="alert">
              <div className="status-heading">
                <span className="status-marker" aria-hidden="true">!</span>
                <h2>Review refresh failed</h2>
              </div>
              <p>{refreshError}</p>
              <button type="button" onClick={() => setRefreshCounter((counter) => counter + 1)}>
                Try again
              </button>
            </section>
          )}
          <section className="month-rail" aria-labelledby="rail-heading">
            <div className="rail-heading-row">
              <div>
                <h2 id="rail-heading">Choose a month</h2>
              </div>
              <span className="rail-count">
                {appState.availableMonths.length} month{appState.availableMonths.length === 1 ? "" : "s"} available
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
                        <span className="frame-state">{isSelected ? "Selected" : "Month"}</span>
                        {isSelected && <span className="frame-flag">Current</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
            {isChangingMonth && (
              <p className="rail-status" role="status">Updating month...</p>
            )}
            {monthChangeError !== null && <p className="rail-status is-error" role="alert">{monthChangeError}</p>}
          </section>

          <div className="review-grid" aria-busy={isChangingMonth || isRefreshing}>
            <div className="review-primary">
              <MonthlyTotalsSection viewContract={appState.viewContract} />
              <LedgerSection refreshKey={refreshCounter} />
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
                <p className="section-kicker">Your next steps</p>
                <h2 id="work-bin-heading">Bring in transactions, then tidy them.</h2>
              </div>
              <p>Start with a statement or one manual transaction. Preview it before anything is saved, then resolve anything that needs a category.</p>
            </div>
            <ol className="workflow-steps" aria-label="Ledger workflow">
              <li className="workflow-step is-current">
                <span className="workflow-step-number">1</span>
                <span><strong>Bring in</strong><small>CSV, PDF, or one transaction</small></span>
              </li>
              <li className="workflow-step">
                <span className="workflow-step-number">2</span>
                <span><strong>Review</strong><small>Give uncategorized items a home</small></span>
              </li>
              <li className="workflow-step">
                <span className="workflow-step-number">3</span>
                <span><strong>Keep it safe</strong><small>Back up or export when ready</small></span>
              </li>
            </ol>
            <div className="workflow-groups">
              <div className="workflow-group workflow-group-import" aria-labelledby="bring-in-heading">
                <div className="workflow-group-heading">
                  <p className="group-step">Step 1</p>
                  <h3 id="bring-in-heading">Bring in transactions</h3>
                  <p>Choose the format you already have. We’ll show a preview before importing.</p>
                </div>
                <div className="workflow-import-grid">
                  <ManualEntrySection onEntrySuccess={() => setRefreshCounter((counter) => counter + 1)} />
                  <CsvImportSection onImportSuccess={() => setRefreshCounter((counter) => counter + 1)} />
                  <PdfImportSection onImportSuccess={() => setRefreshCounter((counter) => counter + 1)} />
                </div>
              </div>
              <div className="workflow-group workflow-group-review" aria-labelledby="review-queue-heading">
                <div className="workflow-group-heading">
                  <p className="group-step">Step 2</p>
                  <h3 id="review-queue-heading">Review what needs attention</h3>
                  <p>Unknown merchants stay here until you choose a category. Your choice helps next time.</p>
                </div>
                <CategoryReviewSection
                  refreshKey={refreshCounter}
                  onCategorySaved={() => setRefreshCounter((counter) => counter + 1)}
                />
              </div>
              <div className="workflow-group workflow-group-recovery" aria-labelledby="recovery-heading">
                <div className="workflow-group-heading">
                  <p className="group-step">Step 3</p>
                  <h3 id="recovery-heading">Keep your ledger safe</h3>
                  <p>Save a local backup, export a copy, or restore an earlier snapshot.</p>
                </div>
                <div className="workflow-recovery-grid">
                  <BackupSection />
                  <ExportSection />
                  <RestoreSnapshotSection onRestoreSuccess={() => setRefreshCounter((counter) => counter + 1)} />
                </div>
              </div>
            </div>
          </section>
        </>
      )}
      </main>
    </div>
  );
}
