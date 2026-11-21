import {
  isCurrencyCode,
  isYearMonth,
  validateMonthlyCategoryTargetInput,
  type AccountBalanceCheckpoint,
  type AccountStatementCoveragePeriod,
  type Account,
  type Category,
  type ExchangeRate,
  type Household,
  type HoldingRecord,
  type HoldingValuationSnapshot,
  type ImportJob,
  type LoanBalanceSnapshot,
  type LoanPaymentFrequency,
  type LoanRecord,
  type SourceOnlyLoanRecord,
  type MerchantCategoryRule,
  type MonthlyCategoryTarget,
  type PendingTransactionObservation,
  type PropertyRecord,
  type PropertyValuationCorrection,
  type PropertyValuationSnapshot,
  type RecurringCommitment,
  type RecurringCommitmentDecision,
  type RecurringCommitmentPaymentLink,
  type Transaction,
  type TransactionCategoryAllocation,
} from "../../domain/types.js";
import { CATEGORY_OPTIONS } from "../../domain/categorization/categoryOptions.js";
import { generateRecurringCommitmentOccurrences } from "../../domain/forecast/recurringCommitments.js";
import { isHouseholdShare } from "../../domain/householdShareValidation.js";
import { validateTransactionCategoryAllocations } from "../../domain/ledger/transactionAllocations.js";
import { validateExchangeRate } from "../../domain/money/exchangeRates.js";
import { isPropertyValuationCorrectionMetadata } from "../../domain/propertyRecordValidation.js";
import { isIsoCalendarDate } from "../../domain/date/calendarDate.js";
import { validateCategoryRecord } from "../../domain/categorization/categoryCatalog.js";
import {
  PROVISIONAL_MORTGAGE_HTML_PARSE_LIMITS,
  type MortgageHtmlParseResult,
  type MortgageHtmlParseLimits,
  type MortgageEvidenceVersion,
  type MortgageSchedulePeriod,
} from "../../shared/mortgageBankEvidence.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function containsMortgageSourceHtml(value: unknown): boolean {
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (Object.hasOwn(current, "sourceHtml")) return true;
    pending.push(...Object.values(current));
  }
  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isMortgageHtmlParseLimits(value: unknown): value is MortgageHtmlParseLimits {
  return isRecord(value) &&
    typeof value.maxSourceCharacters === "number" &&
    Number.isSafeInteger(value.maxSourceCharacters) &&
    value.maxSourceCharacters > 0 &&
    value.maxSourceCharacters <= PROVISIONAL_MORTGAGE_HTML_PARSE_LIMITS.maxSourceCharacters &&
    typeof value.maxElements === "number" &&
    Number.isSafeInteger(value.maxElements) &&
    value.maxElements > 0 &&
    value.maxElements <= PROVISIONAL_MORTGAGE_HTML_PARSE_LIMITS.maxElements &&
    typeof value.maxDepth === "number" &&
    Number.isSafeInteger(value.maxDepth) &&
    value.maxDepth > 0 &&
    value.maxDepth <= PROVISIONAL_MORTGAGE_HTML_PARSE_LIMITS.maxDepth;
}

function isMortgagePeriod(value: unknown): value is MortgageSchedulePeriod {
  if (!isRecord(value)) return false;
  if (value.granularity === "monthly") {
    return Number.isSafeInteger(value.year) &&
      typeof value.year === "number" &&
      value.year >= 1 &&
      Number.isSafeInteger(value.month) &&
      typeof value.month === "number" &&
      value.month >= 1 &&
      value.month <= 12;
  }
  if (value.granularity === "annual") {
    return Number.isSafeInteger(value.year) &&
      typeof value.year === "number" &&
      value.year >= 1;
  }
  return value.granularity === "unknown";
}

function isBoundedStringArray(value: unknown, maxLength: number): value is string[] {
  return Array.isArray(value) &&
    value.length <= maxLength &&
    value.every((item) => typeof item === "string" && item.length <= maxLength);
}

function isNullableSafeInteger(value: unknown): boolean {
  return value === null ||
    (typeof value === "number" && Number.isSafeInteger(value));
}

function isMortgageTermComparison(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.sourceLabel) ||
    (value.status !== "matches" && value.status !== "differs")
  ) return false;
  if (
    value.field === "originalPrincipalMinor" ||
    value.field === "remainingPrincipalMinor"
  ) {
    return Number.isSafeInteger(value.sourceValueMinor) &&
      typeof value.sourceValueMinor === "number" &&
      Number.isSafeInteger(value.savedValueMinor) &&
      typeof value.savedValueMinor === "number" &&
      isCurrencyCode(value.currencyCode) &&
      (value.field === "remainingPrincipalMinor"
        ? isIsoCalendarDate(value.savedEffectiveDateIso)
        : value.savedEffectiveDateIso === undefined) &&
      (value.savedEffectiveDateIso === undefined || isIsoCalendarDate(value.savedEffectiveDateIso)) &&
      ((value.status === "matches") === (value.sourceValueMinor === value.savedValueMinor));
  }
  if (value.field === "nominalAnnualRateBasisPoints") {
    return Number.isSafeInteger(value.sourceValueBasisPoints) &&
      typeof value.sourceValueBasisPoints === "number" &&
      Number.isSafeInteger(value.savedValueBasisPoints) &&
      typeof value.savedValueBasisPoints === "number" &&
      ((value.status === "matches") === (value.sourceValueBasisPoints === value.savedValueBasisPoints));
  }
  return false;
}

function isMortgageHtmlParseResult(
  value: unknown,
  role: unknown,
  limits: MortgageHtmlParseLimits
): value is MortgageHtmlParseResult {
  if (
    (role !== "details" && role !== "schedule") ||
    !isRecord(value) ||
    value.role !== role ||
    !["parsed", "partial"].includes(String(value.parseStatus)) ||
    !isRecord(value.identityEvidence) ||
    !(
      value.identityEvidence.loanReference === null ||
      typeof value.identityEvidence.loanReference === "string"
    ) ||
    !(
      value.identityEvidence.currencyCode === null ||
      typeof value.identityEvidence.currencyCode === "string"
    ) ||
    !isBoundedStringArray(value.identityEvidence.loanReferenceValues, limits.maxElements) ||
    !isBoundedStringArray(value.identityEvidence.currencyValues, limits.maxElements) ||
    !Array.isArray(value.identityEvidence.conflicts) ||
    !value.identityEvidence.conflicts.every((conflict) =>
      conflict === "loan-reference-mismatch" || conflict === "currency-mismatch"
    ) ||
    !isRecord(value.sourceDateEvidence) ||
    !(
      value.sourceDateEvidence.dateIso === null ||
      isIsoCalendarDate(value.sourceDateEvidence.dateIso)
    ) ||
    !isBoundedStringArray(value.sourceDateEvidence.sourceLabels, limits.maxElements) ||
    !isBoundedStringArray(value.sourceDateEvidence.sourceValues, limits.maxElements) ||
    typeof value.sourceDateEvidence.conflict !== "boolean" ||
    (value.sourceDateEvidence.conflict && value.sourceDateEvidence.dateIso !== null) ||
    !Array.isArray(value.detailsFields) ||
    value.detailsFields.length > limits.maxElements ||
    !Array.isArray(value.scheduleRows) ||
    value.scheduleRows.length > limits.maxElements
  ) {
    return false;
  }

  const validDetailFields = value.detailsFields.every((field) => {
    if (
      !isRecord(field) ||
      typeof field.sourceLabel !== "string" ||
      field.sourceLabel.length > limits.maxSourceCharacters ||
      typeof field.sourceValue !== "string" ||
      field.sourceValue.length > limits.maxSourceCharacters
    ) {
      return false;
    }
    if (field.field === "originalPrincipalMinor" || field.field === "remainingPrincipalMinor") {
      return isNullableSafeInteger(field.amountMinor);
    }
    if (
      field.field === "nominalAnnualRateBasisPoints" ||
      field.field === "effectiveAnnualRateBasisPoints"
    ) {
      return isNullableSafeInteger(field.valueBasisPoints);
    }
    return false;
  });
  const validScheduleRows = value.scheduleRows.every((row) =>
    isRecord(row) &&
    typeof row.periodLabel === "string" &&
    row.periodLabel.length <= limits.maxSourceCharacters &&
    isMortgagePeriod(row.period) &&
    isNullableSafeInteger(row.principalMinor) &&
    isNullableSafeInteger(row.interestMinor) &&
    isNullableSafeInteger(row.feeMinor) &&
    isNullableSafeInteger(row.paymentMinor) &&
    isNullableSafeInteger(row.projectedClosingBalanceMinor) &&
    isBoundedStringArray(row.sourceHeaders, limits.maxElements) &&
    isBoundedStringArray(row.sourceValues, limits.maxElements)
  );
  const openingBalance = value.openingBalanceEvidence;
  const validOpeningBalance = openingBalance === null || (
    isRecord(openingBalance) &&
    Number.isSafeInteger(openingBalance.amountMinor) &&
    typeof openingBalance.amountMinor === "number" &&
    openingBalance.amountMinor >= 0 &&
    isMortgagePeriod(openingBalance.beforePeriod) &&
    openingBalance.beforePeriod.granularity !== "unknown" &&
    openingBalance.sourceKind === "lender-opening-balance" &&
    typeof openingBalance.sourceLabel === "string" &&
    openingBalance.sourceLabel.length <= limits.maxSourceCharacters &&
    typeof openingBalance.sourceValue === "string" &&
    openingBalance.sourceValue.length <= limits.maxSourceCharacters
  );
  if (!validDetailFields || !validScheduleRows || !validOpeningBalance) return false;
  return role === "details"
    ? value.scheduleRows.length === 0
    : value.detailsFields.length === 0;
}

function invalidSnapshot(snapshotPath: string, reason: string): never {
  throw new Error(`Invalid snapshot ${reason}: ${snapshotPath}`);
}

export function validateHousehold(value: unknown, snapshotPath: string): asserts value is Household {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.createdAtIso)
  ) {
    invalidSnapshot(snapshotPath, "household");
  }
}

export function validateCategories(
  value: unknown, householdId: string, snapshotPath: string,
): asserts value is Category[] {
  if (!Array.isArray(value)) invalidSnapshot(snapshotPath, "categories");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const category of value) {
    if (!isRecord(category) ||
      !isNonEmptyString(category.id) || !isNonEmptyString(category.householdId) ||
      !isNonEmptyString(category.label) || !isNonEmptyString(category.createdAtIso) ||
      !isNonEmptyString(category.updatedAtIso)) {
      invalidSnapshot(snapshotPath, "categories");
    }
    let validated: Category;
    try {
      validated = validateCategoryRecord({
        id: category.id, householdId: category.householdId, label: category.label,
        createdAtIso: category.createdAtIso, updatedAtIso: category.updatedAtIso,
      });
    } catch (error) {
      throw new Error(`Invalid snapshot categories: ${snapshotPath}`, { cause: error });
    }
    const name = validated.label.toLowerCase();
    if (validated.householdId !== householdId || ids.has(validated.id) || names.has(name)) {
      invalidSnapshot(snapshotPath, "categories");
    }
    ids.add(validated.id);
    names.add(name);
  }
}

export function validateAccounts(value: unknown[], householdId: string, snapshotPath: string): asserts value is Account[] {
  const accountIds = new Set<string>();
  for (const account of value) {
    if (
      !isRecord(account) ||
      !isNonEmptyString(account.id) ||
      !isNonEmptyString(account.householdId) ||
      !isNonEmptyString(account.name) ||
      !isCurrencyCode(account.currencyCode) ||
      !isOptionalString(account.archivedAtIso) ||
      account.householdId !== householdId ||
      accountIds.has(account.id)
    ) {
      invalidSnapshot(snapshotPath, "accounts");
    }
    accountIds.add(account.id);
  }
}

export function validateTransactions(
  value: unknown[],
  householdId: string,
  accountIds: Set<string>,
  importJobIds: Set<string>,
  snapshotPath: string,
  allowedCategoryIds: readonly string[] = CATEGORY_OPTIONS.map((category) => category.id),
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
          allowedCategoryIds
        );
      } catch {
        invalidSnapshot(snapshotPath, "transaction category allocations");
      }
    }
    transactionIds.add(transaction.id);
  }
}

export function validatePendingObservations(
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

export function validateImportJobs(
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

export function validateTargets(value: unknown[], snapshotPath: string): asserts value is MonthlyCategoryTarget[] {
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

export function validateAccountStatementCoveragePeriods(
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

export function validateAccountBalanceCheckpoints(
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

export function validateExchangeRates(value: unknown[], snapshotPath: string): asserts value is ExchangeRate[] {
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

export function validateProperties(
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

export function validatePropertyValuations(
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

export function validateHoldings(
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

export function validateHoldingValuations(
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

export function validateLoanRecords(
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

export function validateSourceOnlyLoanRecords(
  value: unknown[],
  householdId: string,
  propertyIds: Set<string>,
  snapshotPath: string,
  requiresHouseholdShares: boolean,
  existingLoanIds: Set<string>
): asserts value is SourceOnlyLoanRecord[] {
  const sourceOnlyIds = new Set<string>();
  const forbiddenTermFields = [
    "principalMinor",
    "annualInterestRateBasisPoints",
    "termMonths",
    "paymentAmountMinor",
    "paymentFrequency",
  ];

  for (const loan of value) {
    if (
      !isRecord(loan) ||
      !isNonEmptyString(loan.id) ||
      existingLoanIds.has(loan.id) ||
      sourceOnlyIds.has(loan.id) ||
      loan.householdId !== householdId ||
      !isNonEmptyString(loan.label) ||
      loan.label.trim().length > 100 ||
      !isCurrencyCode(loan.currencyCode) ||
      !isNonEmptyString(loan.createdAtIso) ||
      !loan.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(loan.createdAtIso)) ||
      loan.recordStatus !== "source-only" ||
      forbiddenTermFields.some((field) => Object.prototype.hasOwnProperty.call(loan, field)) ||
      (loan.responsibilityShareBasisPoints === undefined
        ? requiresHouseholdShares
        : !isHouseholdShare(loan.responsibilityShareBasisPoints)) ||
      (loan.propertyId !== undefined &&
        (typeof loan.propertyId !== "string" || !propertyIds.has(loan.propertyId)))
    ) {
      invalidSnapshot(snapshotPath, "source-only loan records");
    }
    sourceOnlyIds.add(loan.id);
  }
}

export function validateMortgageEvidenceVersions(
  value: unknown[],
  householdId: string,
  loanIds: Set<string>,
  snapshotPath: string
): asserts value is MortgageEvidenceVersion[] {
  const versionIds = new Set<string>();
  const lastVersionByLoan = new Map<string, number>();
  for (const version of value) {
    if (containsMortgageSourceHtml(version)) {
      invalidSnapshot(snapshotPath, "mortgage evidence documents");
    }
    if (
      !isRecord(version) ||
      !isNonEmptyString(version.id) ||
      versionIds.has(version.id) ||
      !isNonEmptyString(version.loanId) ||
      !loanIds.has(version.loanId) ||
      version.householdId !== householdId ||
      !Number.isSafeInteger(version.versionNumber) ||
      typeof version.versionNumber !== "number" ||
      version.versionNumber < 1 ||
      version.versionNumber !== (lastVersionByLoan.get(version.loanId) ?? 0) + 1 ||
      !(version.sourceAsOfDateIso === null || isIsoCalendarDate(version.sourceAsOfDateIso)) ||
      !isNonEmptyString(version.importedAtIso) ||
      !version.importedAtIso.includes("T") ||
      Number.isNaN(Date.parse(version.importedAtIso)) ||
      !Array.isArray(version.documents) ||
      version.documents.length === 0 ||
      version.documents.length > 2 ||
      !(
        version.pairing === null ||
        (isRecord(version.pairing) &&
          ["verified", "confirmed"].includes(String(version.pairing.status)))
      ) ||
      !isRecord(version.attachment) ||
      !["verified", "confirmed"].includes(String(version.attachment.status)) ||
      !(
        version.scheduleValidation === null ||
        (isRecord(version.scheduleValidation) &&
          ["valid", "partial"].includes(String(version.scheduleValidation.status)) &&
          Array.isArray(version.scheduleValidation.issues))
      ) ||
      !Array.isArray(version.termComparisons) ||
      typeof version.termDifferencesAcknowledged !== "boolean" ||
      (version.termComparisons.some((comparison) => (
        isRecord(comparison) && comparison.status === "differs"
      )) && !version.termDifferencesAcknowledged) ||
      !version.termComparisons.every(isMortgageTermComparison)
    ) {
      invalidSnapshot(snapshotPath, "mortgage evidence versions");
    }

    const roles = new Set<string>();
    for (const document of version.documents) {
      if (
        !isRecord(document) ||
        !["details", "schedule"].includes(String(document.role)) ||
        roles.has(String(document.role)) ||
        Object.hasOwn(document, "sourceHtml") ||
        typeof document.sourceHashSha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(document.sourceHashSha256) ||
        !isNonEmptyString(document.parserVersion) ||
        document.parserVersion.length > 64 ||
        !isMortgageHtmlParseLimits(document.parserLimits) ||
        !isMortgageHtmlParseResult(document.parsedDocument, document.role, document.parserLimits)
      ) {
        invalidSnapshot(snapshotPath, "mortgage evidence documents");
      }
      roles.add(String(document.role));
    }
    if ((version.documents.length === 1 && version.pairing !== null) ||
        (version.documents.length === 2 && version.pairing === null)) {
      invalidSnapshot(snapshotPath, "mortgage evidence pairing");
    }

    versionIds.add(version.id);
    lastVersionByLoan.set(version.loanId, version.versionNumber);
  }
}

export function validateLoanBalanceSnapshots(
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

export function validateRecurringCommitments(
  value: unknown[],
  householdId: string,
  snapshotPath: string
): asserts value is RecurringCommitment[] {
  const commitmentIds = new Set<string>();
  for (const rawCommitment of value) {
    if (!isRecord(rawCommitment)) invalidSnapshot(snapshotPath, "recurring commitments");
    const commitment = rawCommitment;
    if (
      !isNonEmptyString(commitment.id) ||
      commitmentIds.has(commitment.id) ||
      commitment.householdId !== householdId ||
      !isNonEmptyString(commitment.description) ||
      !isCurrencyCode(commitment.currencyCode) ||
      (commitment.amountMinor !== null &&
        (typeof commitment.amountMinor !== "number" ||
          !Number.isSafeInteger(commitment.amountMinor) ||
          commitment.amountMinor <= 0)) ||
      typeof commitment.isVariable !== "boolean" ||
      (!commitment.isVariable && commitment.amountMinor === null) ||
      (commitment.cadence !== "monthly" && commitment.cadence !== "annual") ||
      !isIsoCalendarDate(commitment.firstDueDateIso) ||
      !isIsoCalendarDate(commitment.activeFromIso) ||
      (commitment.activeUntilIso !== undefined && !isIsoCalendarDate(commitment.activeUntilIso)) ||
      commitment.firstDueDateIso < commitment.activeFromIso ||
      (commitment.activeUntilIso !== undefined &&
        (commitment.activeUntilIso < commitment.activeFromIso ||
          commitment.firstDueDateIso > commitment.activeUntilIso)) ||
      (commitment.status !== "suggested" &&
        commitment.status !== "active" &&
        commitment.status !== "paused" &&
        commitment.status !== "ended") ||
      !isNonEmptyString(commitment.createdAtIso) ||
      !commitment.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(commitment.createdAtIso)) ||
      !isNonEmptyString(commitment.updatedAtIso) ||
      !commitment.updatedAtIso.includes("T") ||
      Number.isNaN(Date.parse(commitment.updatedAtIso))
    ) {
      invalidSnapshot(snapshotPath, "recurring commitments");
    }
    commitmentIds.add(commitment.id);
  }
}

export function validateRecurringCommitmentPaymentLinks(
  value: unknown[],
  commitments: RecurringCommitment[],
  transactions: Transaction[],
  pendingObservations: PendingTransactionObservation[],
  accounts: Account[],
  snapshotPath: string
): asserts value is RecurringCommitmentPaymentLink[] {
  const commitmentsById = new Map(commitments.map((commitment) => [commitment.id, commitment]));
  const transactionsById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const pendingById = new Map(pendingObservations.map((observation) => [observation.id, observation]));
  const accountCurrencies = new Map(accounts.map((account) => [account.id, account.currencyCode]));
  const linkIds = new Set<string>();
  const linkedOccurrences = new Set<string>();
  const linkedPayments = new Set<string>();

  for (const rawLink of value) {
    if (!isRecord(rawLink)) invalidSnapshot(snapshotPath, "recurring commitment payment links");
    const link = rawLink;
    const transactionId = isNonEmptyString(link.transactionId) ? link.transactionId : undefined;
    const pendingObservationId = isNonEmptyString(link.pendingObservationId)
      ? link.pendingObservationId
      : undefined;
    const commitment = isNonEmptyString(link.commitmentId)
      ? commitmentsById.get(link.commitmentId)
      : undefined;
    if (
      !isNonEmptyString(link.id) ||
      linkIds.has(link.id) ||
      commitment === undefined ||
      !isIsoCalendarDate(link.occurrenceDateIso) ||
      (transactionId === undefined) === (pendingObservationId === undefined) ||
      !isNonEmptyString(link.linkedAtIso) ||
      !link.linkedAtIso.includes("T") ||
      Number.isNaN(Date.parse(link.linkedAtIso))
    ) {
      invalidSnapshot(snapshotPath, "recurring commitment payment links");
    }
    const [scheduledOccurrence] = generateRecurringCommitmentOccurrences(
      { ...commitment, status: "active" },
      link.occurrenceDateIso,
      link.occurrenceDateIso
    );
    if (scheduledOccurrence === undefined) {
      invalidSnapshot(snapshotPath, "recurring commitment payment links");
    }

    let resolvedPaymentId: string;
    let paymentCurrencyCode: string | undefined;
    if (transactionId !== undefined) {
      const transaction = transactionsById.get(transactionId);
      if (
        transaction === undefined ||
        transaction.householdId !== commitment.householdId ||
        transaction.amountMinor >= 0
      ) {
        invalidSnapshot(snapshotPath, "recurring commitment transaction links");
      }
      resolvedPaymentId = transaction.id;
      paymentCurrencyCode = transaction.currencyCode ?? accountCurrencies.get(transaction.accountId);
    } else {
      const observation = pendingById.get(pendingObservationId!);
      if (
        observation === undefined ||
        observation.householdId !== commitment.householdId ||
        observation.amountMinor >= 0
      ) {
        invalidSnapshot(snapshotPath, "recurring commitment pending payment links");
      }
      resolvedPaymentId = observation.reconciledTransactionId ?? observation.id;
      paymentCurrencyCode = observation.currencyCode ?? accountCurrencies.get(observation.accountId);
      if (observation.reconciledTransactionId !== undefined) {
        const transaction = transactionsById.get(observation.reconciledTransactionId);
        if (
          transaction === undefined ||
          transaction.householdId !== commitment.householdId ||
          transaction.amountMinor >= 0
        ) {
          invalidSnapshot(snapshotPath, "recurring commitment reconciled payment links");
        }
      }
    }

    const occurrenceKey = `${commitment.id}::${link.occurrenceDateIso}`;
    if (paymentCurrencyCode !== commitment.currencyCode ||
        linkedOccurrences.has(occurrenceKey) ||
        linkedPayments.has(resolvedPaymentId)) {
      invalidSnapshot(snapshotPath, "duplicate or mismatched recurring commitment payments");
    }
    linkIds.add(link.id);
    linkedOccurrences.add(occurrenceKey);
    linkedPayments.add(resolvedPaymentId);
  }
}

export function validateRecurringCommitmentDecisions(
  value: unknown[],
  commitments: RecurringCommitment[],
  snapshotPath: string
): asserts value is RecurringCommitmentDecision[] {
  const commitmentIds = new Set(commitments.map((commitment) => commitment.id));
  const decisionIds = new Set<string>();
  for (const rawDecision of value) {
    if (!isRecord(rawDecision)) invalidSnapshot(snapshotPath, "recurring commitment decisions");
    const decision = rawDecision;
    const validDecisionType =
      decision.decisionType === "edited" ||
      decision.decisionType === "confirmed" ||
      decision.decisionType === "paused" ||
      decision.decisionType === "resumed" ||
      decision.decisionType === "ended" ||
      decision.decisionType === "amount-change-confirmed";
    const validAmount = (amount: unknown): boolean =>
      amount === undefined ||
      amount === null ||
      (typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0);
    if (
      !isNonEmptyString(decision.id) ||
      decisionIds.has(decision.id) ||
      !isNonEmptyString(decision.commitmentId) ||
      !commitmentIds.has(decision.commitmentId) ||
      !validDecisionType ||
      !isNonEmptyString(decision.decidedAtIso) ||
      !decision.decidedAtIso.includes("T") ||
      Number.isNaN(Date.parse(decision.decidedAtIso)) ||
      !validAmount(decision.previousAmountMinor) ||
      !validAmount(decision.newAmountMinor) ||
      (decision.decisionType === "amount-change-confirmed" &&
        (decision.previousAmountMinor === undefined || decision.newAmountMinor === undefined))
    ) {
      invalidSnapshot(snapshotPath, "recurring commitment decisions");
    }
    decisionIds.add(decision.id);
  }
}

export function validateMerchantCategoryRules(
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
