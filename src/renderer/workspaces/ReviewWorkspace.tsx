import React from "react";
import { getMonthlyAttentionSummary, type DashboardViewContract } from "../../app/dashboardApi.js";
import { CategoryBreakdownSection } from "../dashboard/CategoryBreakdownSection.js";
import { CategoryTargetEntrySection } from "../dashboard/CategoryTargetEntrySection.js";
import { ForecastSection } from "../dashboard/ForecastSection.js";
import { MonthlyTotalsSection } from "../dashboard/MonthlyTotalsSection.js";
import { TargetVsActualSection } from "../dashboard/TargetVsActualSection.js";
import { AccountCoverageSummary } from "../dashboard/AccountCoverageSummary.js";
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
  onMonthChange: (yearMonth: string) => void;
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
  onMonthChange,
  onOpenTransactions,
  onOpenCoverage,
  onTargetSaved,
  onRetry,
}: ReviewWorkspaceProps): React.JSX.Element {
  const viewContract: DashboardViewContract | null = state.status === "ready" ? state.viewContract : null;
  const monthlyAttention = viewContract === null ? null : getMonthlyAttentionSummary(viewContract);

  return (
    <section
      className="destination-workspace"
      aria-label="Review workspace"
      aria-busy={state.status === "loading" || isChangingMonth || isRefreshing}
      hidden={!isActive}
    >
      <div className="review-intro">
        <div>
          <h2>Monthly review</h2>
          <p className="intro-copy">See the month clearly, then act on what needs attention.</p>
        </div>
        {state.status === "ready" && (
          <div className="month-picker">
            <label htmlFor="month-select">Reviewing</label>
            <select
              id="month-select"
              aria-label="Select month"
              value={state.selectedYearMonth}
              onChange={(event) => onMonthChange(event.target.value)}
            >
              {state.availableMonths.map((month) => (
                <option key={month} value={month}>{formatYearMonth(month)}</option>
              ))}
            </select>
            <span className="month-picker-code">{state.selectedYearMonth}</span>
          </div>
        )}
      </div>

      {state.status === "loading" && (
        <section className="status-panel status-loading" aria-live="polite">
          <div className="status-heading">
            <span className="status-marker" aria-hidden="true" />
            <h3>Loading your monthly review</h3>
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

          {isChangingMonth && <p className="rail-status" role="status">Updating month...</p>}
          {monthChangeError !== null && <p className="rail-status is-error" role="alert">{monthChangeError}</p>}

          <div className="review-overview">
              <MonthlyTotalsSection viewContract={state.viewContract} />
              <aside className="monthly-attention" aria-label="Monthly attention">
                <h3>Monthly checks</h3>
                {monthlyAttention === null ? (
                  <p role="status">Calculating monthly exceptions...</p>
                ) : (
                  <div className="monthly-attention-content">
                    <div className="monthly-attention-item">
                      <p>
                        {monthlyAttention.categoryReviewCount > 0
                          ? `${monthlyAttention.categoryReviewCount} category ${
                            monthlyAttention.categoryReviewCount === 1 ? "decision needs" : "decisions need"
                          } review this month.`
                          : "No category decisions need review this month."}
                      </p>
                      <button type="button" onClick={onOpenTransactions}>
                        Open all-month queue
                      </button>
                    </div>
                    <div className="monthly-attention-item">
                      {monthlyAttention.overTargetCategoryCount > 0 ? (
                        <a href="#target-vs-actual">
                          Review {monthlyAttention.overTargetCategoryCount} {monthlyAttention.overTargetCategoryCount === 1
                            ? "category"
                            : "categories"} over target
                        </a>
                      ) : (
                        <p>No categories over target.</p>
                      )}
                    </div>
                    <AccountCoverageSummary
                      isActive={isActive}
                      refreshKey={refreshKey}
                      onOpenCoverage={onOpenCoverage}
                    />
                  </div>
                )}
              </aside>
          </div>
          <div className="review-grid">
            <div className="review-primary">
              <TargetVsActualSection viewContract={state.viewContract} />
              <CategoryTargetEntrySection
                selectedYearMonth={state.selectedYearMonth}
                onTargetSaved={onTargetSaved}
              />
            </div>
            <aside className="review-support" aria-label="Monthly context">
              <CategoryBreakdownSection viewContract={state.viewContract} />
              <ForecastSection dashboardData={state.dashboardData} />
            </aside>
          </div>
        </>
      )}
    </section>
  );
}