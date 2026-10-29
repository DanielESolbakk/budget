export interface Household {
  id: string;
  name: string;
  createdAtIso: string;
}

export type SourceTextLineClassification =
  | "document-metadata"
  | "column-header"
  | "transaction"
  | "continuation"
  | "document-decoration"
  | "unclassified";

export interface SourceTextItemEvidence {
  text: string;
  x: number;
  y: number;
}

export interface SourceTextLineEvidence {
  pageNumber: number;
  lineNumber: number;
  startOffset: number;
  endOffset: number;
  rawText: string;
  classification?: SourceTextLineClassification;
  items?: SourceTextItemEvidence[];
}

export interface SourceDocumentTextLineEvidence {
  pageNumber: number;
  sourceLines: SourceTextLineEvidence[];
}

export interface Account {
  id: string;
  householdId: string;
  name: string;
  currencyCode: CurrencyCode;
}

export interface PropertyRecordInput {
  label: string;
}

export interface PropertyValuationInput {
  propertyId: string;
  effectiveDateIso: string;
  amountMinor: number;
  currencyCode: string;
}

export interface PropertyLabelUpdateInput {
  propertyId: string;
  label: string;
}

export type PropertyValuationCorrectionInput =
  | {
      action: "supersede";
      propertyId: string;
      targetValuationId: string;
      effectiveDateIso: string;
      amountMinor: number;
      currencyCode: CurrencyCode;
    }
  | {
      action: "void";
      propertyId: string;
      targetValuationId: string;
    };

export interface PropertyValuationCorrection {
  action: "supersede" | "void";
  targetValuationId: string;
}

export interface PropertyRecord {
  id: string;
  householdId: string;
  label: string;
  createdAtIso: string;
}

export interface PropertyValuationSnapshot {
  id: string;
  propertyId: string;
  effectiveDateIso: string;
  amountMinor: number;
  currencyCode: CurrencyCode;
  recordedAtIso: string;
  correction?: PropertyValuationCorrection;
}

export interface PropertyWithValuations extends PropertyRecord {
  valuations: PropertyValuationSnapshot[];
}

export type LoanPaymentFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export interface LoanRecordInput {
  label: string;
  principalMinor: number;
  annualInterestRateBasisPoints: number;
  termMonths: number;
  paymentAmountMinor: number;
  paymentFrequency: LoanPaymentFrequency;
  currencyCode: CurrencyCode;
  propertyId?: string;
}

export interface LoanBalanceInput {
  loanId: string;
  effectiveDateIso: string;
  amountMinor: number;
}

export interface LoanRecord extends LoanRecordInput {
  id: string;
  householdId: string;
  createdAtIso: string;
}

export interface LoanBalanceSnapshot {
  id: string;
  loanId: string;
  effectiveDateIso: string;
  amountMinor: number;
  currencyCode: CurrencyCode;
  recordedAtIso: string;
}

export interface LoanWithBalances extends LoanRecord {
  balances: LoanBalanceSnapshot[];
}

/** ISO 4217-style uppercase three-letter currency code used by an account. */
export type CurrencyCode = string;

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

export interface ExchangeRate {
  id: string;
  currencyCode: CurrencyCode;
  /** Decimal NOK quoted for one whole unit of the foreign currency. */
  rateNokPerUnit: string;
  effectiveDate: string;
  kind: "dated" | "monthly-reference";
  source: string;
  provenance: "manual" | "local-file";
}

export interface AccountStatementCoveragePeriod {
  id: string;
  accountId: string;
  startDateIso: string;
  endDateIso: string;
  currencyCode: CurrencyCode;
  sourceName: string;
  sourceType: "manual" | "csv" | "pdf";
  importJobId?: string;
  importedAtIso?: string;
  confirmed: boolean;
  confirmedAtIso?: string;
}

export interface AccountBalanceCheckpoint {
  id: string;
  accountId: string;
  dateIso: string;
  currencyCode: CurrencyCode;
  balanceMinor: number;
  source: string;
  sourceReference?: string;
  recordedAtIso: string;
}

export interface AccountCoverageAssessmentInput {
  period: AccountStatementCoveragePeriod;
  relatedPeriods: readonly AccountStatementCoveragePeriod[];
  checkpoints: readonly AccountBalanceCheckpoint[];
  transactions: readonly Transaction[];
  pendingObservations: readonly PendingTransactionObservation[];
  importJobs: readonly ImportJob[];
  evaluatedAtIso: string;
}

export interface AccountCoverageAssessment {
  coverageStatus: "unknown" | "confirmed";
  periodStatus: "empty" | "has-activity" | "overlapping" | "late-arriving";
  checkpointStatus: "available" | "missing" | "stale";
  reconciliationStatus: "unavailable" | "matched" | "mismatch";
  differenceMinor: number | null;
}

export interface TransactionCategoryAllocation {
  categoryId: string;
  amountMinor: number;
}

export interface Transaction {
  id: string;
  householdId: string;
  accountId: string;
  bookedAtIso: string;
  amountMinor: number;
  merchantRaw: string;
  currencyCode?: string;
  sourceType?: "csv" | "pdf" | "manual";
  merchantAlias?: string;
  sourceReference?: string;
  categoryId?: string;
  categoryAllocations?: TransactionCategoryAllocation[];
  categorization?: CategorizationDecision;
  importJobId?: string;
}

export type ImportedTransactionStatus = "reserved" | "confirmed" | "booked";
export type PendingTransactionStatus = Exclude<ImportedTransactionStatus, "booked">;
export type BankTransactionStatus = "Reservert" | "Bekreftet" | "Bokført";

export interface PendingTransactionObservation {
  id: string;
  householdId: string;
  accountId: string;
  transactionDateIso: string;
  amountMinor: number;
  merchantRaw: string;
  sourceRowIndex: number;
  currencyCode?: CurrencyCode;
  sourceType: "csv" | "pdf";
  sourceReference?: string;
  importJobId?: string;
  status: PendingTransactionStatus;
  sourceStatus: Exclude<BankTransactionStatus, "Bokført">;
  reconciledTransactionId?: string;
  reconciledAtIso?: string;
}

export interface CategorizationRule {
  ruleId: string;
  merchantAlias: string;
  categoryId: string;
  priority: number;
}

export interface CategorizationRuleProvenance {
  ruleId: string;
  merchantAlias: string;
  categoryId: string;
  priority: number;
}

export type CategorizationStatus = "categorized" | "unmatched" | "ambiguous";
export type CategorizationConfidenceLevel = "high" | "low";

export interface CategorizationDecision {
  status: CategorizationStatus;
  categoryId?: string;
  confidence: number;
  confidenceLevel: CategorizationConfidenceLevel;
  requiresReview: boolean;
  selectedRule?: CategorizationRuleProvenance;
  matchingRules: CategorizationRuleProvenance[];
}

export interface MerchantCategoryRule {
  merchantAlias: string;
  categoryId: string;
}

export type CorrectionActor = "local-user";

export interface MerchantCorrectionProvenance {
  id: string;
  sourceTransactionId: string;
  merchantAlias: string;
  categoryId: string;
  actor: CorrectionActor;
  correctedAtIso: string;
  originalCategorization?: CategorizationDecision;
}

export interface SameMerchantPropagationChange {
  transactionId: string;
  beforeCategoryId: string | null;
  afterCategoryId: string;
  beforeCategorization?: CategorizationDecision;
  afterCategorization?: CategorizationDecision;
}

export interface SameMerchantPropagationInput {
  sourceTransactionId: string;
  merchantAlias: string;
  categoryId: string;
  transactionIds: string[];
}

export interface SameMerchantPropagationPreviewRequest {
  sourceTransactionId: string;
}

export interface SameMerchantPropagationApplyRequest extends SameMerchantPropagationInput {
  confirmed: true;
}

export interface SameMerchantPropagationCandidate {
  transactionId: string;
  bookedAtIso: string;
  merchantRaw: string;
  accountName: string;
  amountMinor: number;
  currencyCode: CurrencyCode;
  proposedCategoryId: string;
}

export interface SameMerchantPropagationPreview {
  sourceTransactionId: string;
  merchantAlias: string;
  categoryId: string;
  candidates: SameMerchantPropagationCandidate[];
}

export interface SameMerchantPropagationOperation {
  id: string;
  sourceTransactionId: string;
  merchantAlias: string;
  categoryId: string;
  appliedAtIso: string;
  undoneAtIso?: string;
  changes: SameMerchantPropagationChange[];
}

/**
 * Raw input provided by a household user when manually entering a transaction.
 * All fields are strings at the boundary; validation converts them to canonical types.
 */
export interface ManualEntryInput {
  householdId: string;
  accountId: string;
  /** ISO 8601 date string, e.g. "2026-05-23" or "2026-05-23T00:00:00Z". */
  bookedAtIso: string;
  /** Transaction amount in minor units (integer, may be negative for expenses). */
  amountMinor: number;
  /** Raw merchant or description text as entered by the user. */
  merchantRaw: string;
  /** Optional category identifier. */
  categoryId?: string;
}

export type ManualEntryValidationErrorCode =
  | "INVALID_HOUSEHOLD_ID"
  | "INVALID_ACCOUNT_ID"
  | "INVALID_BOOKED_AT_ISO"
  | "INVALID_AMOUNT_MINOR_INTEGER"
  | "INVALID_MERCHANT_RAW"
  | "INVALID_CATEGORY_ID";

export interface ManualEntryValidationError {
  code: ManualEntryValidationErrorCode;
  message: string;
}

export class ManualEntryValidationException extends Error {
  readonly code: ManualEntryValidationErrorCode;

  constructor(error: ManualEntryValidationError) {
    super(error.message);
    this.name = "ManualEntryValidationException";
    this.code = error.code;
  }
}

const ISO_DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)Z)?$/;

function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value.trim());
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(0, month - 1, day));
  parsed.setUTCFullYear(year);

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Validates a manual entry input.
 * Throws ManualEntryValidationException when any field is invalid;
 * otherwise returns the input unchanged.
 */
export function validateManualEntryInput(input: ManualEntryInput): ManualEntryInput {
  if (!input.householdId.trim()) {
    throw new ManualEntryValidationException({
      code: "INVALID_HOUSEHOLD_ID",
      message: "householdId must be a non-empty string.",
    });
  }
  if (!input.accountId.trim()) {
    throw new ManualEntryValidationException({
      code: "INVALID_ACCOUNT_ID",
      message: "accountId must be a non-empty string.",
    });
  }
  if (!isValidIsoDate(input.bookedAtIso)) {
    throw new ManualEntryValidationException({
      code: "INVALID_BOOKED_AT_ISO",
      message: `bookedAtIso must be a valid ISO 8601 date: ${input.bookedAtIso}`,
    });
  }
  if (!Number.isSafeInteger(input.amountMinor)) {
    throw new ManualEntryValidationException({
      code: "INVALID_AMOUNT_MINOR_INTEGER",
      message: `amountMinor must be an integer: ${input.amountMinor}`,
    });
  }
  if (!input.merchantRaw.trim()) {
    throw new ManualEntryValidationException({
      code: "INVALID_MERCHANT_RAW",
      message: "merchantRaw must be a non-empty string.",
    });
  }
  if (input.categoryId !== undefined && (typeof input.categoryId !== "string" || !input.categoryId.trim())) {
    throw new ManualEntryValidationException({
      code: "INVALID_CATEGORY_ID",
      message: "categoryId must be a non-empty string when provided.",
    });
  }
  return input;
}

export function validateImportReviewCorrectionInput(
  input: ImportReviewCorrectionInput,
  context: { householdId: string; accounts: readonly Account[] }
): ImportReviewCorrectionValidationResult {
  const errors: ImportReviewCorrectionValidationError[] = [];
  const householdId = context.householdId.trim();
  const accountId = input.accountId.trim();
  const bookedAtIso = input.bookedAtIso.trim();
  const merchantRaw = input.merchantRaw.trim();
  const currencyCode = input.currencyCode.trim().toUpperCase();

  if (!householdId) {
    errors.push({
      code: "INVALID_HOUSEHOLD_ID",
      message: "A household is required to correct an imported row.",
      field: "householdId",
    });
  }
  if (!context.accounts.some((account) => account.id === accountId && account.householdId === householdId)) {
    errors.push({
      code: "INVALID_ACCOUNT_ID",
      message: "Choose an account that belongs to this household.",
      field: "accountId",
    });
  }
  if (!isValidIsoDate(bookedAtIso)) {
    errors.push({
      code: "INVALID_BOOKED_AT_ISO",
      message: "Enter a valid transaction date.",
      field: "bookedAtIso",
    });
  }
  if (!Number.isSafeInteger(input.amountMinor)) {
    errors.push({
      code: "INVALID_AMOUNT_MINOR_INTEGER",
      message: "Enter an amount with no fractional minor units.",
      field: "amountMinor",
    });
  }
  if (!merchantRaw) {
    errors.push({
      code: "INVALID_MERCHANT_RAW",
      message: "Enter a merchant or description.",
      field: "merchantRaw",
    });
  }
  if (!isCurrencyCode(currencyCode)) {
    errors.push({
      code: "INVALID_CURRENCY_CODE",
      message: "Enter a three-letter currency code.",
      field: "currencyCode",
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      bookedAtIso,
      amountMinor: input.amountMinor,
      merchantRaw,
      accountId,
      currencyCode,
    },
  };
}

export interface ImportJob {
  id: string;
  householdId: string;
  sourceType: "csv" | "pdf" | "manual";
  sourceName: string;
  /** Stable adapter identifier, e.g. "rogaland-sparebank-text-v1". Absent for manual imports. */
  adapterId?: string;
  /** Number of transaction candidates produced by the parser. */
  candidateCount?: number;
  /** Number of explicit validation failures recorded during parsing. */
  validationFailureCount?: number;
  startedAtIso: string;
  finishedAtIso?: string;
  provenance?: ImportJobProvenance;
}

export interface ImportJobStoryAnchor {
  enablerIssueId: string;
  featureIssueId: string;
}

export interface ImportJobProvenance {
  sourceIdentity: string;
  contentDigest?: string;
  adapterId?: string;
  accountId?: string;
  duplicateCount?: number;
  storyAnchor?: ImportJobStoryAnchor;
}

export type ImportReviewStatus = "unresolved" | "corrected" | "dismissed";

export interface ImportReviewDiagnostic {
  code: string;
  message: string;
  field?: string;
}

export interface ImportReviewItem {
  id: string;
  importJobId: string;
  householdId: string;
  accountId: string;
  sourceType: "csv" | "pdf";
  sourceName: string;
  sourceIdentity: string;
  sourceRowIndex: number;
  sourceEvidence?: SourceDocumentTextLineEvidence;
  rawRow: string;
  parserErrors: ImportReviewDiagnostic[];
  status: ImportReviewStatus;
  createdAtIso: string;
  updatedAtIso: string;
  correctedAtIso?: string;
  correctedTransactionId?: string;
  correctionJson?: string;
  dismissalReason?: string;
  dismissedAtIso?: string;
}

export interface ImportReviewCorrectionInput {
  bookedAtIso: string;
  amountMinor: number;
  merchantRaw: string;
  accountId: string;
  currencyCode: string;
}

export interface ImportReviewCorrectionValidationError {
  code:
    | "INVALID_HOUSEHOLD_ID"
    | "INVALID_ACCOUNT_ID"
    | "INVALID_BOOKED_AT_ISO"
    | "INVALID_AMOUNT_MINOR_INTEGER"
    | "INVALID_MERCHANT_RAW"
    | "INVALID_CURRENCY_CODE";
  message: string;
  field: string;
}

export type ImportReviewCorrectionValidationResult =
  | { ok: true; value: ImportReviewCorrectionInput }
  | { ok: false; errors: ImportReviewCorrectionValidationError[] };

export interface MonthlyTotal {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  totalMinor: number;
}

export interface MonthlyBreakdown {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  /** Sum of all positive transaction amounts for the month, in minor units. */
  incomeMinor: number;
  /** Sum of absolute values of all negative transaction amounts for the month, in minor units. */
  expenseMinor: number;
  /** Net result: incomeMinor minus expenseMinor. */
  netMinor: number;
}

export interface CategoryBreakdownEntry {
  /** Category identifier, or null for uncategorized transactions. */
  categoryId: string | null;
  /** Human-readable label. "Uncategorized" when categoryId is null. */
  label: string;
  /** Sum of absolute transaction amounts for this category, in minor units. */
  totalMinor: number;
  /** Number of transactions in this category. */
  transactionCount: number;
}

export interface CategoryBreakdown {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  /**
   * Entries ordered by totalMinor descending, ties broken by categoryId ascending.
   * The uncategorized entry (categoryId: null) always appears last.
   */
  entries: CategoryBreakdownEntry[];
}

export interface MonthlyCategoryTargetInput {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  /** Category identifier receiving the monthly target. */
  categoryId: string;
  /** Target amount for the category, in minor units. */
  targetMinor: number;
}

export type MonthlyCategoryTarget = MonthlyCategoryTargetInput;

export type MonthlyCategoryTargetValidationErrorCode =
  | "INVALID_TARGET_YEAR_MONTH"
  | "INVALID_TARGET_CATEGORY_ID"
  | "INVALID_TARGET_MINOR_INTEGER"
  | "INVALID_TARGET_MINOR_RANGE";

export interface MonthlyCategoryTargetValidationErrorResponse {
  code: MonthlyCategoryTargetValidationErrorCode;
  message: string;
}

export class MonthlyCategoryTargetValidationError extends Error {
  readonly code: MonthlyCategoryTargetValidationErrorCode;

  constructor(response: MonthlyCategoryTargetValidationErrorResponse) {
    super(response.message);
    this.name = "MonthlyCategoryTargetValidationError";
    this.code = response.code;
  }
}

export interface MonthlyCategoryTargetQuery {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  /** Category identifier to look up. */
  categoryId: string;
}

export interface TargetVsActualCategoryRow {
  /** Category identifier, or null for uncategorized actuals. */
  categoryId: string | null;
  /** Monthly target in minor units. Null when no explicit target exists. */
  targetMinor: number | null;
  /** Actual absolute spend/income total in minor units for the selected month. */
  actualMinor: number;
  /**
   * actualMinor - targetMinor in minor units.
   * Null when no explicit target exists for the row.
   */
  deltaMinor: number | null;
}

export interface TargetVsActualCategoryRows {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  /** Deterministically ordered rows for target-vs-actual rendering/consumption. */
  rows: TargetVsActualCategoryRow[];
}

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Returns true when the value matches the canonical YYYY-MM month format (e.g. "2026-05"). */
export function isYearMonth(value: string): boolean {
  return YEAR_MONTH_PATTERN.test(value);
}

/**
 * Validates monthly category target input.
 * Throws when yearMonth/categoryId/targetMinor are invalid; otherwise returns the input unchanged.
 */
export function validateMonthlyCategoryTargetInput(
  input: MonthlyCategoryTargetInput
): MonthlyCategoryTargetInput {
  if (!isYearMonth(input.yearMonth)) {
    throw new MonthlyCategoryTargetValidationError({
      code: "INVALID_TARGET_YEAR_MONTH",
      message: `Invalid target yearMonth: ${input.yearMonth}`,
    });
  }

  if (input.categoryId.trim().length === 0) {
    throw new MonthlyCategoryTargetValidationError({
      code: "INVALID_TARGET_CATEGORY_ID",
      message: "Target categoryId must be a non-empty string.",
    });
  }

  if (!Number.isInteger(input.targetMinor)) {
    throw new MonthlyCategoryTargetValidationError({
      code: "INVALID_TARGET_MINOR_INTEGER",
      message: `Target targetMinor must be an integer: ${input.targetMinor}`,
    });
  }

  if (input.targetMinor < 0) {
    throw new MonthlyCategoryTargetValidationError({
      code: "INVALID_TARGET_MINOR_RANGE",
      message: `Target targetMinor must be zero or positive: ${input.targetMinor}`,
    });
  }

  return input;
}

/**
 * Validates a month/category target lookup query.
 * Throws when yearMonth or categoryId are invalid; otherwise returns the query unchanged.
 */
export function validateMonthlyCategoryTargetQuery(
  query: MonthlyCategoryTargetQuery
): MonthlyCategoryTargetQuery {
  if (!isYearMonth(query.yearMonth)) {
    throw new Error(`Invalid target query yearMonth: ${query.yearMonth}`);
  }

  if (query.categoryId.trim().length === 0) {
    throw new Error("Target query categoryId must be a non-empty string.");
  }

  return query;
}

export type ForecastMethod = "moving-average-3m" | "fallback-zero";

export interface ForecastEntry {
  /** Calendar month in YYYY-MM format, e.g. "2026-06". */
  yearMonth: string;
  projectedMinor: number;
  method: ForecastMethod;
}

export interface ForecastResult {
  entries: ForecastEntry[];
  usedFallback: boolean;
}

/**
 * Normalized input boundary consumed by the forecast engine.
 *
 * All fields are fully resolved – no optional values – so the forecast engine
 * receives an unambiguous instruction set regardless of upstream sparsity.
 *
 * Insufficient-history representation:
 *   - When `history` is empty, the adapter still resolves `fallbackStartYearMonth`
 *     to a concrete YYYY-MM string, enabling the forecast engine to generate
 *     explicit fallback-zero entries without any additional defaulting logic.
 */
export interface ForecastInput {
  /** Historical monthly totals in ascending chronological order (earliest month first). */
  history: MonthlyTotal[];
  /** Number of future months to project. */
  periods: number;
  /**
   * Concrete YYYY-MM month from which fallback entries begin when `history` is empty.
   * Always resolved by the adapter layer; never left implicit.
   */
  fallbackStartYearMonth: string;
}

/**
 * Read-model contract for a deterministic month-series combining historical
 * actuals with a near-term forecast.
 *
 * Ordering invariants:
 *   - `monthlyTotals` elements are in ascending yearMonth order (earliest month first).
 *   - `forecast.entries` are in ascending yearMonth order, each strictly after
 *     the last element of `monthlyTotals` when actuals are present.
 *
 * Insufficient-history representation:
 *   - When `monthlyTotals` is empty, `forecast.usedFallback` is true and every
 *     entry uses method "fallback-zero" with projectedMinor of zero.
 *   - When fewer than three actuals are available the forecast still runs using
 *     whatever months exist (method: "moving-average-3m").
 */
export interface MonthSeries {
  /** Historical monthly totals in ascending chronological order (earliest month first). */
  monthlyTotals: MonthlyTotal[];
  /** Near-term forecast derived from monthlyTotals. */
  forecast: ForecastResult;
}