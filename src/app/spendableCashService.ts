import { assessAccountCoverage } from "../domain/ledger/accountCoverage.js";
import {
  calculateSpendableUntilIncome,
  type SpendableAccountBalance,
  type SpendableUntilIncomeInput,
  type SpendableUntilIncomeResult,
} from "../domain/forecast/spendableUntilIncome.js";
import { createRecurringCommitmentService } from "./recurringCommitmentService.js";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import type {
  Account,
  AccountBalanceCheckpoint,
  AccountCoverageAssessmentInput,
  AccountStatementCoveragePeriod,
} from "../domain/types.js";
import type { LedgerSnapshotData } from "../domain/backup/snapshotContract.js";

export interface SpendableCashEstimateRequest {
  selectedAccountIds: string[];
  nextIncomeDateIso: string;
  reserveMinor: number;
  monthlyReferenceRateIds?: Readonly<Record<string, string>>;
}

export interface SpendableCashService {
  getEstimate: (input: SpendableCashEstimateRequest) => SpendableUntilIncomeResult;
}

export interface SpendableCashServiceOptions {
  now?: () => Date;
}

function compareCheckpointsDescending(
  left: AccountBalanceCheckpoint,
  right: AccountBalanceCheckpoint
): number {
  return right.dateIso.localeCompare(left.dateIso) ||
    right.recordedAtIso.localeCompare(left.recordedAtIso) ||
    right.id.localeCompare(left.id);
}

function closingCheckpoint(
  period: AccountStatementCoveragePeriod,
  checkpoints: readonly AccountBalanceCheckpoint[]
): AccountBalanceCheckpoint | undefined {
  return checkpoints
    .filter((checkpoint) =>
      checkpoint.dateIso === period.endDateIso &&
      checkpoint.currencyCode === period.currencyCode
    )
    .slice()
    .sort(compareCheckpointsDescending)[0];
}

function buildBalanceInput(
  account: Account,
  snapshot: LedgerSnapshotData,
  database: LocalLedgerDatabase,
  evaluatedAtIso: string
): SpendableAccountBalance {
  const periods = database.listAccountStatementCoveragePeriods(account.id);
  const checkpoints = database.listAccountBalanceCheckpoints(account.id);
  const transactions = snapshot.transactions.filter((transaction) =>
    transaction.accountId === account.id
  );
  const pendingObservations = snapshot.pendingObservations ?? [];
  const assessments = periods.map((period) => {
    const assessmentInput: AccountCoverageAssessmentInput = {
      period,
      relatedPeriods: periods,
      checkpoints,
      transactions,
      pendingObservations,
      importJobs: snapshot.importJobs,
      evaluatedAtIso,
    };
    return {
      period,
      assessment: assessAccountCoverage(assessmentInput),
      checkpoint: closingCheckpoint(period, checkpoints),
    };
  });
  const verifiedBalances = assessments
    .filter(({ period, assessment, checkpoint }) =>
      period.confirmed &&
      assessment.coverageStatus === "confirmed" &&
      assessment.checkpointStatus === "available" &&
      assessment.reconciliationStatus === "matched" &&
      assessment.periodStatus !== "overlapping" &&
      assessment.periodStatus !== "late-arriving" &&
      checkpoint !== undefined
    )
    .sort((left, right) =>
      right.period.endDateIso.localeCompare(left.period.endDateIso) ||
      right.checkpoint!.recordedAtIso.localeCompare(left.checkpoint!.recordedAtIso) ||
      right.checkpoint!.id.localeCompare(left.checkpoint!.id)
    );
  const latestVerified = verifiedBalances[0];
  const latestCheckpoint = checkpoints.slice().sort(compareCheckpointsDescending)[0];
  const latestPeriod = periods.slice().sort((left, right) =>
    right.endDateIso.localeCompare(left.endDateIso) ||
    (right.importedAtIso ?? "").localeCompare(left.importedAtIso ?? "") ||
    right.id.localeCompare(left.id)
  )[0];

  if (latestVerified !== undefined && latestVerified.checkpoint !== undefined) {
    const hasNewerUnverifiedData =
      (latestCheckpoint !== undefined &&
        latestCheckpoint.dateIso > latestVerified.checkpoint.dateIso) ||
      (latestPeriod !== undefined &&
        latestPeriod.endDateIso > latestVerified.period.endDateIso);
    if (!hasNewerUnverifiedData) {
      return {
        accountId: account.id,
        balanceMinor: latestVerified.checkpoint.balanceMinor,
        balanceDateIso: latestVerified.checkpoint.dateIso,
        currencyCode: latestVerified.checkpoint.currencyCode,
        verificationStatus: "verified",
      };
    }
  }

  const hasStalePeriod = assessments.some(({ assessment }) =>
    assessment.checkpointStatus === "stale"
  );
  const status = checkpoints.length === 0
    ? "missing"
    : latestVerified === undefined && !hasStalePeriod
      ? "unverified"
      : "stale";
  return {
    accountId: account.id,
    balanceMinor: latestCheckpoint?.balanceMinor ?? null,
    balanceDateIso: latestCheckpoint?.dateIso ?? null,
    currencyCode: latestCheckpoint?.currencyCode ?? account.currencyCode,
    verificationStatus: status,
  };
}

export function createSpendableCashService(
  database: LocalLedgerDatabase,
  options: SpendableCashServiceOptions = {}
): SpendableCashService {
  const now = options.now ?? (() => new Date());
  const recurringCommitmentService = createRecurringCommitmentService(database, { now });

  function getEstimate(input: SpendableCashEstimateRequest): SpendableUntilIncomeResult {
    const metadata = database.loadRuntimeMetadata();
    if (metadata === null) {
      throw new Error("Local household is not available for a spendable cash estimate.");
    }
    const evaluatedAtIso = now().toISOString();
    const snapshot = database.loadLedgerSnapshotData();
    const accounts = database.getAccountsForHousehold(metadata.household.id);
    const accountIds = new Set(input.selectedAccountIds);
    const selectedAccounts = accounts.filter((account) => accountIds.has(account.id));
    const balances = selectedAccounts.map((account) =>
      buildBalanceInput(account, snapshot, database, evaluatedAtIso)
    );
    const schedule = recurringCommitmentService.getSchedule(
      evaluatedAtIso,
      input.nextIncomeDateIso
    );

    const estimateInput: SpendableUntilIncomeInput = {
      accounts,
      selectedAccountIds: input.selectedAccountIds,
      balances,
      transactions: snapshot.transactions,
      pendingObservations: snapshot.pendingObservations ?? [],
      commitments: schedule.occurrences,
      rates: database.listExchangeRates(),
      ...(input.monthlyReferenceRateIds === undefined
        ? {}
        : { monthlyReferenceRateIds: input.monthlyReferenceRateIds }),
      evaluatedAtIso,
      nextIncomeDateIso: input.nextIncomeDateIso,
      reserveMinor: input.reserveMinor,
    };
    return calculateSpendableUntilIncome(estimateInput);
  }

  return { getEstimate };
}
