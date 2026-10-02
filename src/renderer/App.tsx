import React from "react";
import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "./app.css";
import { loadDashboardData } from "./dashboard/loadDashboardData.js";
import { DataSafetyWorkspace } from "./workspaces/DataSafetyWorkspace.js";
import { ImportWorkspace } from "./workspaces/ImportWorkspace.js";
import { ReviewWorkspace } from "./workspaces/ReviewWorkspace.js";
import { TransactionsWorkspace } from "./workspaces/TransactionsWorkspace.js";
import type { ReviewState } from "./workspaces/types.js";

const DEFAULT_YEAR_MONTH = "2026-05";
type AppState = ReviewState;

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
  const [visitedWorkspaces, setVisitedWorkspaces] = React.useState<Set<WorkspaceId>>(
    () => new Set(["review"])
  );
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
          setMonthChangeError(
            "Unable to change month. Your current review remains visible. Select a month again to retry."
          );
      });
  }

  function openWorkspace(workspaceId: WorkspaceId): void {
    setActiveWorkspace(workspaceId);
    setVisitedWorkspaces((current) => {
      if (current.has(workspaceId)) return current;
      const next = new Set(current);
      next.add(workspaceId);
      return next;
    });
  }

  const headerStatus =
    appState.status === "loading"
      ? "Loading review"
      : appState.status === "error"
        ? "Review unavailable"
        : refreshError !== null
          ? "Review needs attention"
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
              onClick={() => openWorkspace(workspace.id)}
            >
              <span>{workspace.label}</span>
              <small aria-hidden="true">{workspace.description}</small>
            </button>
          ))}
        </nav>

        <main className="workspace">
          {activeWorkspace !== "review" && appState.status === "error" && (
            <section className="status-panel status-error" role="alert">
              <div className="status-heading">
                <span className="status-marker" aria-hidden="true">!</span>
                <h2>Review unavailable</h2>
              </div>
              <p>{appState.message}</p>
              <button type="button" onClick={() => setRefreshCounter((counter) => counter + 1)}>
                Try again
              </button>
            </section>
          )}
          {activeWorkspace !== "review" && refreshError !== null && (
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
          <ReviewWorkspace
            state={appState}
            isActive={activeWorkspace === "review"}
            isChangingMonth={isChangingMonth}
            isRefreshing={isRefreshing}
            monthChangeError={monthChangeError}
            refreshError={refreshError}
            onMonthChange={handleMonthChange}
            onOpenTransactions={() => openWorkspace("transactions")}
            onRetry={() => setRefreshCounter((counter) => counter + 1)}
          />
          {visitedWorkspaces.has("transactions") && (
            <TransactionsWorkspace
              isActive={activeWorkspace === "transactions"}
              refreshKey={refreshCounter}
              onCategorySaved={() => setRefreshCounter((counter) => counter + 1)}
            />
          )}
          {visitedWorkspaces.has("import") && (
            <ImportWorkspace
              isActive={activeWorkspace === "import"}
              onImportSuccess={() => setRefreshCounter((counter) => counter + 1)}
            />
          )}
          {visitedWorkspaces.has("data-safety") && (
            <DataSafetyWorkspace
              isActive={activeWorkspace === "data-safety"}
              onRestoreSuccess={() => setRefreshCounter((counter) => counter + 1)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
