import React from "react";
import "./app.css";
import { loadDashboardData } from "./dashboard/loadDashboardData.js";
import {
  DataSafetyWorkspace,
  HoldingRegistrySection,
  PropertyRegistrySection,
} from "./workspaces/DataSafetyWorkspace.js";
import { LoanRegistrySection } from "./workspaces/LoanRegistrySection.js";
import { ImportWorkspace } from "./workspaces/ImportWorkspace.js";
import { PendingTransactionsWorkspace } from "./workspaces/PendingTransactionsWorkspace.js";
import { ReviewWorkspace } from "./workspaces/ReviewWorkspace.js";
import { TransactionsWorkspace } from "./workspaces/TransactionsWorkspace.js";
import { AccountCoverageSection } from "./dashboard/AccountCoverageSection.js";
import { ExchangeRatesSection } from "./settings/ExchangeRatesSection.js";
import { HouseholdSetup } from "./setup/HouseholdSetup.js";
import { toLocalYearMonth } from "./localDate.js";
import type { ReviewState } from "./workspaces/types.js";

const DEFAULT_YEAR_MONTH = toLocalYearMonth(new Date());
type AppState = ReviewState;

type WorkspaceId =
  | "review"
  | "transactions"
  | "coverage"
  | "pending"
  | "import"
  | "properties"
  | "loans"
  | "investments"
  | "data-safety"
  | "settings";
type PrimaryWorkspaceId = "review" | "activity" | "accounts" | "household";

const PRIMARY_WORKSPACES: Array<{ id: PrimaryWorkspaceId; label: string; description: string }> = [
  { id: "review", label: "Review", description: "Monthly position" },
  { id: "activity", label: "Activity", description: "Transactions and imports" },
  { id: "accounts", label: "Accounts", description: "Statements and balances" },
  { id: "household", label: "Household", description: "Assets, rates and recovery" },
];

function primaryWorkspaceFor(workspace: WorkspaceId): PrimaryWorkspaceId {
  if (workspace === "transactions" || workspace === "pending" || workspace === "import") {
    return "activity";
  }
  if (
    workspace === "properties" ||
    workspace === "loans" ||
    workspace === "investments" ||
    workspace === "data-safety" ||
    workspace === "settings"
  ) {
    return "household";
  }
  if (workspace === "coverage") return "accounts";
  return "review";
}

export function App(): React.JSX.Element {
  const [appState, setAppState] = React.useState<AppState>({ status: "loading" });
  const [setupRequired, setSetupRequired] = React.useState<boolean | null>(null);
  const [activeWorkspace, setActiveWorkspace] = React.useState<WorkspaceId>("review");
  const [visitedWorkspaces, setVisitedWorkspaces] = React.useState<Set<WorkspaceId>>(
    () => new Set(["review"])
  );
  const [reviewQueueFocusRequest, setReviewQueueFocusRequest] = React.useState(0);
  const [refreshCounter, setRefreshCounter] = React.useState(0);
  const [propertyRegistryRevision, setPropertyRegistryRevision] = React.useState(0);
  const [requestedPropertyId, setRequestedPropertyId] = React.useState<string | null>(null);
  const [isChangingMonth, setIsChangingMonth] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [monthChangeError, setMonthChangeError] = React.useState<string | null>(null);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);
  const hasLoadedInitialState = React.useRef(false);
  const selectedYearMonthRef = React.useRef(DEFAULT_YEAR_MONTH);
  const latestViewRequestRef = React.useRef(0);
  const workspaceRef = React.useRef<HTMLElement>(null);
  const previousWorkspaceRef = React.useRef(activeWorkspace);
  const focusDestinationRef = React.useRef(false);
  const [workspaceAnnouncement, setWorkspaceAnnouncement] = React.useState("");

  function focusWorkspaceHeading(): void {
    const heading = workspaceRef.current?.querySelector<HTMLHeadingElement>(
      ".destination-workspace:not([hidden]) h2"
    );
    if (heading !== null && heading !== undefined) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }

  React.useEffect(() => {
    if (previousWorkspaceRef.current === activeWorkspace) return;
    previousWorkspaceRef.current = activeWorkspace;
    const heading = workspaceRef.current?.querySelector(".destination-workspace:not([hidden]) h2");
    setWorkspaceAnnouncement(heading?.textContent ?? activeWorkspace);
    if (focusDestinationRef.current) focusWorkspaceHeading();
    focusDestinationRef.current = false;
  }, [activeWorkspace]);

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

    window.budgetApi.setup
      .isRequired()
      .then((required) => {
        if (!isActive) return null;
        setSetupRequired(required);
        if (required) return null;
        return Promise.all([
          loadDashboardData(window.budgetApi),
          window.budgetApi.dashboard.getViewData(requestedYearMonth),
        ] as const);
      })
      .then((loadedData) => {
        if (loadedData === null || !isActive || requestId !== latestViewRequestRef.current) return;
        const [dashboardData, viewContract] = loadedData;
        hasLoadedInitialState.current = true;
        setIsRefreshing(false);
        setRefreshError(null);
        const availableMonths = dashboardData.monthlyTotals.map((t) => t.yearMonth);
        if (!availableMonths.includes(requestedYearMonth)) availableMonths.unshift(requestedYearMonth);
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

  function openWorkspace(workspaceId: WorkspaceId, focusDestination = false): void {
    if (workspaceId === activeWorkspace && focusDestination) focusWorkspaceHeading();
    focusDestinationRef.current = focusDestination;
    setActiveWorkspace(workspaceId);
    setVisitedWorkspaces((current) => {
      if (current.has(workspaceId)) return current;
      const next = new Set(current);
      next.add(workspaceId);
      return next;
    });
  }

  function openPropertyRecord(propertyId: string): void {
    setRequestedPropertyId(propertyId);
    openWorkspace("properties");
  }

  function openPrimaryWorkspace(workspaceId: PrimaryWorkspaceId): void {
    const defaultWorkspace: Record<PrimaryWorkspaceId, WorkspaceId> = {
      review: "review",
      activity: "transactions",
      accounts: "coverage",
      household: "properties",
    };
    openWorkspace(defaultWorkspace[workspaceId]);
  }

  function openReviewQueue(): void {
    openWorkspace("transactions");
    setReviewQueueFocusRequest((request) => request + 1);
  }

  function handleSetupComplete(): void {
    setSetupRequired(false);
    setRefreshCounter((counter) => counter + 1);
  }

  if (setupRequired) {
    return <HouseholdSetup onComplete={handleSetupComplete} />;
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
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-stamp" aria-hidden="true">BP</span>
          <div>
            <h1>Budget Planner</h1>
            <p>Local household ledger</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="header-meta" aria-label="Application status" aria-live="polite">
          <span>On device</span>
          <span className={headerStatusClassName}>
            <i aria-hidden="true" /> {headerStatus}
          </span>
          </div>
          <button className="header-import-action" type="button" onClick={() => openWorkspace("import", true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" />
            </svg>
            Import statement
          </button>
        </div>
      </header>

      <div className="app-frame">
        <nav className="primary-navigation" aria-label="Primary">
          {PRIMARY_WORKSPACES.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              aria-label={workspace.label}
              aria-current={primaryWorkspaceFor(activeWorkspace) === workspace.id ? "page" : undefined}
              className={primaryWorkspaceFor(activeWorkspace) === workspace.id ? "workspace-link is-current" : "workspace-link"}
              onClick={() => openPrimaryWorkspace(workspace.id)}
            >
              <span>{workspace.label}</span>
              <small aria-hidden="true">{workspace.description}</small>
            </button>
          ))}
        </nav>

        <main className="workspace" id="workspace" tabIndex={-1} ref={workspaceRef}>
          <p className="workspace-announcement" role="status" aria-label="Workspace destination">
            {workspaceAnnouncement}
          </p>
          {(activeWorkspace === "transactions" ||
            activeWorkspace === "pending" ||
            activeWorkspace === "import") && (
            <nav className="workspace-subnavigation" aria-label="Activity views">
              {([
                ["transactions", "Transactions"],
                ["pending", "Pending"],
                ["import", "Import"],
              ] as const).map(([workspaceId, label]) => (
                <button
                  key={workspaceId}
                  type="button"
                  aria-current={activeWorkspace === workspaceId ? "page" : undefined}
                  onClick={() => openWorkspace(workspaceId)}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
          {(activeWorkspace === "properties" ||
            activeWorkspace === "loans" ||
            activeWorkspace === "investments" ||
            activeWorkspace === "data-safety" ||
            activeWorkspace === "settings") && (
            <nav className="workspace-subnavigation" aria-label="Household tools">
              {([
                ["properties", "Properties"],
                ["loans", "Loans"],
                ["investments", "Investments"],
                ["settings", "Exchange rates"],
                ["data-safety", "Data safety"],
              ] as const).map(([workspaceId, label]) => (
                <button
                  key={workspaceId}
                  type="button"
                  aria-current={activeWorkspace === workspaceId ? "page" : undefined}
                  onClick={() => openWorkspace(workspaceId)}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
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
            refreshKey={refreshCounter}
            monthChangeError={monthChangeError}
            refreshError={refreshError}
            onMonthChange={handleMonthChange}
            onOpenTransactions={openReviewQueue}
            onOpenCoverage={() => openWorkspace("coverage")}
            onTargetSaved={() => setRefreshCounter((counter) => counter + 1)}
            onRetry={() => setRefreshCounter((counter) => counter + 1)}
          />
          {visitedWorkspaces.has("transactions") && (
            <TransactionsWorkspace
              isActive={activeWorkspace === "transactions"}
              refreshKey={refreshCounter}
              reviewQueueFocusRequest={reviewQueueFocusRequest}
              onCategorySaved={() => setRefreshCounter((counter) => counter + 1)}
            />
          )}
          {visitedWorkspaces.has("coverage") && (
            <section
              className="destination-workspace"
              aria-label="Coverage workspace"
              hidden={activeWorkspace !== "coverage"}
            >
              <AccountCoverageSection />
            </section>
          )}
          {visitedWorkspaces.has("pending") && (
            <PendingTransactionsWorkspace
              isActive={activeWorkspace === "pending"}
              refreshKey={refreshCounter}
              onOpenTransactions={() => openWorkspace("transactions")}
            />
          )}
          {visitedWorkspaces.has("import") && (
            <ImportWorkspace
              isActive={activeWorkspace === "import"}
              refreshKey={refreshCounter}
              onImportSuccess={() => setRefreshCounter((counter) => counter + 1)}
              onOpenLedger={() => openWorkspace("transactions")}
              onReviewUncategorized={openReviewQueue}
            />
          )}
          {visitedWorkspaces.has("data-safety") && (
            <DataSafetyWorkspace
              isActive={activeWorkspace === "data-safety"}
              onRestoreSuccess={() => setRefreshCounter((counter) => counter + 1)}
            />
          )}
          {visitedWorkspaces.has("properties") && (
            <section
              className="destination-workspace household-workspace"
              aria-label="Properties workspace"
              hidden={activeWorkspace !== "properties"}
            >
              <div className="destination-heading">
                <h2>Properties</h2>
                <p>
                  Track dated property values. Entries stay on this device and are included in
                  backup snapshots.
                </p>
              </div>
              <PropertyRegistrySection
                isActive={activeWorkspace === "properties"}
                refreshRevision={refreshCounter}
                requestedPropertyId={requestedPropertyId}
                onPropertyRegistryChange={() => {
                  setPropertyRegistryRevision((revision) => revision + 1);
                }}
              />
            </section>
          )}
          {visitedWorkspaces.has("loans") && (
            <section
              className="destination-workspace household-workspace"
              aria-label="Loans workspace"
              hidden={activeWorkspace !== "loans"}
            >
              <div className="destination-heading">
                <h2>Loans</h2>
                <p>
                  Review loan terms and dated balances. Original currencies are preserved without
                  rate or network lookups.
                </p>
              </div>
              <LoanRegistrySection
                isActive={activeWorkspace === "loans"}
                refreshRevision={refreshCounter + propertyRegistryRevision}
                onViewProperty={openPropertyRecord}
              />
            </section>
          )}
          {visitedWorkspaces.has("investments") && (
            <section
              className="destination-workspace household-workspace"
              aria-label="Investments workspace"
              hidden={activeWorkspace !== "investments"}
            >
              <div className="destination-heading">
                <h2>Investments</h2>
                <p>
                  Record holdings and dated values manually. Entries stay on this device and
                  preserve original currencies without brokerage, market-quote, or exchange-rate
                  lookups.
                </p>
              </div>
              <HoldingRegistrySection
                isActive={activeWorkspace === "investments"}
                refreshRevision={refreshCounter}
              />
            </section>
          )}
          {visitedWorkspaces.has("settings") && (
            <section
              className="destination-workspace"
              aria-label="Settings workspace"
              hidden={activeWorkspace !== "settings"}
            >
              <div className="destination-heading">
                <h2>Exchange rates</h2>
                <p>Record rates locally and use them to compare household spending.</p>
              </div>
              <ExchangeRatesSection />
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
