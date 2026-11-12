import React from "react";
import {
  resolveCurrentReportingPeriod,
  resolveReportingPeriod,
  type ReportingPeriodRange,
} from "../domain/date/reportingPeriods.js";
import {
  DEFAULT_REPORTING_PERIOD_RULE,
  haveSameReportingPeriodRule,
  type ReportingPeriodRule,
} from "../shared/applicationPreferences.js";
import { toLocalIsoDate, toLocalYearMonth } from "../domain/date/localDateDefaults.js";
import "./app.css";
import { AccountCoverageSection } from "./dashboard/AccountCoverageSection.js";
import { loadDashboardData } from "./dashboard/loadDashboardData.js";
import { ExchangeRatesSection } from "./settings/ExchangeRatesSection.js";
import { ReportingPeriodSettingsSection } from "./settings/ReportingPeriodSettingsSection.js";
import { HouseholdSetup } from "./setup/HouseholdSetup.js";
import { DataSafetyWorkspace } from "./workspaces/DataSafetyWorkspace.js";
import { HoldingRegistrySection } from "./workspaces/holding/HoldingRegistrySection.js";
import { ImportWorkspace } from "./workspaces/ImportWorkspace.js";
import { LoanRegistrySection } from "./workspaces/loan/LoanRegistrySection.js";
import { PendingTransactionsWorkspace } from "./workspaces/PendingTransactionsWorkspace.js";
import { PropertyRegistrySection } from "./workspaces/property/PropertyRegistrySection.js";
import { ReviewWorkspace } from "./workspaces/ReviewWorkspace.js";
import { TransactionsWorkspace } from "./workspaces/TransactionsWorkspace.js";
import type { LedgerFilterRequest } from "./dashboard/LedgerSection.js";
import { formatReportingPeriodRange } from "./reportingPeriodDisplay.js";
import type { ReviewState } from "./workspaces/types.js";

const DEFAULT_YEAR_MONTH = toLocalYearMonth(new Date());
const SELECTED_YEAR_MONTH_SESSION_KEY = "budget-planner.selected-review-month";
const CALENDAR_MONTH_RULE: ReportingPeriodRule = DEFAULT_REPORTING_PERIOD_RULE;

function getInitialYearMonth(): string {
  const selectedYearMonth = window.sessionStorage.getItem(SELECTED_YEAR_MONTH_SESSION_KEY);
  return selectedYearMonth !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(selectedYearMonth)
    ? selectedYearMonth
    : DEFAULT_YEAR_MONTH;
}

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
  { id: "activity", label: "Activity", description: "Transactions, pending items, and imports" },
  { id: "accounts", label: "Accounts", description: "Statement coverage and balances" },
  { id: "household", label: "Household", description: "Assets, exchange rates, and data safety" },
];

interface AppProps {
  isBrowserPreview?: boolean;
}

interface ReportLedgerFilterRequest extends LedgerFilterRequest {
  yearMonth: string;
  range: ReportingPeriodRange;
  rule: ReportingPeriodRule;
}

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

export function App({ isBrowserPreview = false }: AppProps = {}): React.JSX.Element {
  const [appState, setAppState] = React.useState<AppState>({ status: "loading" });
  const [initialYearMonth] = React.useState(getInitialYearMonth);
  const [setupRequired, setSetupRequired] = React.useState<boolean | null>(null);
  const [isFirstImport, setIsFirstImport] = React.useState(false);
  const [activeWorkspace, setActiveWorkspace] = React.useState<WorkspaceId>("review");
  const [visitedWorkspaces, setVisitedWorkspaces] = React.useState<Set<WorkspaceId>>(
    () => new Set(["review"])
  );
  const [reviewQueueFocusRequest, setReviewQueueFocusRequest] = React.useState(0);
  const [ledgerFilterRequest, setLedgerFilterRequest] = React.useState<ReportLedgerFilterRequest | null>(null);
  const [refreshCounter, setRefreshCounter] = React.useState(0);
  const [propertyRegistryRevision, setPropertyRegistryRevision] = React.useState(0);
  const [requestedPropertyId, setRequestedPropertyId] = React.useState<string | null>(null);
  const [isChangingMonth, setIsChangingMonth] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [monthChangeError, setMonthChangeError] = React.useState<string | null>(null);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);
  const [savedReportingPeriodRule, setSavedReportingPeriodRule] =
    React.useState<ReportingPeriodRule | null>(null);
  const [reportingPeriodRuleOverride, setReportingPeriodRuleOverride] =
    React.useState<ReportingPeriodRule | null>(null);
  const hasLoadedInitialState = React.useRef(false);
  const selectedYearMonthRef = React.useRef(initialYearMonth);
  const selectedPeriodStartDateIsoRef = React.useRef<string | undefined>(undefined);
  const latestViewRequestRef = React.useRef(0);
  const workspaceRef = React.useRef<HTMLElement>(null);
  const previousWorkspaceRef = React.useRef(activeWorkspace);
  const focusDestinationRef = React.useRef(false);
  const [workspaceAnnouncement, setWorkspaceAnnouncement] = React.useState("");
  const reportSnapshot = appState.status === "ready" && appState.viewContract.state !== "loading"
    ? appState.viewContract.snapshot
    : null;
  const isLedgerReportSelected = ledgerFilterRequest !== null && reportSnapshot !== null &&
    ledgerFilterRequest.yearMonth === reportSnapshot.selectedYearMonth &&
    ledgerFilterRequest.range.startDateIso === reportSnapshot.reportingPeriodRange.startDateIso &&
    ledgerFilterRequest.range.endDateExclusiveIso === reportSnapshot.reportingPeriodRange.endDateExclusiveIso &&
    haveSameReportingPeriodRule(ledgerFilterRequest.rule, reportSnapshot.reportingPeriodRule);

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
    if (appState.status !== "ready") return;
    if (previousWorkspaceRef.current === activeWorkspace) return;
    previousWorkspaceRef.current = activeWorkspace;
    const heading = workspaceRef.current?.querySelector(".destination-workspace:not([hidden]) h2");
    setWorkspaceAnnouncement(heading?.textContent ?? activeWorkspace);
    if (focusDestinationRef.current) focusWorkspaceHeading();
    focusDestinationRef.current = false;
  }, [activeWorkspace, appState.status]);

  React.useEffect(() => {
    let isActive = true;
    const requestId = latestViewRequestRef.current + 1;
    latestViewRequestRef.current = requestId;
    const isInitialLoad = !hasLoadedInitialState.current;
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
          window.budgetApi.reportingPreferences.getPeriodRule(),
        ] as const).then(async ([dashboardData, storedReportingPeriodRule]) => {
          const activeRule = reportingPeriodRuleOverride ?? storedReportingPeriodRule;
          const currentReportingPeriod = isInitialLoad && activeRule.type !== "calendar-month"
            ? resolveCurrentReportingPeriod(activeRule, toLocalIsoDate(new Date()))
            : null;
          const selectedYearMonth = currentReportingPeriod !== null
            ? currentReportingPeriod.startDateIso.slice(0, 7)
            : requestedYearMonth;
          const selectedPeriodStartDateIso = activeRule.type === "two-fixed-days"
            ? currentReportingPeriod?.startDateIso ?? selectedPeriodStartDateIsoRef.current
            : undefined;
          const viewContract = await window.budgetApi.dashboard.getViewData(
            selectedYearMonth,
            activeRule,
            selectedPeriodStartDateIso
          );
          return {
            dashboardData,
            viewContract,
            selectedYearMonth,
            selectedPeriodStartDateIso,
            storedReportingPeriodRule,
          };
        });
      })
      .then((loadedData) => {
        if (loadedData === null || !isActive || requestId !== latestViewRequestRef.current) return;
        const {
          dashboardData,
          viewContract,
          selectedYearMonth,
          selectedPeriodStartDateIso,
          storedReportingPeriodRule,
        } = loadedData;
        hasLoadedInitialState.current = true;
        setSavedReportingPeriodRule(storedReportingPeriodRule);
        setIsRefreshing(false);
        setRefreshError(null);
        const availableMonths = dashboardData.monthlyTotals.map((t) => t.yearMonth);
        if (!availableMonths.includes(requestedYearMonth)) availableMonths.unshift(requestedYearMonth);
        if (!availableMonths.includes(selectedYearMonth)) availableMonths.unshift(selectedYearMonth);
        selectedYearMonthRef.current = selectedYearMonth;
        selectedPeriodStartDateIsoRef.current = selectedPeriodStartDateIso;
        setAppState({
          status: "ready",
          dashboardData,
          viewContract,
          selectedYearMonth,
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
  }, [refreshCounter, reportingPeriodRuleOverride]);

  function handleMonthChange(selection: string): void {
    if (appState.status !== "ready") return;

    const requestId = latestViewRequestRef.current + 1;
    latestViewRequestRef.current = requestId;
    setIsChangingMonth(true);
    setMonthChangeError(null);
    const activeRule = reportingPeriodRuleOverride ?? savedReportingPeriodRule ?? CALENDAR_MONTH_RULE;
    const selectedPeriodStartDateIso = activeRule.type === "two-fixed-days"
      ? selection
      : undefined;
    const yearMonth = selectedPeriodStartDateIso === undefined
      ? selection
      : selection.slice(0, 7);
    window.budgetApi.dashboard
      .getViewData(yearMonth, activeRule, selectedPeriodStartDateIso)
      .then((viewContract) => {
        if (requestId !== latestViewRequestRef.current) return;
        window.sessionStorage.setItem(SELECTED_YEAR_MONTH_SESSION_KEY, yearMonth);
        setAppState((prev) => {
          if (prev.status !== "ready") return prev;
          return {
            ...prev,
            viewContract,
            selectedYearMonth: yearMonth,
            availableMonths: [...new Set([...prev.availableMonths, yearMonth])].sort(),
          };
        });
        selectedYearMonthRef.current = yearMonth;
        selectedPeriodStartDateIsoRef.current = selectedPeriodStartDateIso;
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

  function handleReportingModeChange(mode: "calendar-month" | "payday-period"): void {
    const selectedYearMonth = appState.status === "ready"
      ? appState.selectedYearMonth
      : initialYearMonth;
    selectedPeriodStartDateIsoRef.current =
      mode === "payday-period" && savedReportingPeriodRule?.type === "two-fixed-days"
        ? resolveReportingPeriod(savedReportingPeriodRule, selectedYearMonth).startDateIso
        : undefined;
    setReportingPeriodRuleOverride(mode === "calendar-month" ? CALENDAR_MONTH_RULE : null);
    selectedYearMonthRef.current = selectedYearMonth;
    window.sessionStorage.setItem(SELECTED_YEAR_MONTH_SESSION_KEY, selectedYearMonth);
    setRefreshCounter((counter) => counter + 1);
  }

  function handleReportingPeriodPreferenceSaved(rule: ReportingPeriodRule): void {
    setSavedReportingPeriodRule(rule);
    showCurrentReportingPeriod(rule);
  }

  function showCurrentReportingPeriod(rule: ReportingPeriodRule): void {
    setReportingPeriodRuleOverride(null);
    const currentReportingPeriod = resolveCurrentReportingPeriod(rule, toLocalIsoDate(new Date()));
    const selectedYearMonth = currentReportingPeriod.startDateIso.slice(0, 7);
    selectedPeriodStartDateIsoRef.current = rule.type === "two-fixed-days"
      ? currentReportingPeriod.startDateIso
      : undefined;
    selectedYearMonthRef.current = selectedYearMonth;
    window.sessionStorage.setItem(SELECTED_YEAR_MONTH_SESSION_KEY, selectedYearMonth);
    setRefreshCounter((counter) => counter + 1);
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
    setIsFirstImport(false);
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

  function openPeriodTransactions(range: ReportingPeriodRange, rule: ReportingPeriodRule): void {
    if (appState.status !== "ready") return;
    const inclusiveEnd = new Date(`${range.endDateExclusiveIso}T00:00:00.000Z`);
    inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
    setLedgerFilterRequest((previous) => ({
      id: (previous?.id ?? 0) + 1,
      yearMonth: appState.selectedYearMonth,
      range,
      rule,
      filters: {
        bookedFromIso: range.startDateIso,
        bookedToIso: inclusiveEnd.toISOString().slice(0, 10),
        dateBasis: "booking-date",
      },
      description: `${rule.type === "calendar-month" ? "Calendar month" : "Payday period"}: ${formatReportingPeriodRange(range)}`,
    }));
    openWorkspace("transactions", true);
  }

  function returnToReport(): void {
    if (ledgerFilterRequest !== null && (!isLedgerReportSelected || isChangingMonth || isRefreshing)) {
      latestViewRequestRef.current += 1;
      selectedYearMonthRef.current = ledgerFilterRequest.yearMonth;
      selectedPeriodStartDateIsoRef.current = ledgerFilterRequest.rule.type === "two-fixed-days"
        ? ledgerFilterRequest.range.startDateIso
        : undefined;
      window.sessionStorage.setItem(SELECTED_YEAR_MONTH_SESSION_KEY, ledgerFilterRequest.yearMonth);
      setReportingPeriodRuleOverride(ledgerFilterRequest.rule);
      setRefreshCounter((counter) => counter + 1);
    }
    openWorkspace("review", true);
  }

  function handleSetupComplete(): void {
    setSetupRequired(false);
    setIsFirstImport(true);
    openWorkspace("import", true);
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
      {isBrowserPreview && (
        <div className="browser-preview-banner" role="status">
          <strong>Browser preview</strong>
          <span>
            Synthetic sandbox. Category targets are editable in this browser session; other local
            services require the desktop app.
          </span>
        </div>
      )}
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
          <span>{isBrowserPreview ? "Synthetic data" : "On device"}</span>
          <span className={headerStatusClassName}>
            <i aria-hidden="true" /> {headerStatus}
          </span>
          </div>
          <button hidden={isFirstImport && activeWorkspace === "import"} className="header-import-action" type="button" onClick={() => openWorkspace("import", true)}>
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
              aria-describedby={`${workspace.id}-workspace-description`}
              aria-current={primaryWorkspaceFor(activeWorkspace) === workspace.id ? "page" : undefined}
              className={primaryWorkspaceFor(activeWorkspace) === workspace.id ? "workspace-link is-current" : "workspace-link"}
              onClick={() => openPrimaryWorkspace(workspace.id)}
            >
              <span>{workspace.label}</span>
              <small id={`${workspace.id}-workspace-description`}>{workspace.description}</small>
            </button>
          ))}
        </nav>

        <main className="workspace" id="workspace" tabIndex={-1} ref={workspaceRef}>
          <p className="workspace-announcement" role="status" aria-label="Workspace destination">
            {workspaceAnnouncement}
          </p>
          {!isFirstImport && (activeWorkspace === "transactions" ||
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
                ["settings", "Settings"],
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
            onOpenPeriodTransactions={openPeriodTransactions}
            onOpenCoverage={() => openWorkspace("coverage")}
            onOpenExchangeRates={() => openWorkspace("settings", true)}
            onTargetSaved={() => setRefreshCounter((counter) => counter + 1)}
            onRetry={() => setRefreshCounter((counter) => counter + 1)}
            savedReportingPeriodRule={savedReportingPeriodRule}
            onReportingModeChange={handleReportingModeChange}
          />
          {visitedWorkspaces.has("transactions") && (
            <TransactionsWorkspace
              isActive={activeWorkspace === "transactions"}
              refreshKey={refreshCounter}
              reviewQueueFocusRequest={reviewQueueFocusRequest}
              filterRequest={ledgerFilterRequest}
              isReportSelected={isLedgerReportSelected}
              isReportCurrent={!isChangingMonth && !isRefreshing && refreshError === null}
              onBackToReview={returnToReport}
              onCategorySaved={() => setRefreshCounter((counter) => counter + 1)}
            />
          )}
          {visitedWorkspaces.has("coverage") && (
            <section
              className="destination-workspace"
              aria-label="Coverage workspace"
              hidden={activeWorkspace !== "coverage"}
            >
              <AccountCoverageSection
                refreshKey={refreshCounter}
                onAccountsChanged={() => setRefreshCounter((counter) => counter + 1)}
              />
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
              isFirstImport={isFirstImport}
              onExplore={() => {
                setIsFirstImport(false);
                openWorkspace("import", true);
              }}
              isActive={activeWorkspace === "import"}
              refreshKey={refreshCounter}
              onImportSuccess={() => {
                setIsFirstImport(false);
                setRefreshCounter((counter) => counter + 1);
              }}
              onOpenLedger={() => openWorkspace("transactions", true)}
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
                <h2>Settings</h2>
                <p>Set how household reporting periods are calculated. Your data stays on this device.</p>
              </div>
              <ReportingPeriodSettingsSection onSaved={handleReportingPeriodPreferenceSaved} />
              <section className="settings-exchange-rates" aria-labelledby="exchange-rates-heading">
                <div className="reporting-preferences-heading">
                  <div>
                    <h3 id="exchange-rates-heading">Exchange rates</h3>
                    <p>Record local rates for NOK comparison and valuation reports.</p>
                  </div>
                </div>
                <ExchangeRatesSection onRatesChanged={() => setRefreshCounter((counter) => counter + 1)} />
              </section>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
