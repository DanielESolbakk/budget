import type {
  AccountStatementCoveragePeriod,
  AccountBalanceCheckpoint,
  PropertyRecord,
  PropertyValuationSnapshot,
  HoldingValuationSnapshot,
  LoanBalanceSnapshot,
  RecurringCommitment,
  RecurringCommitmentPaymentLink,
  RecurringCommitmentDecision,
} from "../../domain/types.js";
import { validatePropertyValuationCorrectionMetadata } from "../../domain/propertyRecordValidation.js";
import { validateHoldingValuationCorrectionMetadata } from "../../domain/holdingRecordValidation.js";

type AccountStatementCoveragePeriodRow = {
  id: string;
  account_id: string;
  start_date_iso: string;
  end_date_iso: string;
  currency_code: string;
  source_name: string;
  source_type: AccountStatementCoveragePeriod["sourceType"];
  import_job_id: string | null;
  imported_at_iso: string | null;
  confirmed: number;
  confirmed_at_iso: string | null;
};

export function mapAccountStatementCoveragePeriodRow(row: Record<string, unknown>): AccountStatementCoveragePeriod {
  const period = row as AccountStatementCoveragePeriodRow;
  return {
    id: period.id,
    accountId: period.account_id,
    startDateIso: period.start_date_iso,
    endDateIso: period.end_date_iso,
    currencyCode: period.currency_code,
    sourceName: period.source_name,
    sourceType: period.source_type,
    ...(period.import_job_id === null ? {} : { importJobId: period.import_job_id }),
    ...(period.imported_at_iso === null ? {} : { importedAtIso: period.imported_at_iso }),
    confirmed: period.confirmed === 1,
    ...(period.confirmed_at_iso === null ? {} : { confirmedAtIso: period.confirmed_at_iso }),
  };
}

type AccountBalanceCheckpointRow = {
  id: string;
  account_id: string;
  date_iso: string;
  currency_code: string;
  balance_minor: number;
  source: string;
  source_reference: string | null;
  recorded_at_iso: string;
};

export function mapAccountBalanceCheckpointRow(row: Record<string, unknown>): AccountBalanceCheckpoint {
  const checkpoint = row as AccountBalanceCheckpointRow;
  return {
    id: checkpoint.id,
    accountId: checkpoint.account_id,
    dateIso: checkpoint.date_iso,
    currencyCode: checkpoint.currency_code,
    balanceMinor: checkpoint.balance_minor,
    source: checkpoint.source,
    ...(checkpoint.source_reference === null ? {} : { sourceReference: checkpoint.source_reference }),
    recordedAtIso: checkpoint.recorded_at_iso,
  };
}

type PropertyRecordRow = {
  id: string;
  household_id: string;
  label: string;
  created_at_iso: string;
  ownership_share_basis_points: number;
};

export function mapPropertyRecordRow(row: Record<string, unknown>): PropertyRecord {
  const property = row as PropertyRecordRow;
  return {
    id: property.id,
    householdId: property.household_id,
    label: property.label,
    createdAtIso: property.created_at_iso,
    ownershipShareBasisPoints: property.ownership_share_basis_points,
  };
}

type PropertyValuationSnapshotRow = {
  id: string;
  property_id: string;
  effective_date_iso: string;
  amount_minor: number;
  currency_code: string;
  recorded_at_iso: string;
  correction_json: string | null;
};

export function mapPropertyValuationSnapshotRow(row: Record<string, unknown>): PropertyValuationSnapshot {
  const valuation = row as PropertyValuationSnapshotRow;
  const correction = valuation.correction_json === null
    ? undefined
    : validatePropertyValuationCorrectionMetadata(JSON.parse(valuation.correction_json) as unknown);
  return {
    id: valuation.id,
    propertyId: valuation.property_id,
    effectiveDateIso: valuation.effective_date_iso,
    amountMinor: valuation.amount_minor,
    currencyCode: valuation.currency_code,
    recordedAtIso: valuation.recorded_at_iso,
    ...(correction === undefined ? {} : { correction }),
  };
}

type HoldingValuationSnapshotRow = {
  id: string;
  holding_id: string;
  effective_date_iso: string;
  amount_minor: number;
  currency_code: string;
  recorded_at_iso: string;
  correction_json: string | null;
};

export function mapHoldingValuationSnapshotRow(row: Record<string, unknown>): HoldingValuationSnapshot {
  const valuation = row as HoldingValuationSnapshotRow;
  const correction = valuation.correction_json === null
    ? undefined
    : validateHoldingValuationCorrectionMetadata(JSON.parse(valuation.correction_json) as unknown);
  return {
    id: valuation.id,
    holdingId: valuation.holding_id,
    effectiveDateIso: valuation.effective_date_iso,
    amountMinor: valuation.amount_minor,
    currencyCode: valuation.currency_code,
    recordedAtIso: valuation.recorded_at_iso,
    ...(correction === undefined ? {} : { correction }),
  };
}

type LoanBalanceSnapshotRow = {
  id: string;
  loan_id: string;
  effective_date_iso: string;
  amount_minor: number;
  currency_code: string;
  recorded_at_iso: string;
};

export function mapLoanBalanceSnapshotRow(row: Record<string, unknown>): LoanBalanceSnapshot {
  const balance = row as LoanBalanceSnapshotRow;
  return {
    id: balance.id,
    loanId: balance.loan_id,
    effectiveDateIso: balance.effective_date_iso,
    amountMinor: balance.amount_minor,
    currencyCode: balance.currency_code,
    recordedAtIso: balance.recorded_at_iso,
  };
}

type RecurringCommitmentRow = {
  id: string;
  household_id: string;
  description: string;
  currency_code: string;
  amount_minor: number | null;
  is_variable: number;
  cadence: RecurringCommitment["cadence"];
  first_due_date_iso: string;
  active_from_iso: string;
  active_until_iso: string | null;
  status: RecurringCommitment["status"];
  created_at_iso: string;
  updated_at_iso: string;
};

export function mapRecurringCommitmentRow(row: Record<string, unknown>): RecurringCommitment {
  const commitment = row as RecurringCommitmentRow;
  return {
    id: commitment.id,
    householdId: commitment.household_id,
    description: commitment.description,
    currencyCode: commitment.currency_code,
    amountMinor: commitment.amount_minor,
    isVariable: commitment.is_variable === 1,
    cadence: commitment.cadence,
    firstDueDateIso: commitment.first_due_date_iso,
    activeFromIso: commitment.active_from_iso,
    ...(commitment.active_until_iso === null ? {} : { activeUntilIso: commitment.active_until_iso }),
    status: commitment.status,
    createdAtIso: commitment.created_at_iso,
    updatedAtIso: commitment.updated_at_iso,
  };
}

type RecurringCommitmentPaymentLinkRow = {
  id: string;
  commitment_id: string;
  occurrence_date_iso: string;
  transaction_id: string | null;
  pending_observation_id: string | null;
  linked_at_iso: string;
};

export function mapRecurringCommitmentPaymentLinkRow(row: Record<string, unknown>): RecurringCommitmentPaymentLink {
  const link = row as RecurringCommitmentPaymentLinkRow;
  return {
    id: link.id,
    commitmentId: link.commitment_id,
    occurrenceDateIso: link.occurrence_date_iso,
    ...(link.transaction_id === null ? {} : { transactionId: link.transaction_id }),
    ...(link.pending_observation_id === null ? {} : { pendingObservationId: link.pending_observation_id }),
    linkedAtIso: link.linked_at_iso,
  };
}

type RecurringCommitmentDecisionRow = {
  id: string;
  commitment_id: string;
  decision_type: RecurringCommitmentDecision["decisionType"];
  decided_at_iso: string;
  previous_amount_minor: number | null;
  new_amount_minor: number | null;
};

export function mapRecurringCommitmentDecisionRow(row: Record<string, unknown>): RecurringCommitmentDecision {
  const decision = row as RecurringCommitmentDecisionRow;
  return {
    id: decision.id,
    commitmentId: decision.commitment_id,
    decisionType: decision.decision_type,
    decidedAtIso: decision.decided_at_iso,
    ...(decision.previous_amount_minor === null
      ? {}
      : { previousAmountMinor: decision.previous_amount_minor }),
    ...(decision.new_amount_minor === null ? {} : { newAmountMinor: decision.new_amount_minor }),
  };
}
