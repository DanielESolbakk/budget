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

type WorkspaceId = "review" | "transactions" | "import" | "data-safety";

const WORKSPACES: Array<{ id: WorkspaceId; label: string; description: string }> = [
  { id: "review", label: "Review", description: "Monthly position" },
  { id: "transactions", label: "Transactions", description: "Ledger and corrections" },
  { id: "import", label: "Import", description: "Bring in activity" },
  { id: "data-safety", label: "Data safety", description: "Backup and export" },
];

export function App(): React.JSX.Element {
  const [appState, setAppState] = React.useState<AppState>({ status: "loading" });
  const [activeWorkspace, setActiveWorkspace] = React.useState<WorkspaceId>("review");
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

      <div className="app-frame">
        <nav className="primary-navigation" aria-label="Primary">
          {WORKSPACES.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              aria-label={workspace.label}
              aria-current={activeWorkspace === workspace.id ? "page" : undefined}
              className={activeWorkspace === workspace.id ? "workspace-link is-current" : "workspace-link"}
              onClick={() => setActiveWorkspace(workspace.id)}
            >
              <span>{workspace.label}</span>
              <small aria-hidden="true">{workspace.description}</small>
            </button>
          ))}
        </nav>

        <main className="workspace">
          {appState.status === "loading" && (
            <section className="status-panel status-loading" aria-live="polite">
              <div className="status-heading">
                <span className="status-marker" aria-hidden="true" />
                <h2>Loading your household ledger</h2>
              </div>
              <div className="skeleton-line skeleton-line-wide" />
              <div className="skeleton-line skeleton-line-short" />
            </section>
          )}
          {appState.status === "error" && (
            <section className="status-panel status-error" role="alert">
              <div className="status-heading">
                <span className="status-marker" aria-hidden="true">!</span>
                <h2>Household ledger unavailable</h2>
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

              {activeWorkspace === "review" && (
                <section className="destination-workspace" aria-label="Review workspace">
                  <div className="review-intro">
                    <div>
                      <h2>Monthly review</h2>
                      <p className="intro-copy">See the month clearly, then act on what needs attention.</p>
                    </div>
                    <div className="month-picker">
                      <label htmlFor="month-select">Reviewing</label>
                      <select
                        id="month-select"
                        aria-label="Select month"
                        value={appState.selectedYearMonth}
                        onChange={(event) => handleMonthChange(event.target.value)}
                      >
                        {appState.availableMonths.map((month) => (
                          <option key={month} value={month}>{formatYearMonth(month)}</option>
                        ))}
                      </select>
                      <span className="month-picker-code">{appState.selectedYearMonth}</span>
                    </div>
                  </div>
                  {isChangingMonth && <p className="rail-status" role="status">Updating month...</p>}
                  {monthChangeError !== null && <p className="rail-status is-error" role="alert">{monthChangeError}</p>}
                  <div className="review-grid" aria-busy={isChangingMonth || isRefreshing}>
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
                </section>
              )}

              {activeWorkspace === "transactions" && (
                <section className="destination-workspace" aria-label="Transactions workspace">
                  <div className="destination-heading">
                    <h2>Transactions</h2>
                    <p>Search the ledger and resolve entries that still need a category.</p>
                  </div>
                  <div className="transactions-workspace-grid">
                    <LedgerSection refreshKey={refreshCounter} />
                    <CategoryReviewSection
                      refreshKey={refreshCounter}
                      onCategorySaved={() => setRefreshCounter((counter) => counter + 1)}
                    />
                  </div>
                </section>
              )}

              {activeWorkspace === "import" && (
                <section className="destination-workspace" aria-label="Import workspace">
                  <div className="destination-heading">
                    <h2>Import</h2>
                    <p>Add one transaction or preview a statement before anything is saved.</p>
                  </div>
                  <div className="workflow-import-grid">
                    <ManualEntrySection onEntrySuccess={() => setRefreshCounter((counter) => counter + 1)} />
                    <CsvImportSection onImportSuccess={() => setRefreshCounter((counter) => counter + 1)} />
                    <PdfImportSection onImportSuccess={() => setRefreshCounter((counter) => counter + 1)} />
                  </div>
                </section>
              )}

              {activeWorkspace === "data-safety" && (
                <section className="destination-workspace" aria-label="Data safety workspace">
                  <div className="destination-heading">
                    <h2>Data safety</h2>
                    <p>Back up the local ledger, export a portable copy, or restore a snapshot.</p>
                  </div>
                  <div className="workflow-recovery-grid">
                    <BackupSection />
                    <ExportSection />
                    <RestoreSnapshotSection onRestoreSuccess={() => setRefreshCounter((counter) => counter + 1)} />
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
