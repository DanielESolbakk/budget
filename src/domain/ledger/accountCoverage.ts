import type {
  AccountCoverageAssessment,
  AccountCoverageAssessmentInput,
  AccountStatementCoveragePeriod,
} from "../types.js";
import { isCurrencyCode } from "../types.js";

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertPeriod(period: AccountStatementCoveragePeriod): void {
  if (
    period.id.trim().length === 0 ||
    period.accountId.trim().length === 0 ||
    !isIsoCalendarDate(period.startDateIso) ||
    !isIsoCalendarDate(period.endDateIso) ||
    period.startDateIso > period.endDateIso ||
    !isCurrencyCode(period.currencyCode) ||
    period.sourceName.trim().length === 0
  ) {
    throw new Error("Account statement coverage period is invalid.");
  }
}

function periodsOverlap(
  left: AccountStatementCoveragePeriod,
  right: AccountStatementCoveragePeriod
): boolean {
  return left.accountId === right.accountId &&
    left.currencyCode === right.currencyCode &&
    left.startDateIso <= right.endDateIso &&
    right.startDateIso <= left.endDateIso;
}

function resolvePeriodStatus(input: AccountCoverageAssessmentInput): AccountCoverageAssessment["periodStatus"] {
  const { period } = input;
  if (input.relatedPeriods.some((candidate) =>
    candidate.id !== period.id && periodsOverlap(period, candidate)
  )) {
    return "overlapping";
  }
  const importJobFinishedAt = period.importJobId === undefined
    ? undefined
    : input.importJobs.find((job) => job.id === period.importJobId)?.finishedAtIso;
  const importedAtIso = importJobFinishedAt ?? period.importedAtIso;
  if (importedAtIso !== undefined && period.confirmedAtIso !== undefined &&
    importedAtIso > period.confirmedAtIso) {
    return "late-arriving";
  }
  const hasBookedActivity = input.transactions.some((transaction) => {
    const transactionDate = transaction.bookedAtIso.slice(0, 10);
    return transaction.accountId === period.accountId &&
      (transaction.currencyCode ?? period.currencyCode) === period.currencyCode &&
      transactionDate >= period.startDateIso &&
      transactionDate <= period.endDateIso;
  });
  return hasBookedActivity ? "has-activity" : "empty";
}

function resolveCheckpointStatus(input: AccountCoverageAssessmentInput): {
  status: AccountCoverageAssessment["checkpointStatus"];
  openingBalanceMinor?: number;
  closingBalanceMinor?: number;
} {
  const { period } = input;
  const checkpoints = input.checkpoints.filter((checkpoint) =>
    checkpoint.accountId === period.accountId &&
    checkpoint.currencyCode === period.currencyCode
  );
  const opening = checkpoints
    .filter((checkpoint) => checkpoint.dateIso === period.startDateIso)
    .sort((left, right) =>
      right.recordedAtIso.localeCompare(left.recordedAtIso) ||
      right.id.localeCompare(left.id)
    )[0];
  const closing = checkpoints
    .filter((checkpoint) => checkpoint.dateIso === period.endDateIso)
    .sort((left, right) =>
      right.recordedAtIso.localeCompare(left.recordedAtIso) ||
      right.id.localeCompare(left.id)
    )[0];

  if (opening !== undefined && closing !== undefined) {
    return {
      status: "available",
      openingBalanceMinor: opening.balanceMinor,
      closingBalanceMinor: closing.balanceMinor,
    };
  }

  const hasOlderCheckpoint = checkpoints.some((checkpoint) =>
    (opening === undefined && checkpoint.dateIso < period.startDateIso) ||
    (closing === undefined && checkpoint.dateIso < period.endDateIso)
  );
  return { status: hasOlderCheckpoint ? "stale" : "missing" };
}

function bookedMovementsForPeriod(input: AccountCoverageAssessmentInput): number {
  const { period } = input;
  let total = 0;
  for (const transaction of input.transactions) {
    const transactionDate = transaction.bookedAtIso.slice(0, 10);
    if (
      transaction.accountId !== period.accountId ||
      (transaction.currencyCode ?? period.currencyCode) !== period.currencyCode ||
      transactionDate < period.startDateIso ||
      transactionDate > period.endDateIso
    ) {
      continue;
    }
    total += transaction.amountMinor;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("Booked transaction total exceeds the safe integer range.");
    }
  }
  return total;
}

export function assessAccountCoverage(
  input: AccountCoverageAssessmentInput
): AccountCoverageAssessment {
  assertPeriod(input.period);
  if (!isIsoCalendarDate(input.evaluatedAtIso.slice(0, 10))) {
    throw new Error("Account coverage evaluation date is invalid.");
  }

  const periodStatus = resolvePeriodStatus(input);
  const checkpoints = resolveCheckpointStatus(input);
  if (checkpoints.status !== "available") {
    return {
      coverageStatus: input.period.confirmed ? "confirmed" : "unknown",
      periodStatus,
      checkpointStatus: checkpoints.status,
      reconciliationStatus: "unavailable",
      differenceMinor: null,
    };
  }

  const differenceMinor =
    checkpoints.closingBalanceMinor! -
    checkpoints.openingBalanceMinor! -
    bookedMovementsForPeriod(input);
  if (!Number.isSafeInteger(differenceMinor)) {
    throw new RangeError("Account reconciliation difference exceeds the safe integer range.");
  }

  return {
    coverageStatus: input.period.confirmed ? "confirmed" : "unknown",
    periodStatus,
    checkpointStatus: "available",
    reconciliationStatus: differenceMinor === 0 ? "matched" : "mismatch",
    differenceMinor,
  };
}
