import React from "react";
import { getMonthlyAttentionSummary, type DashboardViewContract } from "../../shared/dashboard.js";
import {
  getAdjacentReportingPeriod,
  resolveCurrentReportingPeriod,
  resolveReportingPeriod,
} from "../../domain/date/reportingPeriods.js";
import type { ReportingPeriodRule } from "../../shared/applicationPreferences.js";
import { CategoryBreakdownSection } from "../dashboard/CategoryBreakdownSection.js";
import { CategoryTargetEntrySection } from "../dashboard/CategoryTargetEntrySection.js";
import { CashflowScenarioSection } from "../dashboard/CashflowScenarioSection.js";
import { ForecastSection } from "../dashboard/ForecastSection.js";
import { MonthlyTotalsSection } from "../dashboard/MonthlyTotalsSection.js";
import { RecurringCommitmentsSection } from "../dashboard/RecurringCommitmentsSection.js";
import { SpendableCashSection } from "../dashboard/SpendableCashSection.js";
import { TargetVsActualSection } from "../dashboard/TargetVsActualSection.js";
import { AccountCoverageSummary } from "../dashboard/AccountCoverageSummary.js";
import { formatReportingPeriodRange } from "../reportingPeriodDisplay.js";
import { toLocalIsoDate } from "../../domain/date/localDateDefaults.js";
import type { ReviewState } from "./types.js";

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

interface ReviewWorkspaceProps {
  state: ReviewState;
  isActive: boolean;
  isChangingMonth: boolean;
  isRefreshing: boolean;
  refreshKey: number;
  monthChangeError: string | null;
  refreshError: string | null;
  savedReportingPeriodRule: ReportingPeriodRule | null;
  onMonthChange: (yearMonth: string) => void;
  onReportingModeChange: (mode: "calendar-month" | "payday-period") => void;
  onOpenTransactions: () => void;
  onOpenCoverage: () => void;
  onTargetSaved: () => void;
  onRetry: () => void;
}

export function ReviewWorkspace({
  state,
  isActive,
  isChangingMonth,
  isRefreshing,
  refreshKey,
  monthChangeError,
  refreshError,
  savedReportingPeriodRule,
  onMonthChange,
  onReportingModeChange,
  onOpenTransactions,
  onOpenCoverage,
  onTargetSaved,
  onRetry,
}: ReviewWorkspaceProps): React.JSX.Element {
  const viewContract: DashboardViewContract | null = state.status === "ready" ? state.viewContract : null;
  const monthlyAttention = viewContract === null ? null : getMonthlyAttentionSummary(viewContract);
  const snapshot = viewContract === null || viewContract.state === "loading"
    ? null
    : viewContract.snapshot;
  const isCalendarMonth = snapshot?.reportingPeriodRule.type === "calendar-month";
  const isTwoFixedDayRule = snapshot?.reportingPeriodRule.type === "two-fixed-days";
  const currentPeriod = snapshot === null ? null : resolveCurrentReportingPeriod(
    snapshot.reportingPeriodRule,
    toLocalIsoDate(new Date())
  );
  const periodMonths = state.status === "ready"
    ? [...new Set([
      ...state.availableMonths,
      state.selectedYearMonth,
      ...(currentPeriod === null ? [] : [currentPeriod.startDateIso.slice(0, 7)]),
    ])].sort()
    : [];
  const twoFixedDayPeriodOptions = isTwoFixedDayRule && state.status === "ready" && snapshot !== null
    ? periodMonths
      .flatMap((yearMonth) => [
        resolveReportingPeriod(snapshot.reportingPeriodRule, yearMonth, 0),
        resolveReportingPeriod(snapshot.reportingPeriodRule, yearMonth, 1),
      ])
      .filter((period, index, periods) =>
        periods.findIndex((candidate) => candidate.startDateIso === period.startDateIso) === index
      )
    : [];
  const hasSavedPaydayRule = savedReportingPeriodRule !== null &&
    savedReportingPeriodRule.type !== "calendar-month";
  const previousPeriod = snapshot === null || snapshot.reportingPeriodRange.startDateIso.startsWith("0000-01")
    ? null
    : getAdjacentReportingPeriod(
        snapshot.reportingPeriodRule,
        snapshot.reportingPeriodRange.startDateIso,
        "previous"
      );
  const nextPeriod = snapshot === null || snapshot.reportingPeriodRange.startDateIso.startsWith("9999-12")
    ? null
    : getAdjacentReportingPeriod(
        snapshot.reportingPeriodRule,
        snapshot.reportingPeriodRange.startDateIso,
        "next"
      );
  const planningToolsRef = React.useRef<HTMLDetailsElement>(null);
  const [isTargetFormOpen, setIsTargetFormOpen] = React.useState(false);
  const isPeriodSelectionDisabled = isTargetFormOpen || isChangingMonth || isRefreshing;
  const isReportingOverride = hasSavedPaydayRule && isCalendarMonth;
  const isCurrentPeriod = snapshot?.reportingPeriodRange.startDateIso === currentPeriod?.startDateIso;
  const isFuturePeriod = snapshot !== null && currentPeriod !== null &&
    snapshot.reportingPeriodRange.startDateIso > currentPeriod.startDateIso;
  const latestRecordedMonth = state.status === "ready"
    ? state.dashboardData.monthlyTotals.map((total) => total.yearMonth).sort().at(-1)
    : undefined;
  const latestRecordedPeriod = snapshot === null || latestRecordedMonth === undefined
    ? null
    : resolveReportingPeriod(snapshot.reportingPeriodRule, latestRecordedMonth, isTwoFixedDayRule ? 1 : 0);
  const canNavigateForward = nextPeriod !== null && currentPeriod !== null &&
    (nextPeriod.startDateIso <= currentPeriod.startDateIso ||
      (latestRecordedPeriod !== null && nextPeriod.startDateIso <= latestRecordedPeriod.startDateIso));

  function openPlanningTools(): void {
    if (planningToolsRef.current !== null) planningToolsRef.current.open = true;
  }

  function navigateToPeriod(startDateIso: string): void {
    onMonthChange(isTwoFixedDayRule ? startDateIso : startDateIso.slice(0, 7));
  }

  return (
    <section
      className="destination-workspace"
      aria-label="Review workspace"
      aria-busy={state.status === "loading" || isChangingMonth || isRefreshing}
      hidden={!isActive}
    >
      <div className="review-intro">
        <div>
          <h2>{isCalendarMonth === false ? "Payday-period review" : "Monthly review"}</h2>
          <p className="intro-copy">
            {isCalendarMonth === false
              ? "Review recorded income and spending between paydays, then act on what needs attention."
              : "See the month clearly, then act on what needs attention."}
          </p>
        </div>
      </div>

      {state.status === "loading" && (
        <section className="status-panel status-loading" aria-live="polite">
          <div className="status-heading">
            <span className="status-marker" aria-hidden="true" />
            <h3>Loading your household review</h3>
          </div>
          <div className="skeleton-line skeleton-line-wide" />
          <div className="skeleton-line skeleton-line-short" />
        </section>
      )}

      {state.status === "error" && (
        <section className="status-panel status-error" role="alert">
          <div className="status-heading">
            <span className="status-marker" aria-hidden="true">!</span>
            <h3>Household ledger unavailable</h3>
          </div>
          <p>{state.message}</p>
          <button type="button" onClick={onRetry}>Try again</button>
        </section>
      )}

      {state.status === "ready" && (
        <>
          {refreshError !== null && (
            <section className="status-panel status-error" role="alert">
              <div className="status-heading">
                <span className="status-marker" aria-hidden="true">!</span>
                <h3>Review refresh failed</h3>
              </div>
              <p>{refreshError}</p>
              <button type="button" onClick={onRetry}>Try again</button>
            </section>
          )}

          {isChangingMonth && <p className="rail-status" role="status">Updating reporting period...</p>}
          {monthChangeError !== null && <p className="rail-status is-error" role="alert">{monthChangeError}</p>}
          <div className="review-grid">
            <div className="review-overview-totals">
            <MonthlyTotalsSection
              viewContract={state.viewContract}
              refreshKey={refreshKey}
              onOpenPlanningTools={openPlanningTools}
              periodControls={snapshot !== null && (
                <div className="reporting-period-toolbar">
                  <div className="reporting-period-readout">
                    <p className="reporting-period-range" aria-label="Active reporting range">
                      {formatReportingPeriodRange(snapshot.reportingPeriodRange)}
                    </p>
                    <span>{isCalendarMonth ? "Calendar month" : "Payday period"}</span>
                    {!isCurrentPeriod && <span>{isFuturePeriod ? "Future period" : "Historical period"}</span>}
                    {isReportingOverride && <span className="reporting-period-override">Calendar view override</span>}
                  </div>
                  <details className="reporting-period-disclosure">
                    <summary>Change period</summary>
                    <div className="reporting-period-controls">
                      <p id="reporting-period-scope">
                        Choose the dates for recorded income and spending, not a forecast.
                        {" "}Categories, comparisons, and checks follow these dates.
                      </p>
                      <div className="reporting-period-navigation">
                        <div className="reporting-period-picker-row">
                          <div className="month-picker">
                            <label htmlFor="month-select">
                              {isCalendarMonth ? "Month to review" : "Payday period to review"}
                            </label>
                            <select
                              id="month-select"
                              aria-label={isTwoFixedDayRule ? "Select period" : "Select month"}
                              value={isTwoFixedDayRule
                                ? snapshot.reportingPeriodRange.startDateIso
                                : state.selectedYearMonth}
                              disabled={isPeriodSelectionDisabled}
                              aria-describedby={isTargetFormOpen ? "target-draft-help" : "reporting-period-scope"}
                              onChange={(event) => onMonthChange(event.target.value)}
                            >
                              {isTwoFixedDayRule
                                ? twoFixedDayPeriodOptions.map((period) => (
                                  <option key={period.startDateIso} value={period.startDateIso}>
                                    {formatReportingPeriodRange(period)}
                                  </option>
                                ))
                                : periodMonths.map((month) => (
                                  <option key={month} value={month}>
                                    {isCalendarMonth === false
                                      ? formatReportingPeriodRange(resolveReportingPeriod(snapshot.reportingPeriodRule, month))
                                      : formatYearMonth(month)}
                                  </option>
                                ))}
                            </select>
                          </div>
                          {!isCurrentPeriod && (
                            <button
                              type="button"
                              className="action-secondary"
                              disabled={isPeriodSelectionDisabled}
                              onClick={() => {
                                if (currentPeriod !== null) navigateToPeriod(currentPeriod.startDateIso);
                              }}
                            >
                              {isCalendarMonth ? "Current month" : "Current payday period"}
                            </button>
                          )}
                        </div>
                        <div className="reporting-period-stepper" role="group" aria-label="Reporting period navigation">
                          <button
                            type="button"
                            className="action-secondary"
                            aria-label={`${isCalendarMonth ? "Previous month" : "Previous period"}${previousPeriod === null
                              ? "" : `: ${formatReportingPeriodRange(previousPeriod)}`}`}
                            disabled={isPeriodSelectionDisabled || previousPeriod === null}
                            onClick={() => {
                              if (previousPeriod !== null) navigateToPeriod(previousPeriod.startDateIso);
                            }}
                          >
                            <span>{isCalendarMonth ? "Previous month" : "Previous period"}</span>
                            {previousPeriod !== null && <small>{formatReportingPeriodRange(previousPeriod)}</small>}
                          </button>
                          <button
                            type="button"
                            className="action-secondary"
                            aria-label={`${isCalendarMonth ? "Next month" : "Next period"}${nextPeriod === null
                              ? "" : `: ${formatReportingPeriodRange(nextPeriod)}`}`}
                            aria-describedby={!canNavigateForward ? "reporting-forward-help" : undefined}
                            disabled={isPeriodSelectionDisabled || !canNavigateForward}
                            onClick={() => {
                              if (nextPeriod !== null) navigateToPeriod(nextPeriod.startDateIso);
                            }}
                          >
                            <span>{isCalendarMonth ? "Next month" : "Next period"}</span>
                            {nextPeriod !== null && <small>{formatReportingPeriodRange(nextPeriod)}</small>}
                          </button>
                        </div>
                      </div>
                      {!canNavigateForward && (
                        <p id="reporting-forward-help">No later recorded months to review. For projections, use Plan ahead.</p>
                      )}
                      {hasSavedPaydayRule && (
                        <div className="reporting-period-mode">
                          <label htmlFor="reporting-mode-select">Reporting mode</label>
                          <select
                            id="reporting-mode-select"
                            value={isCalendarMonth ? "calendar-month" : "payday-period"}
                            disabled={isTargetFormOpen || isRefreshing}
                            aria-describedby="reporting-period-scope"
                            onChange={(event) => onReportingModeChange(
                              event.currentTarget.value === "calendar-month"
                                ? "calendar-month"
                                : "payday-period"
                            )}
                          >
                            <option value="calendar-month">Calendar month</option>
                            <option value="payday-period">Payday period</option>
                          </select>
                          {isReportingOverride && (
                            <button
                              type="button"
                              className="action-secondary"
                              disabled={isTargetFormOpen || isRefreshing}
                              onClick={() => onReportingModeChange("payday-period")}
                            >
                              Use saved payday periods
                            </button>
                          )}
                        </div>
                      )}
                      <p className="reporting-period-help">
                        {isCalendarMonth && "Calendar target comparisons also follow the selected month. "}
                        Your transactions and saved reporting preference in Settings stay unchanged.
                      </p>
                    </div>
                  </details>
                </div>
              )}
            />
            </div>
            <aside className="monthly-attention review-overview-attention" aria-label="Monthly attention">
                <h3>{isCalendarMonth === false ? "Period checks" : "Monthly checks"}</h3>
                {monthlyAttention === null ? (
                  <p role="status">Calculating monthly exceptions...</p>
                ) : (
                  <div className="monthly-attention-content">
                    {monthlyAttention.categoryReviewCount > 0 && (
                      <div className="monthly-attention-item">
                        <p>{monthlyAttention.categoryReviewCount} category {monthlyAttention.categoryReviewCount === 1
                          ? "decision needs" : "decisions need"} review {isCalendarMonth === false
                            ? "in this period."
                            : "this month."}</p>
                      </div>
                    )}
                    {monthlyAttention.overTargetCategoryCount > 0 && (
                      <div className="monthly-attention-item">
                        <a href="#target-vs-actual">
                          Review {monthlyAttention.overTargetCategoryCount} {monthlyAttention.overTargetCategoryCount === 1
                            ? "category"
                            : "categories"} over target
                        </a>
                      </div>
                    )}
                    <div className="monthly-attention-item">
                      {(state.viewContract.state !== "loading" &&
                        (state.viewContract.snapshot.currencyReport?.incompleteCurrencies.length ?? 0) > 0) ? (
                        <p role="status">Budget checks are incomplete until missing dated rates are recorded.</p>
                      ) : monthlyAttention.categoryReviewCount === 0 && monthlyAttention.overTargetCategoryCount === 0 ? (
                        <p>No category reviews or over-target categories {isCalendarMonth === false
                          ? "in this period."
                          : "this month."}</p>
                      ) : null}
                      <button type="button" onClick={onOpenTransactions}>
                        Review all transactions
                      </button>
                    </div>
                    <AccountCoverageSummary
                      isActive={isActive}
                      refreshKey={refreshKey}
                      onOpenCoverage={onOpenCoverage}
                    />
                  </div>
                )}
              </aside>
            {state.viewContract.state !== "empty" && (
              <div className="review-support review-category-breakdown">
                <CategoryBreakdownSection viewContract={state.viewContract} />
              </div>
            )}
            {isCalendarMonth === false ? (
              <div className="review-primary review-target-vs-actual">
                <h3>Calendar-month targets</h3>
                <p role="note">
                  Target comparisons are shown only in Calendar month mode. Switch to Calendar month to
                  compare actuals with those targets.
                </p>
              </div>
            ) : (
              <div className="review-primary review-target-vs-actual">
                <TargetVsActualSection viewContract={state.viewContract} />
              </div>
            )}
            <details
              className="review-category-target review-maintenance-disclosure"
              aria-label="Category target management"
              onToggle={(event) => {
                if (isTargetFormOpen && !event.currentTarget.open) event.currentTarget.open = true;
              }}
            >
              <summary aria-describedby={isTargetFormOpen ? "target-draft-help" : undefined}>
                Manage category targets
              </summary>
              <div className="review-primary">
              <CategoryTargetEntrySection
                selectedYearMonth={state.selectedYearMonth}
                selectedMonthLabel={`${formatYearMonth(state.selectedYearMonth)}${isCalendarMonth === false
                  ? " calendar month"
                  : ""}`}
                onTargetSaved={onTargetSaved}
                onFormOpenChange={setIsTargetFormOpen}
              />
              </div>
            </details>
          </div>
          <details
            ref={planningToolsRef}
            className="review-planning-disclosure"
            aria-label="Planning tools"
          >
            <summary>
              <span>Plan ahead</span>
              <small>{isCalendarMonth === false
                ? "Calendar-month basis: forecast, recurring commitments, spendable cash, and cashflow scenarios"
                : "Forecast, recurring commitments, spendable cash, and cashflow scenarios"}</small>
            </summary>
            <div className="review-planning-content">
              <ForecastSection dashboardData={state.dashboardData} />
              <div className="review-recurring-commitments">
                <RecurringCommitmentsSection isActive={isActive} refreshKey={refreshKey} />
              </div>
              <div className="review-planning-sections">
                <SpendableCashSection isActive={isActive} refreshKey={refreshKey} />
                <CashflowScenarioSection refreshKey={refreshKey} />
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}