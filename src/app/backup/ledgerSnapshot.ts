import {
  mapAccountStatementCoveragePeriodRow,
  mapAccountBalanceCheckpointRow,
  mapPropertyRecordRow,
  mapPropertyValuationSnapshotRow,
  mapHoldingValuationSnapshotRow,
  mapLoanBalanceSnapshotRow,
  mapRecurringCommitmentRow,
  mapRecurringCommitmentPaymentLinkRow,
  mapRecurringCommitmentDecisionRow,
} from "./ledgerRowMappers.js";
import { DatabaseSync } from "node:sqlite";
import type { LedgerSnapshotData } from "../../domain/backup/snapshotContract.js";
import { defaultHouseholdShare } from "../../domain/householdShareValidation.js";
import {
  validateReportingPeriodRule,
  DEFAULT_REPORTING_PERIOD_RULE,
} from "../../shared/applicationPreferences.js";
import { transactionBookingTimeMillis } from "../../domain/ledger/filterTransactions.js";
import type {
  CategorizationDecision,
  ImportJob,
  ImportJobProvenance,
  Transaction,
} from "../../domain/types.js";
import {
  type PendingTransactionObservationRow,
  merchantSearchValue,
  mapTransactionRow,
  serializeTransactionCategoryAllocations,
  mapPendingTransactionObservationRow,
  parseSourceType,
} from "./ledgerTransactionRows.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type LedgerSnapshotReaders = Pick<LocalLedgerDatabase,
  | "listExchangeRates"
  | "listHoldingRecords"
  | "listLoanRecords"
  | "getReportingPeriodRule"
>;

export function insertLedgerSnapshot(db: DatabaseSync, snapshot: LedgerSnapshotData): void {
  db.prepare(
    "INSERT INTO households (id, name, created_at_iso) VALUES (?, ?, ?)"
  ).run(snapshot.household.id, snapshot.household.name, snapshot.household.createdAtIso);
  const reportingPeriodRule = validateReportingPeriodRule(
    snapshot.reportingPeriodRule ?? DEFAULT_REPORTING_PERIOD_RULE
  );
  db.prepare(
    "INSERT INTO household_preferences (household_id, reporting_period_rule_json) VALUES (?, ?)"
  ).run(snapshot.household.id, JSON.stringify(reportingPeriodRule));

  const insertAccount = db.prepare(
    "INSERT INTO accounts (id, household_id, name, currency_code) VALUES (?, ?, ?, ?)"
  );
  for (const account of snapshot.accounts) {
    insertAccount.run(account.id, account.householdId, account.name, account.currencyCode);
  }

  const insertProperty = db.prepare(
    "INSERT INTO properties (id, household_id, label, created_at_iso, ownership_share_basis_points) VALUES (?, ?, ?, ?, ?)"
  );
  for (const property of snapshot.properties ?? []) {
    insertProperty.run(property.id, property.householdId, property.label, property.createdAtIso,
      defaultHouseholdShare(property.ownershipShareBasisPoints, "Property ownership share"));
  }

  const insertHolding = db.prepare(`
    INSERT INTO investment_holdings (
      id, household_id, label, quantity, cost_basis_minor, currency_code, created_at_iso, revisions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const holding of snapshot.holdings ?? []) {
    insertHolding.run(
      holding.id,
      holding.householdId,
      holding.label,
      holding.quantity,
      holding.costBasisMinor,
      holding.currencyCode,
      holding.createdAtIso,
      holding.revisions === undefined ? null : JSON.stringify(holding.revisions)
    );
  }

  const insertLoanRecord = db.prepare(`
    INSERT INTO loan_records (
      id, household_id, label, principal_minor, annual_interest_rate_basis_points,
      term_months, payment_amount_minor, payment_frequency, currency_code, property_id,
      created_at_iso, responsibility_share_basis_points
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const loan of snapshot.loanRecords ?? []) {
    insertLoanRecord.run(
      loan.id,
      loan.householdId,
      loan.label,
      loan.principalMinor,
      loan.annualInterestRateBasisPoints,
      loan.termMonths,
      loan.paymentAmountMinor,
      loan.paymentFrequency,
      loan.currencyCode,
      loan.propertyId ?? null,
      loan.createdAtIso,
      defaultHouseholdShare(loan.responsibilityShareBasisPoints, "Loan responsibility share")
    );
  }

  const insertLoanBalance = db.prepare(`
    INSERT INTO loan_balance_snapshots (
      id, loan_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const balance of snapshot.loanBalanceSnapshots ?? []) {
    insertLoanBalance.run(
      balance.id,
      balance.loanId,
      balance.effectiveDateIso,
      balance.amountMinor,
      balance.currencyCode,
      balance.recordedAtIso
    );
  }

  const insertPropertyValuation = db.prepare(`
    INSERT INTO property_valuation_snapshots (
      id, property_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso, correction_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const valuation of snapshot.propertyValuations ?? []) {
    insertPropertyValuation.run(
      valuation.id,
      valuation.propertyId,
      valuation.effectiveDateIso,
      valuation.amountMinor,
      valuation.currencyCode,
      valuation.recordedAtIso,
      valuation.correction === undefined ? null : JSON.stringify(valuation.correction)
    );
  }

  const insertHoldingValuation = db.prepare(`
    INSERT INTO holding_valuation_snapshots (
      id, holding_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso, correction_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const valuation of snapshot.holdingValuations ?? []) {
    insertHoldingValuation.run(
      valuation.id,
      valuation.holdingId,
      valuation.effectiveDateIso,
      valuation.amountMinor,
      valuation.currencyCode,
      valuation.recordedAtIso,
      valuation.correction === undefined ? null : JSON.stringify(valuation.correction)
    );
  }

  const insertTransaction = db.prepare(
  "INSERT INTO transactions (id, household_id, account_id, booked_at_iso, booked_at_millis, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json, category_allocations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const transaction of snapshot.transactions) {
    insertTransaction.run(
      transaction.id,
      transaction.householdId,
      transaction.accountId,
      transaction.bookedAtIso,
      transactionBookingTimeMillis(transaction.bookedAtIso),
      transaction.amountMinor,
      transaction.merchantRaw,
      merchantSearchValue(transaction),
      transaction.currencyCode ?? null,
      transaction.sourceType ?? null,
      transaction.sourceReference ?? null,
      transaction.categoryId ?? null,
      transaction.importJobId ?? null,
      transaction.categorization === undefined ? null : JSON.stringify(transaction.categorization),
      serializeTransactionCategoryAllocations(transaction)
    );
  }

  const insertImportJob = db.prepare(
    "INSERT INTO import_jobs (id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const importJob of snapshot.importJobs) {
    insertImportJob.run(
      importJob.id,
      importJob.householdId,
      importJob.sourceType,
      importJob.sourceName,
      importJob.adapterId ?? null,
      importJob.candidateCount ?? null,
      importJob.validationFailureCount ?? null,
      importJob.startedAtIso,
      importJob.finishedAtIso ?? null,
      importJob.provenance ? JSON.stringify(importJob.provenance) : null
    );
  }

  const insertPendingObservation = db.prepare(`
    INSERT INTO pending_transaction_observations (
      id, household_id, account_id, transaction_date_iso, amount_minor, merchant_raw,
      source_row_index, currency_code, source_type, source_reference, import_job_id,
      status, source_status, reconciled_transaction_id, reconciled_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const observation of snapshot.pendingObservations ?? []) {
    insertPendingObservation.run(
      observation.id,
      observation.householdId,
      observation.accountId,
      observation.transactionDateIso,
      observation.amountMinor,
      observation.merchantRaw,
      observation.sourceRowIndex,
      observation.currencyCode ?? null,
      observation.sourceType,
      observation.sourceReference ?? null,
      observation.importJobId ?? null,
      observation.status,
      observation.sourceStatus,
      observation.reconciledTransactionId ?? null,
      observation.reconciledAtIso ?? null
    );
  }

  const insertRecurringCommitment = db.prepare(`
    INSERT INTO recurring_commitments (
      id, household_id, description, currency_code, amount_minor, is_variable, cadence,
      first_due_date_iso, active_from_iso, active_until_iso, status, created_at_iso, updated_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const commitment of snapshot.recurringCommitments ?? []) {
    insertRecurringCommitment.run(
      commitment.id,
      commitment.householdId,
      commitment.description,
      commitment.currencyCode,
      commitment.amountMinor,
      commitment.isVariable ? 1 : 0,
      commitment.cadence,
      commitment.firstDueDateIso,
      commitment.activeFromIso,
      commitment.activeUntilIso ?? null,
      commitment.status,
      commitment.createdAtIso,
      commitment.updatedAtIso
    );
  }

  const insertRecurringCommitmentPaymentLink = db.prepare(`
    INSERT INTO recurring_commitment_payment_links (
      id, commitment_id, occurrence_date_iso, transaction_id, pending_observation_id, linked_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const link of snapshot.recurringCommitmentPaymentLinks ?? []) {
    insertRecurringCommitmentPaymentLink.run(
      link.id,
      link.commitmentId,
      link.occurrenceDateIso,
      link.transactionId ?? null,
      link.pendingObservationId ?? null,
      link.linkedAtIso
    );
  }

  const insertRecurringCommitmentDecision = db.prepare(`
    INSERT INTO recurring_commitment_decisions (
      id, commitment_id, decision_type, decided_at_iso, previous_amount_minor, new_amount_minor
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const decision of snapshot.recurringCommitmentDecisions ?? []) {
    insertRecurringCommitmentDecision.run(
      decision.id,
      decision.commitmentId,
      decision.decisionType,
      decision.decidedAtIso,
      decision.previousAmountMinor ?? null,
      decision.newAmountMinor ?? null
    );
  }

  const insertTarget = db.prepare(
    "INSERT INTO monthly_category_targets (year_month, category_id, target_minor) VALUES (?, ?, ?)"
  );
  for (const target of snapshot.monthlyCategoryTargets) {
    insertTarget.run(target.yearMonth, target.categoryId, target.targetMinor);
  }

  const insertCoveragePeriod = db.prepare(`
    INSERT INTO account_statement_coverage_periods (
      id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
      source_type, import_job_id, imported_at_iso, confirmed, confirmed_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const period of snapshot.accountStatementCoveragePeriods ?? []) {
    insertCoveragePeriod.run(
      period.id,
      period.accountId,
      period.startDateIso,
      period.endDateIso,
      period.currencyCode,
      period.sourceName,
      period.sourceType,
      period.importJobId ?? null,
      period.importedAtIso ?? null,
      period.confirmed ? 1 : 0,
      period.confirmedAtIso ?? null
    );
  }

  const insertCheckpoint = db.prepare(`
    INSERT INTO account_balance_checkpoints (
      id, account_id, date_iso, currency_code, balance_minor, source,
      source_reference, recorded_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const checkpoint of snapshot.accountBalanceCheckpoints ?? []) {
    insertCheckpoint.run(
      checkpoint.id,
      checkpoint.accountId,
      checkpoint.dateIso,
      checkpoint.currencyCode,
      checkpoint.balanceMinor,
      checkpoint.source,
      checkpoint.sourceReference ?? null,
      checkpoint.recordedAtIso
    );
  }

  const insertExchangeRate = db.prepare(`
    INSERT INTO exchange_rates (
      id, currency_code, rate_nok_per_unit, effective_date, kind, source, provenance
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const rate of snapshot.exchangeRates ?? []) {
    insertExchangeRate.run(
      rate.id,
      rate.currencyCode,
      rate.rateNokPerUnit,
      rate.effectiveDate,
      rate.kind,
      rate.source,
      rate.provenance
    );
  }

  const insertMerchantCategoryRule = db.prepare(
    "INSERT INTO merchant_category_rules (merchant_alias, category_id) VALUES (?, ?)"
  );
  for (const rule of snapshot.merchantCategoryRules ?? []) {
    insertMerchantCategoryRule.run(rule.merchantAlias, rule.categoryId);
  }
}

export function loadLedgerSnapshotData(db: DatabaseSync, readers: LedgerSnapshotReaders): LedgerSnapshotData {
  const { listExchangeRates, listHoldingRecords, listLoanRecords, getReportingPeriodRule } = readers;
  const householdRow = db
    .prepare("SELECT id, name, created_at_iso FROM households ORDER BY id LIMIT 1")
    .get() as { id: string; name: string; created_at_iso: string } | undefined;

  if (!householdRow) {
    throw new Error("Local SQLite database has no household record to back up.");
  }

  const accounts = db
    .prepare(
      "SELECT id, household_id, name, currency_code FROM accounts ORDER BY id"
    )
    .all() as Array<{
    id: string;
    household_id: string;
    name: string;
    currency_code: string;
  }>;

  const transactions = db
    .prepare(
      "SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json, category_allocations_json FROM transactions ORDER BY id"
    )
    .all() as Array<{
    id: string;
    household_id: string;
    account_id: string;
    booked_at_iso: string;
    amount_minor: number;
    merchant_raw: string;
    currency_code: string | null;
    source_type: NonNullable<Transaction["sourceType"]> | null;
    source_reference: string | null;
    category_id: string | null;
    import_job_id: string | null;
    categorization_json: string | null;
    category_allocations_json: string | null;
  }>;

  const pendingObservations = db.prepare(`
    SELECT id, household_id, account_id, transaction_date_iso, amount_minor, merchant_raw,
      source_row_index, currency_code, source_type, source_reference, import_job_id,
      status, source_status, reconciled_transaction_id, reconciled_at_iso
    FROM pending_transaction_observations
    ORDER BY id
  `).all() as unknown as PendingTransactionObservationRow[];
  const mappedPendingObservations = pendingObservations.map(mapPendingTransactionObservationRow);

  const importJobs = db
    .prepare(
      "SELECT id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso, provenance_json FROM import_jobs ORDER BY id"
    )
    .all() as Array<{
    id: string;
    household_id: string;
    source_type: string;
    source_name: string;
    adapter_id: string | null;
    candidate_count: number | null;
    validation_failure_count: number | null;
    started_at_iso: string;
    finished_at_iso: string | null;
    provenance_json: string | null;
  }>;

  const monthlyCategoryTargets = db
    .prepare(
      "SELECT year_month, category_id, target_minor FROM monthly_category_targets ORDER BY year_month, category_id"
    )
    .all() as Array<{ year_month: string; category_id: string; target_minor: number }>;

  const merchantCategoryRules = db
    .prepare(
      "SELECT merchant_alias, category_id FROM merchant_category_rules ORDER BY merchant_alias, category_id"
    )
    .all() as Array<{ merchant_alias: string; category_id: string }>;

  const accountStatementCoveragePeriods = db.prepare(`
    SELECT id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
      source_type, import_job_id, imported_at_iso, confirmed, confirmed_at_iso
    FROM account_statement_coverage_periods
    ORDER BY account_id, start_date_iso, end_date_iso, id
  `).all().map(mapAccountStatementCoveragePeriodRow);

  const accountBalanceCheckpoints = db.prepare(`
    SELECT id, account_id, date_iso, currency_code, balance_minor, source,
      source_reference, recorded_at_iso
    FROM account_balance_checkpoints
    ORDER BY account_id, date_iso, recorded_at_iso, id
  `).all().map(mapAccountBalanceCheckpointRow);
  const exchangeRates = listExchangeRates();
  const properties = db.prepare(`
    SELECT id, household_id, label, created_at_iso, ownership_share_basis_points
    FROM properties
    ORDER BY id
  `).all().map(mapPropertyRecordRow);
  const propertyValuations = db.prepare(`
    SELECT id, property_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso,
      correction_json
    FROM property_valuation_snapshots
    ORDER BY property_id, effective_date_iso, recorded_at_iso, id
  `).all().map(mapPropertyValuationSnapshotRow);
  const holdings = listHoldingRecords(householdRow.id);
  const holdingValuations = db.prepare(`
    SELECT id, holding_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso, correction_json
    FROM holding_valuation_snapshots
    ORDER BY holding_id, effective_date_iso, recorded_at_iso, id
  `).all().map(mapHoldingValuationSnapshotRow);
  const loanRecords = listLoanRecords(householdRow.id);
  const loanBalanceSnapshots = db.prepare(`
    SELECT id, loan_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso
    FROM loan_balance_snapshots
    ORDER BY loan_id, effective_date_iso, recorded_at_iso, id
  `).all().map(mapLoanBalanceSnapshotRow);
  const recurringCommitments = db.prepare(`
    SELECT id, household_id, description, currency_code, amount_minor, is_variable,
      cadence, first_due_date_iso, active_from_iso, active_until_iso, status,
      created_at_iso, updated_at_iso
    FROM recurring_commitments
    WHERE household_id = ?
    ORDER BY id
  `).all(householdRow.id).map(mapRecurringCommitmentRow);
  const recurringCommitmentPaymentLinks = db.prepare(`
    SELECT payment_link.id, payment_link.commitment_id, payment_link.occurrence_date_iso,
      payment_link.transaction_id, payment_link.pending_observation_id, payment_link.linked_at_iso
    FROM recurring_commitment_payment_links AS payment_link
    JOIN recurring_commitments AS commitment
      ON commitment.id = payment_link.commitment_id
    WHERE commitment.household_id = ?
    ORDER BY payment_link.commitment_id, payment_link.occurrence_date_iso, payment_link.id
  `).all(householdRow.id).map(mapRecurringCommitmentPaymentLinkRow);
  const recurringCommitmentDecisions = db.prepare(`
    SELECT decision.id, decision.commitment_id, decision.decision_type, decision.decided_at_iso,
      decision.previous_amount_minor, decision.new_amount_minor
    FROM recurring_commitment_decisions AS decision
    JOIN recurring_commitments AS commitment
      ON commitment.id = decision.commitment_id
    WHERE commitment.household_id = ?
    ORDER BY decision.commitment_id, decision.decided_at_iso, decision.id
  `).all(householdRow.id).map(mapRecurringCommitmentDecisionRow);

  const mappedTransactions: Transaction[] = transactions.map((transaction) => {
    const mapped = mapTransactionRow(transaction);
    if (transaction.categorization_json !== null) {
      mapped.categorization = JSON.parse(transaction.categorization_json) as CategorizationDecision;
    }
    return mapped;
  });

  const mappedImportJobs: ImportJob[] = importJobs.map((importJob) => {
    const mapped: ImportJob = {
      id: importJob.id,
      householdId: importJob.household_id,
      sourceType: parseSourceType(importJob.source_type),
      sourceName: importJob.source_name,
      startedAtIso: importJob.started_at_iso,
    };

    if (importJob.adapter_id !== null) {
      mapped.adapterId = importJob.adapter_id;
    }

    if (importJob.candidate_count !== null) {
      mapped.candidateCount = importJob.candidate_count;
    }

    if (importJob.validation_failure_count !== null) {
      mapped.validationFailureCount = importJob.validation_failure_count;
    }

    if (importJob.finished_at_iso !== null) {
      mapped.finishedAtIso = importJob.finished_at_iso;
    }

    if (importJob.provenance_json !== null) {
      mapped.provenance = JSON.parse(importJob.provenance_json) as ImportJobProvenance;
    }

    return mapped;
  });

  return {
    household: {
      id: householdRow.id,
      name: householdRow.name,
      createdAtIso: householdRow.created_at_iso,
    },
    accounts: accounts.map((account) => ({
      id: account.id,
      householdId: account.household_id,
      name: account.name,
      currencyCode: account.currency_code,
    })),
    transactions: mappedTransactions,
    ...(mappedPendingObservations.length === 0
      ? {}
      : { pendingObservations: mappedPendingObservations }),
    importJobs: mappedImportJobs,
    monthlyCategoryTargets: monthlyCategoryTargets.map((target) => ({
      yearMonth: target.year_month,
      categoryId: target.category_id,
      targetMinor: target.target_minor,
    })),
    merchantCategoryRules: merchantCategoryRules.map((rule) => ({
      merchantAlias: rule.merchant_alias,
      categoryId: rule.category_id,
    })),
    accountStatementCoveragePeriods,
    accountBalanceCheckpoints,
    exchangeRates,
    properties,
    propertyValuations,
    holdings,
    holdingValuations,
    loanRecords,
    loanBalanceSnapshots,
    recurringCommitments,
    recurringCommitmentPaymentLinks,
    recurringCommitmentDecisions,
    reportingPeriodRule: getReportingPeriodRule(householdRow.id),
  };
}
