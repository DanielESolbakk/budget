import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BackupSnapshot } from "../../domain/backup/snapshotContract.js";
import {
  SNAPSHOT_VERSION,
  type BackupSnapshotSummary,
  type RestoreSnapshotInput,
  type RestoreSnapshotOutput,
} from "../../domain/backup/snapshotContract.js";
import {
  isCurrencyCode,
  isYearMonth,
  validateMonthlyCategoryTargetInput,
  type AccountBalanceCheckpoint,
  type AccountStatementCoveragePeriod,
  type Account,
  type ExchangeRate,
  type Household,
  type HoldingRecord,
  type HoldingValuationSnapshot,
  type ImportJob,
  type LoanBalanceSnapshot,
  type LoanPaymentFrequency,
  type LoanRecord,
  type MerchantCategoryRule,
  type MonthlyCategoryTarget,
  type PendingTransactionObservation,
  type PropertyRecord,
  type PropertyValuationCorrection,
  type PropertyValuationSnapshot,
  type Transaction,
  type TransactionCategoryAllocation,
} from "../../domain/types.js";
import { CATEGORY_OPTIONS } from "../../domain/categorization/categoryOptions.js";
import { defaultHouseholdShare, isHouseholdShare } from "../../domain/householdShareValidation.js";
import { validateTransactionCategoryAllocations } from "../../domain/ledger/transactionAllocations.js";
import { validateExchangeRate } from "../../domain/money/exchangeRates.js";
import { isPropertyValuationCorrectionMetadata } from "../../domain/propertyRecordValidation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function invalidSnapshot(snapshotPath: string, reason: string): never {
  throw new Error(`Invalid snapshot ${reason}: ${snapshotPath}`);
}

function validateHousehold(value: unknown, snapshotPath: string): asserts value is Household {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.createdAtIso)
  ) {
    invalidSnapshot(snapshotPath, "household");
  }
}

function validateAccounts(value: unknown[], householdId: string, snapshotPath: string): asserts value is Account[] {
  const accountIds = new Set<string>();
  for (const account of value) {
    if (
      !isRecord(account) ||
      !isNonEmptyString(account.id) ||
      !isNonEmptyString(account.householdId) ||
      !isNonEmptyString(account.name) ||
      !isCurrencyCode(account.currencyCode) ||
      account.householdId !== householdId ||
      accountIds.has(account.id)
    ) {
      invalidSnapshot(snapshotPath, "accounts");
    }
    accountIds.add(account.id);
  }
}

function validateTransactions(
  value: unknown[],
  householdId: string,
  accountIds: Set<string>,
  importJobIds: Set<string>,
  snapshotPath: string
): asserts value is Transaction[] {
  const transactionIds = new Set<string>();
  for (const transaction of value) {
    if (
      !isRecord(transaction) ||
      !isNonEmptyString(transaction.id) ||
      !isNonEmptyString(transaction.householdId) ||
      !isNonEmptyString(transaction.accountId) ||
      !isNonEmptyString(transaction.bookedAtIso) ||
      !Number.isSafeInteger(transaction.amountMinor) ||
      !isNonEmptyString(transaction.merchantRaw) ||
      !isOptionalString(transaction.currencyCode) ||
      (transaction.currencyCode !== undefined && !isCurrencyCode(transaction.currencyCode)) ||
      !isOptionalString(transaction.sourceType) ||
      (transaction.sourceType !== undefined &&
        transaction.sourceType !== "csv" &&
        transaction.sourceType !== "pdf" &&
        transaction.sourceType !== "manual") ||
      !isOptionalString(transaction.merchantAlias) ||
      !isOptionalString(transaction.sourceReference) ||
      !isOptionalString(transaction.categoryId) ||
      !isOptionalString(transaction.importJobId) ||
      (transaction.categoryAllocations !== undefined &&
        !Array.isArray(transaction.categoryAllocations)) ||
      transaction.householdId !== householdId ||
      !accountIds.has(transaction.accountId) ||
      (transaction.importJobId !== undefined && !importJobIds.has(transaction.importJobId)) ||
      transactionIds.has(transaction.id)
    ) {
      invalidSnapshot(snapshotPath, "transactions");
    }
    if (transaction.categoryAllocations !== undefined) {
      try {
        validateTransactionCategoryAllocations(
          transaction as Pick<Transaction, "amountMinor">,
          transaction.categoryAllocations as TransactionCategoryAllocation[],
          CATEGORY_OPTIONS.map((category) => category.id)
        );
      } catch {
        invalidSnapshot(snapshotPath, "transaction category allocations");
      }
    }
    transactionIds.add(transaction.id);
  }
}

function validatePendingObservations(
  value: unknown[],
  householdId: string,
  accountIds: Set<string>,
  importJobIds: Set<string>,
  transactionIds: Set<string>,
  snapshotPath: string
): asserts value is PendingTransactionObservation[] {
  const observationIds = new Set<string>();
  for (const observation of value) {
    const statusIsValid = isRecord(observation) &&
      (observation.status === "reserved" || observation.status === "confirmed");
    const sourceStatusMatches = isRecord(observation) &&
      ((observation.status === "reserved" && observation.sourceStatus === "Reservert") ||
        (observation.status === "confirmed" && observation.sourceStatus === "Bekreftet"));
    if (
      !isRecord(observation) ||
      !isNonEmptyString(observation.id) ||
      !isNonEmptyString(observation.householdId) ||
      !isNonEmptyString(observation.accountId) ||
      !isNonEmptyString(observation.transactionDateIso) ||
      Number.isNaN(Date.parse(observation.transactionDateIso)) ||
      !Number.isSafeInteger(observation.amountMinor) ||
      !isNonEmptyString(observation.merchantRaw) ||
      typeof observation.sourceRowIndex !== "number" ||
      !Number.isSafeInteger(observation.sourceRowIndex) ||
      observation.sourceRowIndex < 0 ||
      !isOptionalString(observation.currencyCode) ||
      (observation.currencyCode !== undefined && !isCurrencyCode(observation.currencyCode)) ||
      !isOptionalString(observation.sourceReference) ||
      !isOptionalString(observation.importJobId) ||
      !isOptionalString(observation.reconciledTransactionId) ||
      !isOptionalString(observation.reconciledAtIso) ||
      (observation.reconciledAtIso !== undefined &&
        Number.isNaN(Date.parse(observation.reconciledAtIso))) ||
      (observation.reconciledAtIso !== undefined &&
        observation.reconciledTransactionId === undefined) ||
      (observation.sourceType !== "csv" && observation.sourceType !== "pdf") ||
      !statusIsValid ||
      !sourceStatusMatches ||
      observation.householdId !== householdId ||
      !accountIds.has(observation.accountId) ||
      (observation.importJobId !== undefined && !importJobIds.has(observation.importJobId)) ||
      (observation.reconciledTransactionId !== undefined &&
        !transactionIds.has(observation.reconciledTransactionId)) ||
      observationIds.has(observation.id)
    ) {
      invalidSnapshot(snapshotPath, "pending observations");
    }
    observationIds.add(observation.id);
  }
}

function validateImportJobs(
  value: unknown[],
  householdId: string,
  snapshotPath: string
): asserts value is ImportJob[] {
  const importJobIds = new Set<string>();
  for (const importJob of value) {
    if (
      !isRecord(importJob) ||
      !isNonEmptyString(importJob.id) ||
      !isNonEmptyString(importJob.householdId) ||
      !isNonEmptyString(importJob.sourceType) ||
      (importJob.sourceType !== "csv" &&
        importJob.sourceType !== "pdf" &&
        importJob.sourceType !== "manual") ||
      !isNonEmptyString(importJob.sourceName) ||
      !isNonEmptyString(importJob.startedAtIso) ||
      !isOptionalString(importJob.adapterId) ||
      !isOptionalString(importJob.finishedAtIso) ||
      (importJob.candidateCount !== undefined && !Number.isSafeInteger(importJob.candidateCount)) ||
      (importJob.validationFailureCount !== undefined &&
        !Number.isSafeInteger(importJob.validationFailureCount)) ||
      importJob.householdId !== householdId ||
      importJobIds.has(importJob.id)
    ) {
      invalidSnapshot(snapshotPath, "import jobs");
    }
    importJobIds.add(importJob.id);
  }
}

function validateTargets(value: unknown[], snapshotPath: string): asserts value is MonthlyCategoryTarget[] {
  for (const target of value) {
    if (!isRecord(target)) {
      invalidSnapshot(snapshotPath, "monthly category targets");
    }
    const yearMonth = target.yearMonth;
    const categoryId = target.categoryId;
    const targetMinor = target.targetMinor;
    if (
      !isNonEmptyString(yearMonth) ||
      !isYearMonth(yearMonth) ||
      !isNonEmptyString(categoryId) ||
      typeof targetMinor !== "number"
    ) {
      invalidSnapshot(snapshotPath, "monthly category targets");
    }

    try {
      validateMonthlyCategoryTargetInput({ yearMonth, categoryId, targetMinor });
    } catch {
      invalidSnapshot(snapshotPath, "monthly category targets");
    }
  }
}

function validateAccountStatementCoveragePeriods(
  value: unknown[],
  accountCurrencies: ReadonlyMap<string, string>,
  importJobIds: Set<string>,
  snapshotPath: string
): asserts value is AccountStatementCoveragePeriod[] {
  const periodIds = new Set<string>();
  for (const period of value) {
    if (
      !isRecord(period) ||
      !isNonEmptyString(period.id) ||
      !isNonEmptyString(period.accountId) ||
      accountCurrencies.get(period.accountId) !== period.currencyCode ||
      !isIsoCalendarDate(period.startDateIso) ||
      !isIsoCalendarDate(period.endDateIso) ||
      period.startDateIso > period.endDateIso ||
      !isCurrencyCode(period.currencyCode) ||
      !isNonEmptyString(period.sourceName) ||
      (period.sourceType !== "manual" && period.sourceType !== "csv" && period.sourceType !== "pdf") ||
      !isOptionalString(period.importJobId) ||
      (period.importJobId !== undefined && !importJobIds.has(period.importJobId)) ||
      !isOptionalString(period.importedAtIso) ||
      (period.importedAtIso !== undefined && Number.isNaN(Date.parse(period.importedAtIso))) ||
      typeof period.confirmed !== "boolean" ||
      !isOptionalString(period.confirmedAtIso) ||
      (period.confirmedAtIso !== undefined && Number.isNaN(Date.parse(period.confirmedAtIso))) ||
      (period.confirmed && period.confirmedAtIso === undefined) ||
      periodIds.has(period.id)
    ) {
      invalidSnapshot(snapshotPath, "account statement coverage periods");
    }
    periodIds.add(period.id);
  }
}

function validateAccountBalanceCheckpoints(
  value: unknown[],
  accountCurrencies: ReadonlyMap<string, string>,
  snapshotPath: string
): asserts value is AccountBalanceCheckpoint[] {
  const checkpointIds = new Set<string>();
  for (const checkpoint of value) {
    if (
      !isRecord(checkpoint) ||
      !isNonEmptyString(checkpoint.id) ||
      !isNonEmptyString(checkpoint.accountId) ||
      accountCurrencies.get(checkpoint.accountId) !== checkpoint.currencyCode ||
      !isIsoCalendarDate(checkpoint.dateIso) ||
      !isCurrencyCode(checkpoint.currencyCode) ||
      !Number.isSafeInteger(checkpoint.balanceMinor) ||
      !isNonEmptyString(checkpoint.source) ||
      !isOptionalString(checkpoint.sourceReference) ||
      !isNonEmptyString(checkpoint.recordedAtIso) ||
      Number.isNaN(Date.parse(checkpoint.recordedAtIso)) ||
      checkpointIds.has(checkpoint.id)
    ) {
      invalidSnapshot(snapshotPath, "account balance checkpoints");
    }
    checkpointIds.add(checkpoint.id);
  }
}

function validateExchangeRates(value: unknown[], snapshotPath: string): asserts value is ExchangeRate[] {
  const rateIds = new Set<string>();
  const rateKeys = new Set<string>();
  for (const rate of value) {
    let validatedRate: ExchangeRate;
    try {
      validatedRate = validateExchangeRate(rate);
    } catch {
      invalidSnapshot(snapshotPath, "exchange rates");
    }
    const key = `${validatedRate.currencyCode}/${validatedRate.effectiveDate}/${validatedRate.kind}`;
    if (rateIds.has(validatedRate.id) || rateKeys.has(key)) {
      invalidSnapshot(snapshotPath, "exchange rates");
    }
    rateIds.add(validatedRate.id);
    rateKeys.add(key);
  }
}

function validateProperties(
  value: unknown[],
  householdId: string,
  snapshotPath: string,
  requiresHouseholdShares: boolean
): asserts value is PropertyRecord[] {
  const propertyIds = new Set<string>();
  for (const property of value) {
    if (
      !isRecord(property) ||
      !isNonEmptyString(property.id) ||
      !isNonEmptyString(property.householdId) ||
      property.householdId !== householdId ||
      !isNonEmptyString(property.label) ||
      !isNonEmptyString(property.createdAtIso) ||
      !property.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(property.createdAtIso)) ||
      (property.ownershipShareBasisPoints === undefined
        ? requiresHouseholdShares
        : !isHouseholdShare(property.ownershipShareBasisPoints)) ||
      propertyIds.has(property.id)
    ) {
      invalidSnapshot(snapshotPath, "properties");
    }
    propertyIds.add(property.id);
  }
}

function validatePropertyValuations(
  value: unknown[],
  propertyIds: Set<string>,
  snapshotPath: string
): asserts value is PropertyValuationSnapshot[] {
  const valuationIds = new Set<string>();
  const valuationsById = new Map<string, PropertyValuationSnapshot>();
  for (const valuation of value) {
    const correctionValue = isRecord(valuation) ? valuation.correction : undefined;
    if (
      !isRecord(valuation) ||
      !isNonEmptyString(valuation.id) ||
      !isNonEmptyString(valuation.propertyId) ||
      !propertyIds.has(valuation.propertyId) ||
      !isIsoCalendarDate(valuation.effectiveDateIso) ||
      typeof valuation.amountMinor !== "number" ||
      !Number.isSafeInteger(valuation.amountMinor) ||
      valuation.amountMinor < 0 ||
      !isCurrencyCode(valuation.currencyCode) ||
      !isNonEmptyString(valuation.recordedAtIso) ||
      !valuation.recordedAtIso.includes("T") ||
      Number.isNaN(Date.parse(valuation.recordedAtIso)) ||
      valuationIds.has(valuation.id) ||
      (correctionValue !== undefined && !isPropertyValuationCorrectionMetadata(correctionValue))
    ) {
      invalidSnapshot(snapshotPath, "property valuations");
    }
    valuationIds.add(valuation.id);
    const correction: PropertyValuationCorrection | undefined = correctionValue === undefined
      ? undefined
      : {
          action: correctionValue.action,
          targetValuationId: correctionValue.targetValuationId,
        };
    valuationsById.set(valuation.id, {
      id: valuation.id,
      propertyId: valuation.propertyId,
      effectiveDateIso: valuation.effectiveDateIso,
      amountMinor: valuation.amountMinor,
      currencyCode: valuation.currencyCode,
      recordedAtIso: valuation.recordedAtIso,
      ...(correction === undefined ? {} : { correction }),
    });
  }

  const correctedValuationIds = new Set<string>();
  for (const valuation of valuationsById.values()) {
    const correction = valuation.correction;
    if (correction === undefined) continue;

    const target = valuationsById.get(correction.targetValuationId);
    if (
      target === undefined ||
      target.propertyId !== valuation.propertyId ||
      target.id === valuation.id ||
      target.correction?.action === "void" ||
      correctedValuationIds.has(target.id)
    ) {
      invalidSnapshot(snapshotPath, "property valuation corrections");
    }
    if (
      correction.action === "void" &&
      (valuation.effectiveDateIso !== target.effectiveDateIso ||
        valuation.amountMinor !== target.amountMinor ||
        valuation.currencyCode !== target.currencyCode)
    ) {
      invalidSnapshot(snapshotPath, "voided property valuation value");
    }
    correctedValuationIds.add(target.id);
  }
}

function validateHoldings(
  value: unknown[],
  householdId: string,
  snapshotPath: string
): asserts value is HoldingRecord[] {
  const holdingIds = new Set<string>();
  for (const holding of value) {
    if (
      !isRecord(holding) ||
      !isNonEmptyString(holding.id) ||
      !isNonEmptyString(holding.householdId) ||
      holding.householdId !== householdId ||
      !isNonEmptyString(holding.label) ||
      holding.label.length > 100 ||
      typeof holding.quantity !== "number" ||
      !Number.isFinite(holding.quantity) ||
      holding.quantity <= 0 ||
      typeof holding.costBasisMinor !== "number" ||
      !Number.isSafeInteger(holding.costBasisMinor) ||
      holding.costBasisMinor < 0 ||
      !isCurrencyCode(holding.currencyCode) ||
      !isNonEmptyString(holding.createdAtIso) ||
      !holding.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(holding.createdAtIso)) ||
      holdingIds.has(holding.id)
    ) {
      invalidSnapshot(snapshotPath, "investment holdings");
    }
    if (holding.revisions !== undefined) {
      if (!Array.isArray(holding.revisions)) invalidSnapshot(snapshotPath, "holding revisions");
      const revisionIds = new Set<string>();
      for (const revision of holding.revisions) {
        if (!isRecord(revision) || !isNonEmptyString(revision.id) || revisionIds.has(revision.id) ||
            !isNonEmptyString(revision.label) || revision.label.length > 100 ||
            typeof revision.quantity !== "number" || !Number.isFinite(revision.quantity) ||
            revision.quantity <= 0 || typeof revision.costBasisMinor !== "number" ||
            !Number.isSafeInteger(revision.costBasisMinor) || revision.costBasisMinor < 0 ||
            !isCurrencyCode(revision.currencyCode) || !isNonEmptyString(revision.correctedAtIso) ||
            !revision.correctedAtIso.includes("T") || Number.isNaN(Date.parse(revision.correctedAtIso))) {
          invalidSnapshot(snapshotPath, "holding revisions");
        }
        revisionIds.add(revision.id);
      }
    }
    holdingIds.add(holding.id);
  }
}

function validateHoldingValuations(
  value: unknown[],
  holdingIds: Set<string>,
  snapshotPath: string
): asserts value is HoldingValuationSnapshot[] {
  const valuationIds = new Set<string>();
  const valuations = new Map<string, { holdingId: string; target?: string }>();
  for (const valuation of value) {
    if (
      !isRecord(valuation) ||
      !isNonEmptyString(valuation.id) ||
      !isNonEmptyString(valuation.holdingId) ||
      !holdingIds.has(valuation.holdingId) ||
      !isIsoCalendarDate(valuation.effectiveDateIso) ||
      typeof valuation.amountMinor !== "number" ||
      !Number.isSafeInteger(valuation.amountMinor) ||
      valuation.amountMinor < 0 ||
      !isCurrencyCode(valuation.currencyCode) ||
      !isNonEmptyString(valuation.recordedAtIso) ||
      !valuation.recordedAtIso.includes("T") ||
      Number.isNaN(Date.parse(valuation.recordedAtIso)) ||
      valuationIds.has(valuation.id) ||
      (valuation.correction !== undefined &&
        (!isRecord(valuation.correction) || !isNonEmptyString(valuation.correction.targetValuationId)))
    ) {
      invalidSnapshot(snapshotPath, "holding valuations");
    }
    valuationIds.add(valuation.id);
    const correction = valuation.correction;
    valuations.set(valuation.id, {
      holdingId: valuation.holdingId,
      ...(isRecord(correction) && typeof correction.targetValuationId === "string"
        ? { target: correction.targetValuationId } : {}),
    });
  }
  const corrected = new Set<string>();
  for (const [id, valuation] of valuations) {
    if (valuation.target === undefined) continue;
    const target = valuations.get(valuation.target);
    if (target === undefined || target.holdingId !== valuation.holdingId ||
        valuation.target === id || corrected.has(valuation.target)) {
      invalidSnapshot(snapshotPath, "holding valuation corrections");
    }
    corrected.add(valuation.target);
    const visited = new Set([id]);
    let cursor: string | undefined = valuation.target;
    while (cursor !== undefined) {
      if (visited.has(cursor)) invalidSnapshot(snapshotPath, "holding valuation correction cycle");
      visited.add(cursor);
      cursor = valuations.get(cursor)?.target;
    }
  }
}

function validateLoanRecords(
  value: unknown[],
  householdId: string,
  propertyIds: Set<string>,
  snapshotPath: string,
  requiresHouseholdShares: boolean
): asserts value is LoanRecord[] {
  const loanIds = new Set<string>();
  const paymentFrequencies: LoanPaymentFrequency[] = [
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "yearly",
  ];
  for (const loan of value) {
    if (
      !isRecord(loan) ||
      !isNonEmptyString(loan.id) ||
      loanIds.has(loan.id) ||
      loan.householdId !== householdId ||
      !isNonEmptyString(loan.label) ||
      loan.label.trim().length > 100 ||
      !Number.isSafeInteger(loan.principalMinor) ||
      typeof loan.principalMinor !== "number" ||
      loan.principalMinor <= 0 ||
      !Number.isSafeInteger(loan.annualInterestRateBasisPoints) ||
      typeof loan.annualInterestRateBasisPoints !== "number" ||
      loan.annualInterestRateBasisPoints < 0 ||
      loan.annualInterestRateBasisPoints > 10_000 ||
      !Number.isSafeInteger(loan.termMonths) ||
      typeof loan.termMonths !== "number" ||
      loan.termMonths <= 0 ||
      !Number.isSafeInteger(loan.paymentAmountMinor) ||
      typeof loan.paymentAmountMinor !== "number" ||
      loan.paymentAmountMinor <= 0 ||
      !paymentFrequencies.some((frequency) => frequency === loan.paymentFrequency) ||
      !isCurrencyCode(loan.currencyCode) ||
      !isNonEmptyString(loan.createdAtIso) ||
      !loan.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(loan.createdAtIso)) ||
      (loan.responsibilityShareBasisPoints === undefined
        ? requiresHouseholdShares
        : !isHouseholdShare(loan.responsibilityShareBasisPoints)) ||
      (loan.propertyId !== undefined &&
        (typeof loan.propertyId !== "string" || !propertyIds.has(loan.propertyId)))
    ) {
      invalidSnapshot(snapshotPath, "loan records");
    }
    loanIds.add(loan.id);
  }
}

function validateLoanBalanceSnapshots(
  value: unknown[],
  loans: LoanRecord[],
  snapshotPath: string
): asserts value is LoanBalanceSnapshot[] {
  const loanById = new Map(loans.map((loan) => [loan.id, loan]));
  const snapshotIds = new Set<string>();
  for (const balance of value) {
    const loan = isRecord(balance) && typeof balance.loanId === "string"
      ? loanById.get(balance.loanId)
      : undefined;
    if (
      !isRecord(balance) ||
      !isNonEmptyString(balance.id) ||
      snapshotIds.has(balance.id) ||
      loan === undefined ||
      !isIsoCalendarDate(balance.effectiveDateIso) ||
      !Number.isSafeInteger(balance.amountMinor) ||
      typeof balance.amountMinor !== "number" ||
      balance.amountMinor < 0 ||
      balance.currencyCode !== loan.currencyCode ||
      !isNonEmptyString(balance.recordedAtIso) ||
      !balance.recordedAtIso.includes("T") ||
      Number.isNaN(Date.parse(balance.recordedAtIso))
    ) {
      invalidSnapshot(snapshotPath, "loan balance snapshots");
    }
    snapshotIds.add(balance.id);
  }
}

function validateMerchantCategoryRules(
  value: unknown,
  snapshotPath: string
): asserts value is MerchantCategoryRule[] {
  if (!Array.isArray(value)) {
    invalidSnapshot(snapshotPath, "merchant category rules");
  }

  const aliases = new Set<string>();
  for (const rule of value) {
    if (
      !isRecord(rule) ||
      !isNonEmptyString(rule.merchantAlias) ||
      !isNonEmptyString(rule.categoryId) ||
      aliases.has(rule.merchantAlias)
    ) {
      invalidSnapshot(snapshotPath, "merchant category rules");
    }
    aliases.add(rule.merchantAlias);
  }
}

function validateBackupSnapshot(value: unknown, snapshotPath: string): BackupSnapshot {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    throw new Error(`Invalid snapshot structure: ${snapshotPath}`);
  }

  const metadata = value.metadata;
  if (
    metadata.version !== "1" &&
    metadata.version !== "2" &&
    metadata.version !== "3" &&
    metadata.version !== "4" &&
    metadata.version !== "5" &&
    metadata.version !== "6" &&
    metadata.version !== "7" &&
    metadata.version !== "8" &&
    metadata.version !== SNAPSHOT_VERSION
  ) {
    throw new Error(
      `Unsupported snapshot version: ${String(metadata.version ?? "unknown")}. Expected: ${SNAPSHOT_VERSION}`
    );
  }

  if (
    typeof metadata.createdAtIso !== "string" ||
    Number.isNaN(Date.parse(metadata.createdAtIso))
  ) {
    throw new Error(`Invalid snapshot creation timestamp: ${snapshotPath}`);
  }

  const collections = ["accounts", "transactions", "importJobs", "monthlyCategoryTargets"] as const;
  for (const collectionName of collections) {
    if (!Array.isArray(value[collectionName])) {
      throw new Error(`Invalid snapshot ${collectionName} collection: ${snapshotPath}`);
    }
  }

  const accounts = value.accounts as unknown[];
  const transactions = value.transactions as unknown[];
  const importJobs = value.importJobs as unknown[];
  const monthlyCategoryTargets = value.monthlyCategoryTargets as unknown[];
  const pendingObservations = value.pendingObservations === undefined
    ? []
    : value.pendingObservations;
  if (!Array.isArray(pendingObservations)) {
    throw new Error(`Invalid snapshot pendingObservations collection: ${snapshotPath}`);
  }
  const accountStatementCoveragePeriods = value.accountStatementCoveragePeriods === undefined
    ? []
    : value.accountStatementCoveragePeriods;
  const accountBalanceCheckpoints = value.accountBalanceCheckpoints === undefined
    ? []
    : value.accountBalanceCheckpoints;
  const exchangeRates = value.exchangeRates === undefined ? [] : value.exchangeRates;
  const properties = value.properties === undefined ? [] : value.properties;
  const propertyValuations = value.propertyValuations === undefined
    ? []
    : value.propertyValuations;
  const holdings = value.holdings === undefined ? [] : value.holdings;
  const holdingValuations = value.holdingValuations === undefined
    ? []
    : value.holdingValuations;
  const loanRecords = value.loanRecords === undefined ? [] : value.loanRecords;
  const loanBalanceSnapshots = value.loanBalanceSnapshots === undefined
    ? []
    : value.loanBalanceSnapshots;
  const hasCoverageCollections =
    metadata.version === "3" ||
    metadata.version === "4" ||
    metadata.version === "5" ||
    metadata.version === "6" ||
    metadata.version === "7" ||
    metadata.version === "8" ||
    metadata.version === SNAPSHOT_VERSION;
  const hasPropertyCollections =
    metadata.version === "4" ||
    metadata.version === "5" ||
    metadata.version === "6" ||
    metadata.version === "7" ||
    metadata.version === "8" ||
    metadata.version === SNAPSHOT_VERSION;
  const hasLoanCollections =
    metadata.version === "6" ||
    metadata.version === "7" ||
    metadata.version === "8" ||
    metadata.version === SNAPSHOT_VERSION;
  const hasHoldingCollections = metadata.version === "7" || metadata.version === "8" ||
    metadata.version === SNAPSHOT_VERSION;
  if (
    !Array.isArray(accountStatementCoveragePeriods) ||
    !Array.isArray(accountBalanceCheckpoints) ||
    !Array.isArray(exchangeRates) ||
    !Array.isArray(properties) ||
    !Array.isArray(propertyValuations) ||
    !Array.isArray(holdings) ||
    !Array.isArray(holdingValuations) ||
    !Array.isArray(loanRecords) ||
    !Array.isArray(loanBalanceSnapshots) ||
    (hasCoverageCollections &&
      (value.accountStatementCoveragePeriods === undefined ||
        value.accountBalanceCheckpoints === undefined ||
        value.exchangeRates === undefined)) ||
    (hasPropertyCollections &&
      (value.properties === undefined || value.propertyValuations === undefined)) ||
    (hasLoanCollections &&
      (value.loanRecords === undefined || value.loanBalanceSnapshots === undefined)) ||
    (hasHoldingCollections &&
      (value.holdings === undefined || value.holdingValuations === undefined))
  ) {
    throw new Error(
      `Invalid snapshot registry, account coverage, exchange-rate, or holding collections: ${snapshotPath}`
    );
  }

  if (
    !Number.isInteger(metadata.transactionCount) ||
    metadata.transactionCount !== transactions.length
  ) {
    throw new Error(`Snapshot transaction count does not match its transaction collection: ${snapshotPath}`);
  }

  if (!Number.isInteger(metadata.accountCount) || metadata.accountCount !== accounts.length) {
    throw new Error(`Snapshot account count does not match its account collection: ${snapshotPath}`);
  }

  validateHousehold(value.household, snapshotPath);
  validateImportJobs(importJobs, value.household.id, snapshotPath);
  validateAccounts(accounts, value.household.id, snapshotPath);
  const accountIds = new Set(accounts.map((account) => account.id));
  const accountCurrencies = new Map(
    accounts.map((account) => [account.id, account.currencyCode] as const)
  );
  const requiresHouseholdShares = Number(metadata.version) >= 9;
  validateProperties(properties, value.household.id, snapshotPath, requiresHouseholdShares);
  validatePropertyValuations(
    propertyValuations,
    new Set(properties.map((property) => property.id)),
    snapshotPath
  );
  validateHoldings(holdings, value.household.id, snapshotPath);
  validateHoldingValuations(
    holdingValuations,
    new Set(holdings.map((holding) => holding.id)),
    snapshotPath
  );
  validateLoanRecords(
    loanRecords,
    value.household.id,
    new Set(properties.map((property) => property.id)),
    snapshotPath,
    requiresHouseholdShares
  );
  validateLoanBalanceSnapshots(loanBalanceSnapshots, loanRecords, snapshotPath);
  validateTargets(monthlyCategoryTargets, snapshotPath);
  if (metadata.version !== "1") {
    validateMerchantCategoryRules(value.merchantCategoryRules, snapshotPath);
  }
  validateTransactions(
    transactions,
    value.household.id,
    accountIds,
    new Set(importJobs.map((importJob) => importJob.id)),
    snapshotPath
  );
  validatePendingObservations(
    pendingObservations,
    value.household.id,
    accountIds,
    new Set(importJobs.map((importJob) => importJob.id)),
    new Set(transactions.map((transaction) => transaction.id)),
    snapshotPath
  );
  validateAccountStatementCoveragePeriods(
    accountStatementCoveragePeriods,
    accountCurrencies,
    new Set(importJobs.map((importJob) => importJob.id)),
    snapshotPath
  );
  validateAccountBalanceCheckpoints(
    accountBalanceCheckpoints,
    accountCurrencies,
    snapshotPath
  );
  validateExchangeRates(exchangeRates, snapshotPath);

  return {
    ...(value as unknown as BackupSnapshot),
    accountStatementCoveragePeriods,
    accountBalanceCheckpoints,
    exchangeRates,
    properties: properties.map((property) => ({
      ...property,
      ownershipShareBasisPoints: defaultHouseholdShare(property.ownershipShareBasisPoints, "Property ownership share"),
    })),
    propertyValuations,
    holdings,
    holdingValuations,
    loanRecords: loanRecords.map((loan) => ({
      ...loan,
      responsibilityShareBasisPoints: defaultHouseholdShare(loan.responsibilityShareBasisPoints, "Loan responsibility share"),
    })),
    loanBalanceSnapshots,
  };
}

function readValidatedBackupSnapshot(
  snapshotPath: string,
  expectedContentHashSha256?: string
): { snapshot: BackupSnapshot; contentHashSha256: string } {
  const raw = readFileSync(snapshotPath);
  const contentHashSha256 = createHash("sha256").update(raw).digest("hex");
  if (
    expectedContentHashSha256 !== undefined &&
    contentHashSha256 !== expectedContentHashSha256
  ) {
    throw new Error("Snapshot changed since it was reviewed. Review it again before restoring.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    throw new Error(`Failed to parse snapshot file: ${snapshotPath}`);
  }

  return {
    snapshot: validateBackupSnapshot(parsed, snapshotPath),
    contentHashSha256,
  };
}

export function inspectBackupSnapshot(input: RestoreSnapshotInput): BackupSnapshotSummary {
  const { snapshot, contentHashSha256 } = readValidatedBackupSnapshot(input.snapshotPath);

  return {
    version: snapshot.metadata.version,
    householdName: snapshot.household.name,
    createdAtIso: snapshot.metadata.createdAtIso,
    accountCount: snapshot.metadata.accountCount,
    transactionCount: snapshot.metadata.transactionCount,
    contentHashSha256,
  };
}

/**
 * Reads a backup snapshot file and returns the equivalent ledger state.
 *
 * Throws when the snapshot file is missing, cannot be parsed, or was
 * produced by an incompatible snapshot version.
 */
export function restoreBackupSnapshot(input: RestoreSnapshotInput): RestoreSnapshotOutput {
  const { snapshot } = readValidatedBackupSnapshot(
    input.snapshotPath,
    input.expectedContentHashSha256
  );

  return {
    household: snapshot.household,
    accounts: snapshot.accounts,
    transactions: snapshot.transactions,
    ...(snapshot.pendingObservations === undefined
      ? {}
      : { pendingObservations: snapshot.pendingObservations }),
    importJobs: snapshot.importJobs,
    monthlyCategoryTargets: snapshot.monthlyCategoryTargets,
    merchantCategoryRules:
      snapshot.metadata.version === "1" ? [] : snapshot.merchantCategoryRules,
    accountStatementCoveragePeriods: snapshot.accountStatementCoveragePeriods,
    accountBalanceCheckpoints: snapshot.accountBalanceCheckpoints,
    exchangeRates: snapshot.exchangeRates,
    properties: snapshot.properties,
    propertyValuations: snapshot.propertyValuations,
    holdings: snapshot.holdings,
    holdingValuations: snapshot.holdingValuations,
    loanRecords: snapshot.loanRecords,
    loanBalanceSnapshots: snapshot.loanBalanceSnapshots,
    transactionCount: snapshot.transactions.length,
  };
}
