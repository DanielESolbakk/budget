import React from "react";
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

interface AccountCoverageSummaryProps {
  isActive: boolean;
  refreshKey: number;
  onOpenCoverage: () => void;
}

async function loadAccountCoverageSummary(): Promise<AccountCoverageSummaryData> {
  const current = await window.budgetApi.accounts.getCurrent();
  if (current === null) {
    throw new Error("Household accounts are unavailable.");
  }

  const accountSummaries: AccountPeriodSummary[] = await Promise.all(
    current.accounts.map(async (account) => ({
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
    accountCount: current.accounts.length,
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

export function AccountCoverageSummary({
  isActive,
  refreshKey,
  onOpenCoverage,
}: AccountCoverageSummaryProps): React.JSX.Element {
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

  return (
    <div
      className="monthly-attention-item account-coverage-attention"
      role="region"
      aria-label="Account coverage status"
      aria-busy={isLoading}
    >
      <div className="account-coverage-summary-copy">
        <h4>Account coverage</h4>
        <p>Coverage includes all recorded periods, not only this month.</p>
        {isLoading && <p role="status">Checking statement coverage...</p>}
        {error !== null && <p role="alert">Coverage status unavailable: {error}</p>}
        {!isLoading && error === null && summary !== null && (
          <p role="status">{summaryText(summary)}</p>
        )}
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
      <button
        className="action-secondary account-coverage-summary-action"
        type="button"
        onClick={onOpenCoverage}
      >
        Review account coverage
      </button>
    </div>
  );
}
