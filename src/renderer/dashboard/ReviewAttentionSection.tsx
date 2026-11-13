import React from "react";
import type { MonthlyAttentionSummary } from "../../shared/dashboard.js";
import type {
  Account,
  AccountCoverageAssessment,
  AccountStatementCoveragePeriod,
} from "../../domain/types.js";

interface AccountPeriodSummary {
  account: Account;
  periods: AccountStatementCoveragePeriod[];
}

interface AccountCoverageSummaryData {
  accountCount: number;
  accountsWithoutPeriods: string[];
  unconfirmedPeriodCount: number;
  periodsNeedingReviewCount: number;
}

interface ReviewAttentionSectionProps {
  isActive: boolean;
  refreshKey: number;
  onOpenCoverage: () => void;
  onOpenCategoryReview: () => void;
  onOpenExchangeRates: () => void;
  monthlyAttention: MonthlyAttentionSummary | null;
  isPaydayPeriod: boolean;
  isIncomplete: boolean;
  hasTargets: boolean;
}

async function loadAccountCoverageSummary(): Promise<AccountCoverageSummaryData> {
  const current = await window.budgetApi.accounts.getCurrent();
  if (current === null) {
    throw new Error("Household accounts are unavailable.");
  }
  const accounts = await window.budgetApi.accounts.list(current.householdId);

  const accountSummaries: AccountPeriodSummary[] = await Promise.all(
    accounts.map(async (account) => ({
      account,
      periods: await window.budgetApi.accountCoverage.listPeriods(account.id),
    }))
  );
  const assessedPeriods = await Promise.all(
    accountSummaries.flatMap(({ periods }) =>
      periods.map(async (period) => ({
        period,
        assessment: await window.budgetApi.accountCoverage.getAssessment(
          period.id,
          new Date().toISOString()
        ),
      }))
    )
  );

  const periodsNeedingReview = (assessment: AccountCoverageAssessment): boolean =>
    assessment.periodStatus === "overlapping" ||
    assessment.periodStatus === "late-arriving" ||
    assessment.checkpointStatus !== "available" ||
    assessment.reconciliationStatus === "mismatch";

  return {
    accountCount: accounts.length,
    accountsWithoutPeriods: accountSummaries
      .filter(({ periods }) => periods.length === 0)
      .map(({ account }) => account.name),
    unconfirmedPeriodCount: assessedPeriods.filter(
      ({ assessment }) => assessment.coverageStatus === "unknown"
    ).length,
    periodsNeedingReviewCount: assessedPeriods.filter(
      ({ assessment }) => periodsNeedingReview(assessment)
    ).length,
  };
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function summaryText(summary: AccountCoverageSummaryData): string {
  if (summary.accountCount === 0) return "No household accounts are available.";

  const messages: string[] = [];
  if (summary.accountsWithoutPeriods.length > 0) {
    messages.push(
      `No statement periods recorded for ${summary.accountsWithoutPeriods.join(", ")}.`
    );
  }
  if (summary.unconfirmedPeriodCount > 0) {
    messages.push(
      `${pluralize(summary.unconfirmedPeriodCount, "period")} ${
        summary.unconfirmedPeriodCount === 1 ? "awaits" : "await"
      } confirmation.`
    );
  }
  if (summary.periodsNeedingReviewCount > 0) {
    messages.push(
      `${pluralize(summary.periodsNeedingReviewCount, "statement period")} ${
        summary.periodsNeedingReviewCount === 1 ? "needs" : "need"
      } review.`
    );
  }
  if (messages.length === 0) {
    return `No open confirmation or checkpoint flags across ${pluralize(summary.accountCount, "account")}.`;
  }
  return messages.join(" ");
}

export function ReviewAttentionSection({
  isActive,
  refreshKey,
  onOpenCoverage,
  onOpenCategoryReview,
  onOpenExchangeRates,
  monthlyAttention,
  isPaydayPeriod,
  isIncomplete,
  hasTargets,
}: ReviewAttentionSectionProps): React.JSX.Element {
  const [summary, setSummary] = React.useState<AccountCoverageSummaryData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [retryKey, setRetryKey] = React.useState(0);

  React.useEffect(() => {
    if (!isActive) return;

    let active = true;
    setIsLoading(true);
    setError(null);
    loadAccountCoverageSummary()
      .then((loadedSummary) => {
        if (active) setSummary(loadedSummary);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load account coverage status."
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isActive, refreshKey, retryKey]);

  const hasCoverageFindings = summary !== null && (
    summary.accountCount === 0 || summary.accountsWithoutPeriods.length > 0 ||
    summary.unconfirmedPeriodCount > 0 || summary.periodsNeedingReviewCount > 0
  );
  const hasFindings = isIncomplete || hasCoverageFindings || error !== null ||
    (monthlyAttention?.categoryReviewCount ?? 0) > 0 ||
    (monthlyAttention?.overTargetCategoryCount ?? 0) > 0;
  const periodLabel = isPaydayPeriod ? "in this period" : "this month";

  return (
    <aside
      className={`monthly-attention review-overview-attention${!hasFindings && !isLoading ? " is-clear" : ""}`}
      aria-label="Monthly attention"
    >
      <h3>{hasFindings ? "Needs attention" : isLoading ? "Review checks" : "Review status"}</h3>
      <div className="monthly-attention-content">
        {isIncomplete && (
          <div className="monthly-attention-item">
            <p>Budget checks are incomplete until missing dated rates are recorded.</p>
            <button type="button" onClick={onOpenExchangeRates}>Record exchange rates</button>
          </div>
        )}
        <div
          className="monthly-attention-item account-coverage-attention"
          role="region"
          aria-label="Account coverage status"
          aria-busy={isLoading}
        >
          <div className="account-coverage-summary-copy">
            {hasCoverageFindings && <h4>Account coverage</h4>}
            {isLoading && <p role="status">Checking statement coverage...</p>}
            {error !== null && <p role="alert">Coverage status unavailable: {error}</p>}
            {!isLoading && error === null && summary !== null && (
              <p role="status">{summaryText(summary)}</p>
            )}
            <p className="coverage-basis-note">Coverage includes all recorded periods, not only this month.</p>
          </div>
          {error !== null && (
            <button
              className="action-secondary"
              type="button"
              onClick={() => setRetryKey((current) => current + 1)}
            >
              Retry coverage status
            </button>
          )}
          {(hasCoverageFindings || error !== null) && (
            <button
              className="action-secondary account-coverage-summary-action"
              type="button"
              onClick={onOpenCoverage}
            >
              Review account coverage
            </button>
          )}
        </div>
        {monthlyAttention === null ? (
          <p role="status">Calculating review checks...</p>
        ) : (
          <>
            {monthlyAttention.categoryReviewCount > 0 && (
              <div className="monthly-attention-item">
                <p>{monthlyAttention.categoryReviewCount} category {monthlyAttention.categoryReviewCount === 1
                  ? "decision needs" : "decisions need"} review {periodLabel}.</p>
                <button type="button" onClick={onOpenCategoryReview}>Review categories</button>
              </div>
            )}
            {monthlyAttention.overTargetCategoryCount > 0 && (
              <div className="monthly-attention-item">
                <a href="#target-vs-actual">
                  Review {monthlyAttention.overTargetCategoryCount} {monthlyAttention.overTargetCategoryCount === 1
                    ? "category" : "categories"} over target
                </a>
              </div>
            )}
            {!hasFindings && !isLoading && (
              <p>{hasTargets
                ? `No category reviews or over-target categories ${periodLabel}.`
                : isPaydayPeriod
                  ? "No category reviews pending. Target checks use calendar months."
                  : "No category reviews pending. No targets set this month."}</p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
