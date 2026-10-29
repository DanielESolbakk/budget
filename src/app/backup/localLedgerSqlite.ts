import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  BackupSnapshotCatalogEntry,
  LedgerSnapshotData,
} from "../../domain/backup/snapshotContract.js";
import { CATEGORY_OPTIONS } from "../../domain/categorization/categoryOptions.js";
import { createCorrectionProvenance } from "../../domain/review/correction.js";
import { normalizeMerchantName } from "../../domain/merchant/normalizeMerchantName.js";
import type { CsvImportProfile } from "../../domain/import/csvImportProfile.js";
import {
  matchPendingTransactionObservations,
  type PendingTransactionMatchCandidate,
} from "../../domain/import/pendingTransactionMatching.js";
import type { ImportJobHistoryEntry, UndoImportJobResult } from "../../domain/import/importJobHistory.js";
import {
  DEFAULT_TRANSACTION_PAGE_SIZE,
  LARGE_TRANSACTION_THRESHOLD_MINOR,
  MAX_TRANSACTION_PAGE_SIZE,
  resolveTransactionDateBounds,
  type SavedLedgerView,
  type TransactionPage,
  type TransactionQuery,
  type TransactionSortDirection,
  type TransactionSortField,
} from "../../domain/ledger/filterTransactions.js";
import { validateTransactionCategoryAllocations } from "../../domain/ledger/transactionAllocations.js";
import { validateExchangeRate } from "../../domain/money/exchangeRates.js";
import { validatePropertyValuationCorrectionMetadata } from "../../domain/propertyRecordValidation.js";
import {
  validateLoanBalanceInput,
  validateLoanRecordInput,
} from "../../domain/loanRecordValidation.js";
import {
  validateHoldingRecordInput,
  validateHoldingRevision,
  validateHoldingValuationCorrectionMetadata,
  validateHoldingValuationInput,
} from "../../domain/holdingRecordValidation.js";
import type {
  AccountBalanceCheckpoint,
  AccountStatementCoveragePeriod,
  Account,
  CategorizationDecision,
  Household,
  HoldingRecord,
  HoldingRecordRevision,
  HoldingValuationSnapshot,
  ImportJob,
  ImportJobProvenance,
  ImportReviewItem,
  LoanBalanceSnapshot,
  LoanRecord,
  MerchantCorrectionProvenance,
  MerchantCategoryRule,
  MonthlyCategoryTarget,
  ExchangeRate,
  PendingTransactionObservation,
  PropertyRecord,
  PropertyValuationSnapshot,
  MonthlyTotal,
  SourceDocumentTextLineEvidence,
  SourceTextLineClassification,
  SourceTextLineEvidence,
  SourceTextItemEvidence,
  SameMerchantPropagationInput,
  SameMerchantPropagationOperation,
  Transaction,
  TransactionCategoryAllocation,
  CurrencyCode,
} from "../../domain/types.js";
import { isCurrencyCode, isYearMonth } from "../../domain/types.js";

interface LocalLedgerSeedData {
  household: Household;
  accounts: Account[];
  transactions: Transaction[];
  pendingObservations?: PendingTransactionObservation[];
  importJobs: ImportJob[];
  monthlyCategoryTargets: MonthlyCategoryTarget[];
  merchantCategoryRules?: MerchantCategoryRule[];
  accountStatementCoveragePeriods?: AccountStatementCoveragePeriod[];
  accountBalanceCheckpoints?: AccountBalanceCheckpoint[];
  exchangeRates?: ExchangeRate[];
  properties?: PropertyRecord[];
  propertyValuations?: PropertyValuationSnapshot[];
  holdings?: HoldingRecord[];
  holdingValuations?: HoldingValuationSnapshot[];
  loanRecords?: LoanRecord[];
  loanBalanceSnapshots?: LoanBalanceSnapshot[];
}

export interface LocalLedgerRuntimeMetadata {
  household: Household;
  accounts: Account[];
  monthlyCategoryTargets: MonthlyCategoryTarget[];
  merchantCategoryRules: MerchantCategoryRule[];
}

export interface LocalLedgerDatabase {
  hasHousehold: () => boolean;
  createInitialHouseholdAndAccount: (input: {
    householdName: string;
    accountName: string;
    currencyCode: string;
  }) => { household: Household; account: Account };
  loadRuntimeMetadata: () => LocalLedgerRuntimeMetadata | null;
  listMonthlyTotals: (householdId: string) => MonthlyTotal[];
  getTransactionsForMonth: (householdId: string, yearMonth: string) => Transaction[];
  getTransactionsForAccount: (accountId: string) => Transaction[];
  listPendingTransactionObservations: (householdId: string) => PendingTransactionObservation[];
  getTransactionById: (transactionId: string) => Transaction | undefined;
  updateTransactionCategoryAllocations: (
    transactionId: string,
    allocations: TransactionCategoryAllocation[]
  ) => Transaction;
  saveAccountStatementCoveragePeriod: (period: AccountStatementCoveragePeriod) => void;
  appendAccountBalanceCheckpoint: (checkpoint: AccountBalanceCheckpoint) => void;
  listAccountStatementCoveragePeriods: (accountId: string) => AccountStatementCoveragePeriod[];
  listAccountBalanceCheckpoints: (accountId: string) => AccountBalanceCheckpoint[];
  upsertExchangeRate: (rate: ExchangeRate) => void;
  upsertExchangeRates: (rates: ExchangeRate[]) => void;
  listExchangeRates: (currencyCode?: string) => ExchangeRate[];
  createPropertyRecord: (property: PropertyRecord) => void;
  updatePropertyRecordLabel: (propertyId: string, label: string) => void;
  listPropertyRecords: (householdId: string) => PropertyRecord[];
  appendPropertyValuationSnapshot: (valuation: PropertyValuationSnapshot) => void;
  listPropertyValuationSnapshots: (propertyId: string) => PropertyValuationSnapshot[];
  createHoldingRecord: (holding: HoldingRecord) => void;
  correctHoldingRecord: (holding: HoldingRecord, revision: HoldingRecordRevision) => void;
  listHoldingRecords: (householdId: string) => HoldingRecord[];
  appendHoldingValuationSnapshot: (valuation: HoldingValuationSnapshot) => void;
  listHoldingValuationSnapshots: (holdingId: string) => HoldingValuationSnapshot[];
  createLoanRecord: (loan: LoanRecord) => void;
  listLoanRecords: (householdId: string) => LoanRecord[];
  appendLoanBalanceSnapshot: (balance: LoanBalanceSnapshot) => void;
  listLoanBalanceSnapshots: (loanId: string) => LoanBalanceSnapshot[];
  loadLedgerSnapshotData: () => LedgerSnapshotData;
  replaceLedgerSnapshotData: (snapshot: LedgerSnapshotData) => void;
  saveBackupSnapshot: (entry: BackupSnapshotCatalogEntry) => void;
  listBackupSnapshots: () => BackupSnapshotCatalogEntry[];
  deleteBackupSnapshot: (snapshotPath: string) => boolean;
  queryTransactions: (householdId: string, query: TransactionQuery) => TransactionPage;
  listUncategorizedTransactions: (householdId: string) => Transaction[];
  saveLedgerView: (savedLedgerView: SavedLedgerView) => void;
  listSavedLedgerViews: () => SavedLedgerView[];
  deleteSavedLedgerView: (viewId: string) => boolean;
  saveCsvImportProfile: (profile: CsvImportProfile) => void;
  listCsvImportProfiles: (householdId: string) => CsvImportProfile[];
  deleteCsvImportProfile: (householdId: string, profileId: string) => boolean;
  listImportJobHistory: (householdId: string) => ImportJobHistoryEntry[];
  undoImportJob: (importJobId: string) => UndoImportJobResult;
  getAccountsForHousehold: (householdId: string) => Account[];
  upsertMonthlyCategoryTarget: (target: MonthlyCategoryTarget) => void;
  appendImportJob: (importJob: ImportJob) => void;
  hasImportJob: (importJobId: string) => boolean;
  getTransactionsForImportJob: (importJobId: string) => Transaction[];
  getImportedTransactionsForSource: (sourceType: ImportJob["sourceType"], sourceName: string, accountId: string, sourceIdentity?: string) => Transaction[];
  listImportReviewItems: (householdId: string) => ImportReviewItem[];
  completeImportReviewCorrection: (
    reviewItemId: string,
    transaction: Transaction,
    correctionJson: string,
    correctedAtIso: string
  ) => { item: ImportReviewItem; transaction: Transaction };
  completeImportReviewDismissal: (
    reviewItemId: string,
    reason: string,
    dismissedAtIso: string
  ) => ImportReviewItem;
  appendImportJobAndTransactions: (
    importJob: ImportJob,
    transactions: Transaction[],
    reviewItems?: ImportReviewItem[],
    pendingObservations?: PendingTransactionObservation[]
  ) => number;
  appendTransactions: (transactions: Transaction[]) => number;
  updateTransactionCategory: (transactionId: string, categoryId: string) => void;
  updateTransactionCategoryAndRule: (
    transactionId: string,
    rule: MerchantCategoryRule,
    categorization?: CategorizationDecision
  ) => void;
  listMerchantCorrectionProvenance: () => MerchantCorrectionProvenance[];
  applySameMerchantPropagation: (input: SameMerchantPropagationInput) => SameMerchantPropagationOperation;
  listSameMerchantPropagationOperations: () => SameMerchantPropagationOperation[];
  undoSameMerchantPropagation: (operationId: string) => boolean;
  listMerchantCategoryRules: () => MerchantCategoryRule[];
  upsertMerchantCategoryRule: (rule: MerchantCategoryRule) => void;
  appendManualEntry: (importJob: ImportJob, transaction: Transaction) => void;
  close: () => void;
}

interface CreateLocalLedgerDatabaseOptions {
  dbPath?: string;
  seedData?: LocalLedgerSeedData;
}

interface TransactionRow {
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
  category_allocations_json?: string | null;
}

interface PendingTransactionObservationRow {
  id: string;
  household_id: string;
  account_id: string;
  transaction_date_iso: string;
  amount_minor: number;
  merchant_raw: string;
  source_row_index: number;
  currency_code: string | null;
  source_type: PendingTransactionObservation["sourceType"];
  source_reference: string | null;
  import_job_id: string | null;
  status: PendingTransactionObservation["status"];
  source_status: PendingTransactionObservation["sourceStatus"];
  reconciled_transaction_id: string | null;
  reconciled_at_iso: string | null;
}

const transactionSortColumns: Record<TransactionSortField, string> = {
  bookedAtIso: "t.booked_at_iso",
  merchantRaw: "t.merchant_search",
  amountMinor: "t.amount_minor",
  categoryId: `CASE WHEN t.category_id IS NULL THEN ? ELSE CASE t.category_id ${CATEGORY_OPTIONS
    .map(() => "WHEN ? THEN ?")
    .join(" ")} ELSE t.category_id END END`,
  accountId: "COALESCE(a.name, t.account_id)",
};
const categorySortParameters = [
  "Uncategorized",
  ...CATEGORY_OPTIONS.flatMap(({ id, label }) => [id, label]),
];

function merchantSearchValue(transaction: Pick<Transaction, "merchantRaw" | "merchantAlias">): string {
  return `${transaction.merchantRaw}\n${transaction.merchantAlias ?? ""}`.toUpperCase();
}

function nextYearMonth(yearMonth: string): string {
  const [yearText, monthText] = yearMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function mapTransactionRow(transaction: TransactionRow): Transaction {
  const mapped: Transaction = {
    id: transaction.id,
    householdId: transaction.household_id,
    accountId: transaction.account_id,
    bookedAtIso: transaction.booked_at_iso,
    amountMinor: transaction.amount_minor,
    merchantRaw: transaction.merchant_raw,
  };
  if (transaction.currency_code !== null) mapped.currencyCode = transaction.currency_code;
  if (transaction.source_type !== null) mapped.sourceType = transaction.source_type;
  if (transaction.source_reference !== null) mapped.sourceReference = transaction.source_reference;
  if (transaction.category_id !== null) mapped.categoryId = transaction.category_id;
  if (transaction.import_job_id !== null) mapped.importJobId = transaction.import_job_id;
  if (transaction.category_allocations_json != null) {
    const parsed: unknown = JSON.parse(transaction.category_allocations_json);
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid category allocations for transaction ${transaction.id}.`);
    }
    const allocations: TransactionCategoryAllocation[] = parsed.map((value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("categoryId" in value) ||
        typeof value.categoryId !== "string" ||
        !("amountMinor" in value) ||
        typeof value.amountMinor !== "number"
      ) {
        throw new Error(`Invalid category allocations for transaction ${transaction.id}.`);
      }
      return { categoryId: value.categoryId, amountMinor: value.amountMinor };
    });
    validateTransactionCategoryAllocations(
      mapped,
      allocations,
      CATEGORY_OPTIONS.map((category) => category.id)
    );
    mapped.categoryAllocations = allocations;
  }
  return mapped;
}

function serializeTransactionCategoryAllocations(transaction: Transaction): string | null {
  if (transaction.categoryAllocations === undefined || transaction.categoryAllocations.length === 0) {
    return null;
  }
  const allocations = transaction.categoryAllocations.map((allocation) => ({
    categoryId: allocation.categoryId,
    amountMinor: allocation.amountMinor,
  }));
  validateTransactionCategoryAllocations(
    transaction,
    allocations,
    CATEGORY_OPTIONS.map((category) => category.id)
  );
  return JSON.stringify(allocations);
}

function mapPendingTransactionObservationRow(
  observation: PendingTransactionObservationRow
): PendingTransactionObservation {
  const mapped: PendingTransactionObservation = {
    id: observation.id,
    householdId: observation.household_id,
    accountId: observation.account_id,
    transactionDateIso: observation.transaction_date_iso,
    amountMinor: observation.amount_minor,
    merchantRaw: observation.merchant_raw,
    sourceRowIndex: observation.source_row_index,
    sourceType: observation.source_type,
    status: observation.status,
    sourceStatus: observation.source_status,
  };
  if (observation.currency_code !== null) mapped.currencyCode = observation.currency_code;
  if (observation.source_reference !== null) mapped.sourceReference = observation.source_reference;
  if (observation.import_job_id !== null) mapped.importJobId = observation.import_job_id;
  if (observation.reconciled_transaction_id !== null) {
    mapped.reconciledTransactionId = observation.reconciled_transaction_id;
  }
  if (observation.reconciled_at_iso !== null) mapped.reconciledAtIso = observation.reconciled_at_iso;
  return mapped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceTextItemEvidence(value: unknown): value is SourceTextItemEvidence {
  if (!isRecord(value)) return false;
  return typeof value.text === "string" &&
    typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y);
}

function isSourceTextLineClassification(value: unknown): value is SourceTextLineClassification {
  return value === "document-metadata" ||
    value === "column-header" ||
    value === "transaction" ||
    value === "continuation" ||
    value === "document-decoration" ||
    value === "unclassified";
}

function isSourceTextLineEvidence(value: unknown): value is SourceTextLineEvidence {
  if (!isRecord(value)) return false;
  return typeof value.pageNumber === "number" && Number.isSafeInteger(value.pageNumber) && value.pageNumber > 0 &&
    typeof value.lineNumber === "number" && Number.isSafeInteger(value.lineNumber) && value.lineNumber > 0 &&
    typeof value.startOffset === "number" && Number.isSafeInteger(value.startOffset) && value.startOffset >= 0 &&
    typeof value.endOffset === "number" && Number.isSafeInteger(value.endOffset) &&
      value.endOffset >= value.startOffset &&
    typeof value.rawText === "string" &&
    (value.classification === undefined || isSourceTextLineClassification(value.classification)) &&
    (value.items === undefined || (
      Array.isArray(value.items) && value.items.every(isSourceTextItemEvidence)
    ));
}

function isSourceDocumentTextLineEvidence(
  value: unknown
): value is SourceDocumentTextLineEvidence {
  if (!isRecord(value)) return false;
  return typeof value.pageNumber === "number" &&
    Number.isSafeInteger(value.pageNumber) &&
    value.pageNumber > 0 &&
    Array.isArray(value.sourceLines) &&
    value.sourceLines.every((line) =>
      isSourceTextLineEvidence(line) && line.pageNumber === value.pageNumber
    );
}

function mapImportReviewItemRow(row: Record<string, unknown>): ImportReviewItem {
  const requiredString = (column: string): string => {
    const value = row[column];
    if (typeof value !== "string") {
      throw new Error(`Invalid import review item ${column} value.`);
    }
    return value;
  };
  const optionalString = (column: string): string | undefined => {
    const value = row[column];
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new Error(`Invalid import review item ${column} value.`);
    }
    return value;
  };
  const sourceType = requiredString("source_type");
  if (sourceType !== "csv" && sourceType !== "pdf") {
    throw new Error(`Invalid import review source type: ${sourceType}`);
  }
  const status = requiredString("status");
  if (status !== "unresolved" && status !== "corrected" && status !== "dismissed") {
    throw new Error(`Invalid import review status: ${status}`);
  }
  const sourceRowIndex = row.source_row_index;
  if (typeof sourceRowIndex !== "number" || !Number.isSafeInteger(sourceRowIndex)) {
    throw new Error("Invalid import review item source row index.");
  }
  const parserErrorsJson = requiredString("parser_errors_json");
  const parserErrors: unknown = JSON.parse(parserErrorsJson);
  if (!Array.isArray(parserErrors) || !parserErrors.every((error) =>
    typeof error === "object" && error !== null &&
      "code" in error && typeof error.code === "string" &&
      "message" in error && typeof error.message === "string" &&
      (!("field" in error) || typeof error.field === "string")
  )) {
    throw new Error("Invalid import review item parser diagnostics.");
  }
  const sourceEvidenceJson = optionalString("source_evidence_json");
  const sourceEvidence: unknown = sourceEvidenceJson === undefined
    ? undefined
    : JSON.parse(sourceEvidenceJson);
  if (sourceEvidence !== undefined && !isSourceDocumentTextLineEvidence(sourceEvidence)) {
    throw new Error("Invalid import review item source evidence.");
  }
  const correctedAtIso = optionalString("corrected_at_iso");
  const correctedTransactionId = optionalString("corrected_transaction_id");
  const correctionJson = optionalString("correction_json");
  const dismissalReason = optionalString("dismissal_reason");
  const dismissedAtIso = optionalString("dismissed_at_iso");

  return {
    id: requiredString("id"),
    importJobId: requiredString("import_job_id"),
    householdId: requiredString("household_id"),
    accountId: requiredString("account_id"),
    sourceType,
    sourceName: requiredString("source_name"),
    sourceIdentity: requiredString("source_identity"),
    sourceRowIndex,
    ...(sourceEvidence === undefined ? {} : { sourceEvidence }),
    rawRow: requiredString("raw_row"),
    parserErrors,
    status,
    createdAtIso: requiredString("created_at_iso"),
    updatedAtIso: requiredString("updated_at_iso"),
    ...(correctedAtIso === undefined ? {} : { correctedAtIso }),
    ...(correctedTransactionId === undefined ? {} : { correctedTransactionId }),
    ...(correctionJson === undefined ? {} : { correctionJson }),
    ...(dismissalReason === undefined ? {} : { dismissalReason }),
    ...(dismissedAtIso === undefined ? {} : { dismissedAtIso }),
  };
}

function serializeTransactionForUndo(transaction: Transaction): string {
  return JSON.stringify({
    id: transaction.id,
    householdId: transaction.householdId,
    accountId: transaction.accountId,
    bookedAtIso: transaction.bookedAtIso,
    amountMinor: transaction.amountMinor,
    merchantRaw: transaction.merchantRaw,
    currencyCode: transaction.currencyCode ?? null,
    sourceType: transaction.sourceType ?? null,
    sourceReference: transaction.sourceReference ?? null,
    categoryId: transaction.categoryId ?? null,
    categoryAllocations: transaction.categoryAllocations ?? null,
    importJobId: transaction.importJobId ?? null,
  });
}

function persistImportJobOperation(
  db: DatabaseSync,
  importJob: ImportJob,
  importedTransactions: Transaction[],
  importedPendingCount = 0
): void {
  const accountId = importJob.provenance?.accountId ?? importedTransactions[0]?.accountId ?? null;
  const candidateCount = importJob.candidateCount ?? importedTransactions.length;
  const duplicateCount = importJob.provenance?.duplicateCount ?? 0;
  db.prepare(`
    INSERT INTO import_job_operations (
      import_job_id, household_id, account_id, candidate_count, imported_count, duplicate_count
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(import_job_id) DO UPDATE SET
      household_id = excluded.household_id,
      account_id = COALESCE(excluded.account_id, import_job_operations.account_id),
      candidate_count = excluded.candidate_count,
      imported_count = MAX(import_job_operations.imported_count, excluded.imported_count),
      duplicate_count = excluded.duplicate_count
  `).run(
    importJob.id,
    importJob.householdId,
    accountId,
    candidateCount,
    importedTransactions.length + importedPendingCount,
    duplicateCount
  );
}

function persistTransactionBaseline(db: DatabaseSync, importJobId: string, transaction: Transaction): void {
  db.prepare(
    "INSERT OR REPLACE INTO import_job_transaction_baselines (import_job_id, transaction_id, baseline_json) VALUES (?, ?, ?)"
  ).run(importJobId, transaction.id, serializeTransactionForUndo(transaction));
}

function defaultLocalDatabasePath(): string {
  return process.env.BUDGET_DB_PATH ?? join(process.cwd(), "data", "local", "budget.sqlite");
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at_iso TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      currency_code TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      booked_at_iso TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      merchant_raw TEXT NOT NULL,
      merchant_search TEXT NOT NULL DEFAULT '',
      currency_code TEXT,
      source_type TEXT,
      source_reference TEXT,
      category_id TEXT,
      import_job_id TEXT,
      categorization_json TEXT,
      category_allocations_json TEXT
    );

    CREATE INDEX IF NOT EXISTS transactions_by_household_booked_at
      ON transactions (household_id, booked_at_iso);

    CREATE TABLE IF NOT EXISTS pending_transaction_observations (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      transaction_date_iso TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      merchant_raw TEXT NOT NULL,
      source_row_index INTEGER NOT NULL,
      currency_code TEXT,
      source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'pdf')),
      source_reference TEXT,
      import_job_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('reserved', 'confirmed')),
      source_status TEXT NOT NULL CHECK (source_status IN ('Reservert', 'Bekreftet')),
      reconciled_transaction_id TEXT,
      reconciled_at_iso TEXT
    );

    CREATE INDEX IF NOT EXISTS pending_observations_by_household_date
      ON pending_transaction_observations (household_id, transaction_date_iso, id);
    CREATE INDEX IF NOT EXISTS pending_observations_by_account_reference
      ON pending_transaction_observations (account_id, source_reference);

    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      adapter_id TEXT,
      candidate_count INTEGER,
      validation_failure_count INTEGER,
      started_at_iso TEXT NOT NULL,
      finished_at_iso TEXT,
      provenance_json TEXT
    );

    CREATE TABLE IF NOT EXISTS import_review_items (
      id TEXT PRIMARY KEY,
      import_job_id TEXT NOT NULL,
      household_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'pdf')),
      source_name TEXT NOT NULL,
      source_identity TEXT NOT NULL,
      source_row_index INTEGER NOT NULL,
      source_evidence_json TEXT,
      raw_row TEXT NOT NULL,
      parser_errors_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('unresolved', 'corrected', 'dismissed')),
      created_at_iso TEXT NOT NULL,
      updated_at_iso TEXT NOT NULL,
      corrected_at_iso TEXT,
      corrected_transaction_id TEXT,
      correction_json TEXT,
      dismissal_reason TEXT,
      dismissed_at_iso TEXT
    );

    CREATE INDEX IF NOT EXISTS import_review_items_by_household_status
      ON import_review_items (household_id, status, created_at_iso);

    CREATE TABLE IF NOT EXISTS monthly_category_targets (
      year_month TEXT NOT NULL,
      category_id TEXT NOT NULL,
      target_minor INTEGER NOT NULL,
      PRIMARY KEY (year_month, category_id)
    );

    CREATE TABLE IF NOT EXISTS account_statement_coverage_periods (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      start_date_iso TEXT NOT NULL,
      end_date_iso TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'csv', 'pdf')),
      import_job_id TEXT,
      imported_at_iso TEXT,
      confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
      confirmed_at_iso TEXT
    );

    CREATE INDEX IF NOT EXISTS account_coverage_by_account_period
      ON account_statement_coverage_periods (account_id, start_date_iso, end_date_iso, id);

    CREATE TABLE IF NOT EXISTS account_balance_checkpoints (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date_iso TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance_minor INTEGER NOT NULL,
      source TEXT NOT NULL,
      source_reference TEXT,
      recorded_at_iso TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS account_checkpoints_by_account_date
      ON account_balance_checkpoints (account_id, date_iso, recorded_at_iso, id);

    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at_iso TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS properties_by_household_label
      ON properties (household_id, label COLLATE NOCASE, id);

    CREATE TABLE IF NOT EXISTS property_valuation_snapshots (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      effective_date_iso TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      currency_code TEXT NOT NULL,
      recorded_at_iso TEXT NOT NULL,
      correction_json TEXT
    );

    CREATE INDEX IF NOT EXISTS property_valuations_by_property_date
      ON property_valuation_snapshots (property_id, effective_date_iso, recorded_at_iso, id);

    CREATE TABLE IF NOT EXISTS investment_holdings (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      label TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      cost_basis_minor INTEGER NOT NULL CHECK (cost_basis_minor >= 0),
      currency_code TEXT NOT NULL,
      created_at_iso TEXT NOT NULL,
      revisions_json TEXT
    );

    CREATE INDEX IF NOT EXISTS holdings_by_household_label
      ON investment_holdings (household_id, label COLLATE NOCASE, id);

    CREATE TABLE IF NOT EXISTS holding_valuation_snapshots (
      id TEXT PRIMARY KEY,
      holding_id TEXT NOT NULL,
      effective_date_iso TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      currency_code TEXT NOT NULL,
      recorded_at_iso TEXT NOT NULL,
      correction_json TEXT
    );

    CREATE INDEX IF NOT EXISTS holding_valuations_by_holding_date
      ON holding_valuation_snapshots (holding_id, effective_date_iso, recorded_at_iso, id);

    CREATE TABLE IF NOT EXISTS loan_records (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      label TEXT NOT NULL,
      principal_minor INTEGER NOT NULL CHECK (principal_minor > 0),
      annual_interest_rate_basis_points INTEGER NOT NULL
        CHECK (annual_interest_rate_basis_points BETWEEN 0 AND 10000),
      term_months INTEGER NOT NULL CHECK (term_months > 0),
      payment_amount_minor INTEGER NOT NULL CHECK (payment_amount_minor > 0),
      payment_frequency TEXT NOT NULL
        CHECK (payment_frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
      currency_code TEXT NOT NULL,
      property_id TEXT,
      created_at_iso TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS loans_by_household_label
      ON loan_records (household_id, label COLLATE NOCASE, id);

    CREATE TABLE IF NOT EXISTS loan_balance_snapshots (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      effective_date_iso TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      currency_code TEXT NOT NULL,
      recorded_at_iso TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS loan_balances_by_loan_date
      ON loan_balance_snapshots (loan_id, effective_date_iso, recorded_at_iso, id);

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      currency_code TEXT NOT NULL,
      rate_nok_per_unit TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('dated', 'monthly-reference')),
      source TEXT NOT NULL,
      provenance TEXT NOT NULL CHECK (provenance IN ('manual', 'local-file')),
      UNIQUE (currency_code, effective_date, kind)
    );

    CREATE TABLE IF NOT EXISTS merchant_category_rules (
      merchant_alias TEXT PRIMARY KEY,
      category_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS merchant_correction_provenance (
      id TEXT PRIMARY KEY,
      source_transaction_id TEXT NOT NULL,
      merchant_alias TEXT NOT NULL,
      category_id TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'local-user',
      corrected_at_iso TEXT NOT NULL,
      original_categorization_json TEXT
    );

    CREATE TABLE IF NOT EXISTS same_merchant_propagation_operations (
      id TEXT PRIMARY KEY,
      source_transaction_id TEXT NOT NULL,
      merchant_alias TEXT NOT NULL,
      category_id TEXT NOT NULL,
      applied_at_iso TEXT NOT NULL,
      undone_at_iso TEXT
    );

    CREATE TABLE IF NOT EXISTS same_merchant_propagation_changes (
      operation_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      before_category_id TEXT,
      after_category_id TEXT NOT NULL,
      before_categorization_json TEXT,
      after_categorization_json TEXT,
      PRIMARY KEY (operation_id, transaction_id)
    );

    CREATE TABLE IF NOT EXISTS saved_ledger_views (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      filters_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_snapshots (
      snapshot_path TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('backup', 'pre-restore')),
      version TEXT NOT NULL,
      household_name TEXT NOT NULL,
      created_at_iso TEXT NOT NULL,
      saved_at_iso TEXT NOT NULL,
      account_count INTEGER NOT NULL,
      transaction_count INTEGER NOT NULL,
      content_hash_sha256 TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS csv_import_profiles (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      account_id TEXT NOT NULL,
      column_mapping_json TEXT NOT NULL,
      created_at_iso TEXT NOT NULL,
      updated_at_iso TEXT NOT NULL,
      UNIQUE (household_id, name COLLATE NOCASE)
    );

    CREATE TABLE IF NOT EXISTS import_job_operations (
      import_job_id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      account_id TEXT,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      undone_at_iso TEXT,
      undo_removed_count INTEGER NOT NULL DEFAULT 0,
      undo_retained_count INTEGER NOT NULL DEFAULT 0,
      undo_available INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS import_job_transaction_baselines (
      import_job_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      baseline_json TEXT NOT NULL,
      PRIMARY KEY (import_job_id, transaction_id)
    );
  `);

  const propertyValuationColumns = db
    .prepare("PRAGMA table_info(property_valuation_snapshots)")
    .all() as Array<{ name: string }>;
  if (!propertyValuationColumns.some((column) => column.name === "correction_json")) {
    db.exec("ALTER TABLE property_valuation_snapshots ADD COLUMN correction_json TEXT");
  }
  const holdingColumns = db.prepare("PRAGMA table_info(investment_holdings)").all() as Array<{ name: string }>;
  if (!holdingColumns.some((column) => column.name === "revisions_json")) {
    db.exec("ALTER TABLE investment_holdings ADD COLUMN revisions_json TEXT");
  }
  const holdingValuationColumns = db.prepare("PRAGMA table_info(holding_valuation_snapshots)").all() as Array<{ name: string }>;
  if (!holdingValuationColumns.some((column) => column.name === "correction_json")) {
    db.exec("ALTER TABLE holding_valuation_snapshots ADD COLUMN correction_json TEXT");
  }

  const pendingObservationColumns = db
    .prepare("PRAGMA table_info(pending_transaction_observations)")
    .all() as Array<{ name: string }>;
  if (!pendingObservationColumns.some((column) => column.name === "reconciled_transaction_id")) {
    db.exec("ALTER TABLE pending_transaction_observations ADD COLUMN reconciled_transaction_id TEXT");
  }
  if (!pendingObservationColumns.some((column) => column.name === "reconciled_at_iso")) {
    db.exec("ALTER TABLE pending_transaction_observations ADD COLUMN reconciled_at_iso TEXT");
  }

  const transactionColumns = db.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>;
  if (!transactionColumns.some((column) => column.name === "currency_code")) {
    db.exec("ALTER TABLE transactions ADD COLUMN currency_code TEXT");
  }
  if (!transactionColumns.some((column) => column.name === "source_type")) {
    db.exec("ALTER TABLE transactions ADD COLUMN source_type TEXT");
  }
  if (!transactionColumns.some((column) => column.name === "source_reference")) {
    db.exec("ALTER TABLE transactions ADD COLUMN source_reference TEXT");
  }
  if (!transactionColumns.some((column) => column.name === "categorization_json")) {
    db.exec("ALTER TABLE transactions ADD COLUMN categorization_json TEXT");
  }
  if (!transactionColumns.some((column) => column.name === "category_allocations_json")) {
    db.exec("ALTER TABLE transactions ADD COLUMN category_allocations_json TEXT");
  }
  if (!transactionColumns.some((column) => column.name === "merchant_search")) {
    db.exec("ALTER TABLE transactions ADD COLUMN merchant_search TEXT NOT NULL DEFAULT ''");
  }
  const correctionProvenanceColumns = db
    .prepare("PRAGMA table_info(merchant_correction_provenance)")
    .all() as Array<{ name: string }>;
  if (!correctionProvenanceColumns.some((column) => column.name === "original_categorization_json")) {
    db.exec("ALTER TABLE merchant_correction_provenance ADD COLUMN original_categorization_json TEXT");
  }
  if (!correctionProvenanceColumns.some((column) => column.name === "actor")) {
    db.exec("ALTER TABLE merchant_correction_provenance ADD COLUMN actor TEXT NOT NULL DEFAULT 'local-user'");
  }
  const propagationChangeColumns = db
    .prepare("PRAGMA table_info(same_merchant_propagation_changes)")
    .all() as Array<{ name: string }>;
  const propagationCategorizationColumns = [
    ["before_categorization_json", "TEXT"],
    ["after_categorization_json", "TEXT"],
  ] as const;
  const isLegacyPropagationSchema = propagationCategorizationColumns.some(([columnName]) =>
    !propagationChangeColumns.some((column) => column.name === columnName)
  );
  for (const [columnName, columnType] of propagationCategorizationColumns) {
    if (!propagationChangeColumns.some((column) => column.name === columnName)) {
      db.exec(`ALTER TABLE same_merchant_propagation_changes ADD COLUMN ${columnName} ${columnType}`);
    }
  }
  if (isLegacyPropagationSchema) {
    db.exec(`
      UPDATE same_merchant_propagation_changes
      SET before_categorization_json = (
        SELECT categorization_json FROM transactions
        WHERE transactions.id = same_merchant_propagation_changes.transaction_id
      ),
      after_categorization_json = (
        SELECT categorization_json FROM transactions
        WHERE transactions.id = same_merchant_propagation_changes.transaction_id
      )
      WHERE before_categorization_json IS NULL AND after_categorization_json IS NULL
    `);
  }
  const transactionsWithoutMerchantSearch = db
    .prepare("SELECT id, merchant_raw FROM transactions WHERE merchant_search = ''")
    .all() as Array<{ id: string; merchant_raw: string }>;
  const updateMerchantSearch = db.prepare("UPDATE transactions SET merchant_search = ? WHERE id = ?");
  for (const transaction of transactionsWithoutMerchantSearch) {
    updateMerchantSearch.run(transaction.merchant_raw.toUpperCase(), transaction.id);
  }

  const importOperationColumns = db.prepare("PRAGMA table_info(import_job_operations)").all() as Array<{ name: string }>;
  if (!importOperationColumns.some((column) => column.name === "undo_available")) {
    db.exec("ALTER TABLE import_job_operations ADD COLUMN undo_available INTEGER NOT NULL DEFAULT 1");
  }

  const backupSnapshotColumns = db.prepare("PRAGMA table_info(backup_snapshots)").all() as Array<{ name: string }>;
  if (!backupSnapshotColumns.some((column) => column.name === "version")) {
    db.exec("ALTER TABLE backup_snapshots ADD COLUMN version TEXT NOT NULL DEFAULT '3'");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_household_booked_id
      ON transactions (household_id, booked_at_iso, id);
    CREATE INDEX IF NOT EXISTS idx_transactions_household_account_booked_id
      ON transactions (household_id, account_id, booked_at_iso, id);
    CREATE INDEX IF NOT EXISTS idx_transactions_household_amount_id
      ON transactions (household_id, amount_minor, id);
    CREATE INDEX IF NOT EXISTS idx_transactions_household_category_id
      ON transactions (household_id, category_id, id);
    CREATE INDEX IF NOT EXISTS idx_transactions_household_allocations
      ON transactions (household_id, category_allocations_json);
    CREATE INDEX IF NOT EXISTS idx_merchant_correction_provenance_corrected_at
      ON merchant_correction_provenance (corrected_at_iso, id);
    CREATE INDEX IF NOT EXISTS idx_same_merchant_propagation_applied_at
      ON same_merchant_propagation_operations (applied_at_iso, id);
    CREATE INDEX IF NOT EXISTS idx_backup_snapshots_saved_at
      ON backup_snapshots (saved_at_iso DESC, snapshot_path);
  `);

  const importJobColumns = db.prepare("PRAGMA table_info(import_jobs)").all() as Array<{ name: string }>;
  const importJobColumnsToAdd = [
    ["adapter_id", "TEXT"],
    ["candidate_count", "INTEGER"],
    ["validation_failure_count", "INTEGER"],
    ["provenance_json", "TEXT"],
  ] as const;
  for (const [columnName, columnType] of importJobColumnsToAdd) {
    if (!importJobColumns.some((column) => column.name === columnName)) {
      db.exec(`ALTER TABLE import_jobs ADD COLUMN ${columnName} ${columnType}`);
    }
  }
  const importReviewItemColumns = db
    .prepare("PRAGMA table_info(import_review_items)")
    .all() as Array<{ name: string }>;
  if (!importReviewItemColumns.some((column) => column.name === "source_evidence_json")) {
    db.exec("ALTER TABLE import_review_items ADD COLUMN source_evidence_json TEXT");
  }
}

function insertLedgerSnapshot(db: DatabaseSync, snapshot: LedgerSnapshotData): void {
  db.prepare(
    "INSERT INTO households (id, name, created_at_iso) VALUES (?, ?, ?)"
  ).run(snapshot.household.id, snapshot.household.name, snapshot.household.createdAtIso);

  const insertAccount = db.prepare(
    "INSERT INTO accounts (id, household_id, name, currency_code) VALUES (?, ?, ?, ?)"
  );
  for (const account of snapshot.accounts) {
    insertAccount.run(account.id, account.householdId, account.name, account.currencyCode);
  }

  const insertProperty = db.prepare(
    "INSERT INTO properties (id, household_id, label, created_at_iso) VALUES (?, ?, ?, ?)"
  );
  for (const property of snapshot.properties ?? []) {
    insertProperty.run(property.id, property.householdId, property.label, property.createdAtIso);
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
      created_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      loan.createdAtIso
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
  "INSERT INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json, category_allocations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const transaction of snapshot.transactions) {
    insertTransaction.run(
      transaction.id,
      transaction.householdId,
      transaction.accountId,
      transaction.bookedAtIso,
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

function seedIfEmpty(db: DatabaseSync, seedData: LocalLedgerSeedData): void {
  const existingCount = db
    .prepare("SELECT COUNT(*) AS count FROM households")
    .get() as { count: number };

  if (existingCount.count > 0) {
    return;
  }

  db.exec("BEGIN");

  try {
    insertLedgerSnapshot(db, seedData);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hasHousehold(db: DatabaseSync): boolean {
  return db.prepare("SELECT id FROM households LIMIT 1").get() !== undefined;
}

function createInitialHouseholdAndAccount(
  db: DatabaseSync,
  input: { householdName: string; accountName: string; currencyCode: string }
): { household: Household; account: Account } {
  const household: Household = {
    id: randomUUID(),
    name: input.householdName,
    createdAtIso: new Date().toISOString(),
  };
  const account: Account = {
    id: randomUUID(),
    householdId: household.id,
    name: input.accountName,
    currencyCode: input.currencyCode,
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasHousehold(db)) {
      throw new Error("A household has already been set up.");
    }
    db.prepare("INSERT INTO households (id, name, created_at_iso) VALUES (?, ?, ?)")
      .run(household.id, household.name, household.createdAtIso);
    db.prepare("INSERT INTO accounts (id, household_id, name, currency_code) VALUES (?, ?, ?, ?)")
      .run(account.id, account.householdId, account.name, account.currencyCode);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { household, account };
}

function parseSourceType(sourceType: string): ImportJob["sourceType"] {
  if (sourceType === "csv" || sourceType === "pdf" || sourceType === "manual") {
    return sourceType;
  }

  throw new Error(`Unsupported source_type value in SQLite import_jobs table: ${sourceType}`);
}

export function createLocalLedgerDatabase(
  options: CreateLocalLedgerDatabaseOptions
): LocalLedgerDatabase {
  const dbPath = options.dbPath ?? defaultLocalDatabasePath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  ensureSchema(db);
  if (options.seedData !== undefined) seedIfEmpty(db, options.seedData);

  function loadRuntimeMetadata(): LocalLedgerRuntimeMetadata | null {
    const householdRow = db
      .prepare("SELECT id, name, created_at_iso FROM households ORDER BY id LIMIT 1")
      .get() as { id: string; name: string; created_at_iso: string } | undefined;
    if (householdRow === undefined) return null;

    const targets = db.prepare(`
      SELECT year_month, category_id, target_minor
      FROM monthly_category_targets
      ORDER BY year_month, category_id
    `).all() as Array<{ year_month: string; category_id: string; target_minor: number }>;

    return {
      household: {
        id: householdRow.id,
        name: householdRow.name,
        createdAtIso: householdRow.created_at_iso,
      },
      accounts: getAccountsForHousehold(householdRow.id),
      monthlyCategoryTargets: targets.map((target) => ({
        yearMonth: target.year_month,
        categoryId: target.category_id,
        targetMinor: target.target_minor,
      })),
      merchantCategoryRules: listMerchantCategoryRules(),
    };
  }

  function listMonthlyTotals(householdId: string): MonthlyTotal[] {
    const rows = db.prepare(`
      SELECT substr(booked_at_iso, 1, 7) AS year_month, SUM(amount_minor) AS total_minor
      FROM transactions
      WHERE household_id = ?
      GROUP BY substr(booked_at_iso, 1, 7)
      ORDER BY year_month
    `).all(householdId) as Array<{ year_month: string; total_minor: number | bigint }>;
    if (rows.length === 0) return [];

    const totalsByMonth = new Map(rows.map((row) => [row.year_month, Number(row.total_minor)]));
    const lastMonth = rows[rows.length - 1]!.year_month;
    const monthlyTotals: MonthlyTotal[] = [];
    let currentMonth = rows[0]!.year_month;
    while (currentMonth <= lastMonth) {
      monthlyTotals.push({
        yearMonth: currentMonth,
        totalMinor: totalsByMonth.get(currentMonth) ?? 0,
      });
      currentMonth = nextYearMonth(currentMonth);
    }
    return monthlyTotals;
  }

  function getTransactionsForMonth(householdId: string, yearMonth: string): Transaction[] {
    if (!isYearMonth(yearMonth)) throw new Error(`Invalid dashboard month: ${yearMonth}`);
    const rows = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id,
        category_allocations_json
      FROM transactions
      WHERE household_id = ? AND booked_at_iso >= ? AND booked_at_iso < ?
      ORDER BY booked_at_iso ASC, id ASC
    `).all(householdId, `${yearMonth}-01`, `${nextYearMonth(yearMonth)}-01`) as unknown as TransactionRow[];
    return rows.map(mapTransactionRow);
  }

  function getTransactionsForAccount(accountId: string): Transaction[] {
    const rows = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id,
        category_allocations_json
      FROM transactions
      WHERE account_id = ?
      ORDER BY booked_at_iso ASC, id ASC
    `).all(accountId) as unknown as TransactionRow[];
    return rows.map(mapTransactionRow);
  }

  function listPendingTransactionObservations(
    householdId: string
  ): PendingTransactionObservation[] {
    const rows = db.prepare(`
      SELECT id, household_id, account_id, transaction_date_iso, amount_minor, merchant_raw,
        source_row_index, currency_code, source_type, source_reference, import_job_id,
        status, source_status, reconciled_transaction_id, reconciled_at_iso
      FROM pending_transaction_observations
      WHERE household_id = ? AND reconciled_transaction_id IS NULL
      ORDER BY transaction_date_iso DESC, id ASC
    `).all(householdId) as unknown as PendingTransactionObservationRow[];
    return rows.map(mapPendingTransactionObservationRow);
  }

  function getTransactionById(transactionId: string): Transaction | undefined {
    const row = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id,
        category_allocations_json
      FROM transactions
      WHERE id = ?
    `).get(transactionId) as TransactionRow | undefined;
    return row === undefined ? undefined : mapTransactionRow(row);
  }

  function updateTransactionCategoryAllocations(
    transactionId: string,
    allocations: TransactionCategoryAllocation[]
  ): Transaction {
    db.exec("BEGIN IMMEDIATE");
    try {
      const transaction = getTransactionById(transactionId);
      if (transaction === undefined) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }
      if (allocations.length > 0) {
        validateTransactionCategoryAllocations(
          transaction,
          allocations,
          CATEGORY_OPTIONS.map((category) => category.id)
        );
      }
      const orderedAllocations = allocations.map((allocation) => ({
        categoryId: allocation.categoryId,
        amountMinor: allocation.amountMinor,
      }));
      const result = db.prepare(
        "UPDATE transactions SET category_allocations_json = ? WHERE id = ?"
      ).run(
        orderedAllocations.length === 0 ? null : JSON.stringify(orderedAllocations),
        transactionId
      ) as { changes: number | bigint };
      if (Number(result.changes) !== 1) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }
      db.exec("COMMIT");
      const updated: Transaction = { ...transaction };
      if (orderedAllocations.length === 0) {
        delete updated.categoryAllocations;
      } else {
        updated.categoryAllocations = orderedAllocations;
      }
      return updated;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function saveAccountStatementCoveragePeriod(period: AccountStatementCoveragePeriod): void {
    const isValidDate = (value: string): boolean =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
    if (
      period.id.trim().length === 0 ||
      period.accountId.trim().length === 0 ||
      !isValidDate(period.startDateIso) ||
      !isValidDate(period.endDateIso) ||
      period.startDateIso > period.endDateIso ||
      !isCurrencyCode(period.currencyCode) ||
      period.sourceName.trim().length === 0 ||
      (period.sourceType !== "manual" && period.sourceType !== "csv" && period.sourceType !== "pdf") ||
      typeof period.confirmed !== "boolean" ||
      (period.importedAtIso !== undefined && Number.isNaN(Date.parse(period.importedAtIso))) ||
      (period.confirmedAtIso !== undefined && Number.isNaN(Date.parse(period.confirmedAtIso))) ||
      (period.confirmed && period.confirmedAtIso === undefined)
    ) {
      throw new Error("Account statement coverage period is invalid.");
    }
    const account = db.prepare(
      "SELECT household_id, currency_code FROM accounts WHERE id = ?"
    ).get(period.accountId) as { household_id: string; currency_code: string } | undefined;
    if (account === undefined) {
      throw new Error(`Account not found: ${period.accountId}`);
    }
    if (period.currencyCode !== account.currency_code) {
      throw new Error("Account coverage currency must match the account currency.");
    }
    if (
      period.importJobId !== undefined &&
      db.prepare("SELECT 1 FROM import_jobs WHERE id = ? AND household_id = ?")
        .get(period.importJobId, account.household_id) === undefined
    ) {
      throw new Error(`Import job not found for account coverage period: ${period.importJobId}`);
    }

    db.prepare(`
      INSERT INTO account_statement_coverage_periods (
        id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
        source_type, import_job_id, imported_at_iso, confirmed, confirmed_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        start_date_iso = excluded.start_date_iso,
        end_date_iso = excluded.end_date_iso,
        currency_code = excluded.currency_code,
        source_name = excluded.source_name,
        source_type = excluded.source_type,
        import_job_id = excluded.import_job_id,
        imported_at_iso = excluded.imported_at_iso,
        confirmed = excluded.confirmed,
        confirmed_at_iso = excluded.confirmed_at_iso
    `).run(
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

  function appendAccountBalanceCheckpoint(checkpoint: AccountBalanceCheckpoint): void {
    if (
      checkpoint.id.trim().length === 0 ||
      checkpoint.accountId.trim().length === 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(checkpoint.dateIso) ||
      Number.isNaN(Date.parse(`${checkpoint.dateIso}T00:00:00.000Z`)) ||
      new Date(`${checkpoint.dateIso}T00:00:00.000Z`).toISOString().slice(0, 10) !== checkpoint.dateIso ||
      !isCurrencyCode(checkpoint.currencyCode) ||
      !Number.isSafeInteger(checkpoint.balanceMinor) ||
      checkpoint.source.trim().length === 0 ||
      (checkpoint.sourceReference !== undefined && checkpoint.sourceReference.trim().length === 0) ||
      Number.isNaN(Date.parse(checkpoint.recordedAtIso))
    ) {
      throw new Error("Account balance checkpoint is invalid.");
    }
    const account = db.prepare(
      "SELECT currency_code FROM accounts WHERE id = ?"
    ).get(checkpoint.accountId) as { currency_code: string } | undefined;
    if (account === undefined) {
      throw new Error(`Account not found: ${checkpoint.accountId}`);
    }
    if (checkpoint.currencyCode !== account.currency_code) {
      throw new Error("Account checkpoint currency must match the account currency.");
    }
    db.prepare(`
      INSERT INTO account_balance_checkpoints (
        id, account_id, date_iso, currency_code, balance_minor, source,
        source_reference, recorded_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

  function listAccountStatementCoveragePeriods(accountId: string): AccountStatementCoveragePeriod[] {
    return db.prepare(`
      SELECT id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
        source_type, import_job_id, imported_at_iso, confirmed, confirmed_at_iso
      FROM account_statement_coverage_periods
      WHERE account_id = ?
      ORDER BY start_date_iso, end_date_iso, id
    `).all(accountId).map((row) => {
      const period = row as {
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
    });
  }

  function listAccountBalanceCheckpoints(accountId: string): AccountBalanceCheckpoint[] {
    return db.prepare(`
      SELECT id, account_id, date_iso, currency_code, balance_minor, source,
        source_reference, recorded_at_iso
      FROM account_balance_checkpoints
      WHERE account_id = ?
      ORDER BY date_iso, recorded_at_iso, id
    `).all(accountId).map((row) => {
      const checkpoint = row as {
        id: string;
        account_id: string;
        date_iso: string;
        currency_code: string;
        balance_minor: number;
        source: string;
        source_reference: string | null;
        recorded_at_iso: string;
      };
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
    });
  }

  function upsertExchangeRate(rate: ExchangeRate): void {
    const validated = validateExchangeRate(rate);
    db.prepare(`
      INSERT INTO exchange_rates (
        id, currency_code, rate_nok_per_unit, effective_date, kind, source, provenance
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        currency_code = excluded.currency_code,
        rate_nok_per_unit = excluded.rate_nok_per_unit,
        effective_date = excluded.effective_date,
        kind = excluded.kind,
        source = excluded.source,
        provenance = excluded.provenance
    `).run(
      validated.id,
      validated.currencyCode,
      validated.rateNokPerUnit,
      validated.effectiveDate,
      validated.kind,
      validated.source,
      validated.provenance
    );
  }

  function upsertExchangeRates(rates: ExchangeRate[]): void {
    const validatedRates = rates.map(validateExchangeRate);
    const keys = new Set<string>();
    for (const rate of validatedRates) {
      const key = `${rate.currencyCode}/${rate.effectiveDate}/${rate.kind}`;
      if (keys.has(key)) {
        throw new Error(`Duplicate exchange rate for ${key}.`);
      }
      keys.add(key);
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const rate of validatedRates) upsertExchangeRate(rate);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listExchangeRates(currencyCode?: CurrencyCode): ExchangeRate[] {
    if (currencyCode !== undefined && !isCurrencyCode(currencyCode)) {
      throw new Error("Exchange rate currency code is invalid.");
    }
    const rows = currencyCode === undefined
      ? db.prepare(`
          SELECT id, currency_code, rate_nok_per_unit, effective_date, kind, source, provenance
          FROM exchange_rates
          ORDER BY currency_code, effective_date, kind, id
        `).all()
      : db.prepare(`
          SELECT id, currency_code, rate_nok_per_unit, effective_date, kind, source, provenance
          FROM exchange_rates
          WHERE currency_code = ?
          ORDER BY effective_date, kind, id
        `).all(currencyCode);
    return rows.map((row) => {
      const rate = row as {
        id: string;
        currency_code: string;
        rate_nok_per_unit: string;
        effective_date: string;
        kind: ExchangeRate["kind"];
        source: string;
        provenance: ExchangeRate["provenance"];
      };
      return {
        id: rate.id,
        currencyCode: rate.currency_code,
        rateNokPerUnit: rate.rate_nok_per_unit,
        effectiveDate: rate.effective_date,
        kind: rate.kind,
        source: rate.source,
        provenance: rate.provenance,
      };
    });
  }

  function createPropertyRecord(property: PropertyRecord): void {
    if (
      property.id.trim().length === 0 ||
      property.householdId.trim().length === 0 ||
      property.label.trim().length === 0 ||
      !property.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(property.createdAtIso))
    ) {
      throw new Error("Property record is invalid.");
    }
    if (
      db.prepare("SELECT 1 FROM households WHERE id = ?").get(property.householdId) === undefined
    ) {
      throw new Error(`Household not found for property: ${property.householdId}`);
    }
    db.prepare(
      "INSERT INTO properties (id, household_id, label, created_at_iso) VALUES (?, ?, ?, ?)"
    ).run(property.id, property.householdId, property.label, property.createdAtIso);
  }

  function updatePropertyRecordLabel(propertyId: string, label: string): void {
    if (propertyId.trim().length === 0 || label.trim().length === 0) {
      throw new Error("Property label update is invalid.");
    }
    const result = db.prepare("UPDATE properties SET label = ? WHERE id = ?")
      .run(label.trim(), propertyId);
    if (Number(result.changes) !== 1) {
      throw new Error(`Property not found: ${propertyId}`);
    }
  }

  function listPropertyRecords(householdId: string): PropertyRecord[] {
    return db.prepare(`
      SELECT id, household_id, label, created_at_iso
      FROM properties
      WHERE household_id = ?
      ORDER BY label COLLATE NOCASE, id
    `).all(householdId).map((row) => {
      const property = row as {
        id: string;
        household_id: string;
        label: string;
        created_at_iso: string;
      };
      return {
        id: property.id,
        householdId: property.household_id,
        label: property.label,
        createdAtIso: property.created_at_iso,
      };
    });
  }

  function appendPropertyValuationSnapshot(valuation: PropertyValuationSnapshot): void {
    const isIsoCalendarDate = (value: string): boolean =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
    const correction = valuation.correction === undefined
      ? undefined
      : validatePropertyValuationCorrectionMetadata(valuation.correction);
    if (
      valuation.id.trim().length === 0 ||
      valuation.propertyId.trim().length === 0 ||
      !isIsoCalendarDate(valuation.effectiveDateIso) ||
      !Number.isSafeInteger(valuation.amountMinor) ||
      valuation.amountMinor < 0 ||
      !isCurrencyCode(valuation.currencyCode) ||
      !valuation.recordedAtIso.includes("T") ||
      Number.isNaN(Date.parse(valuation.recordedAtIso))
    ) {
      throw new Error("Property valuation snapshot is invalid.");
    }
    if (
      db.prepare("SELECT 1 FROM properties WHERE id = ?").get(valuation.propertyId) === undefined
    ) {
      throw new Error(`Property not found for valuation: ${valuation.propertyId}`);
    }

    if (correction !== undefined) {
      const target = db.prepare(`
        SELECT id, effective_date_iso, amount_minor, currency_code, correction_json
        FROM property_valuation_snapshots
        WHERE id = ? AND property_id = ?
      `).get(correction.targetValuationId, valuation.propertyId) as {
        id: string;
        effective_date_iso: string;
        amount_minor: number;
        currency_code: string;
        correction_json: string | null;
      } | undefined;
      if (target === undefined) {
        throw new Error(`Property valuation not found: ${correction.targetValuationId}`);
      }

      const targetCorrection = target.correction_json === null
        ? undefined
        : validatePropertyValuationCorrectionMetadata(JSON.parse(target.correction_json) as unknown);
      if (targetCorrection?.action === "void") {
        throw new Error(`A void record cannot be corrected: ${correction.targetValuationId}`);
      }

      const existingCorrections = db.prepare(`
        SELECT correction_json
        FROM property_valuation_snapshots
        WHERE property_id = ? AND correction_json IS NOT NULL
      `).all(valuation.propertyId) as Array<{ correction_json: string }>;
      if (existingCorrections.some((row) =>
        validatePropertyValuationCorrectionMetadata(JSON.parse(row.correction_json) as unknown)
          .targetValuationId === correction.targetValuationId
      )) {
        throw new Error(`Property valuation has already been corrected: ${correction.targetValuationId}`);
      }
      if (
        correction.action === "void" &&
        (valuation.effectiveDateIso !== target.effective_date_iso ||
          valuation.amountMinor !== target.amount_minor ||
          valuation.currencyCode !== target.currency_code)
      ) {
        throw new Error("A void record must preserve the target valuation's original value.");
      }
    }

    db.prepare(`
      INSERT INTO property_valuation_snapshots (
        id, property_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso, correction_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      valuation.id,
      valuation.propertyId,
      valuation.effectiveDateIso,
      valuation.amountMinor,
      valuation.currencyCode,
      valuation.recordedAtIso,
      correction === undefined ? null : JSON.stringify(correction)
    );
  }

  function listPropertyValuationSnapshots(propertyId: string): PropertyValuationSnapshot[] {
    return db.prepare(`
      SELECT id, property_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso,
        correction_json
      FROM property_valuation_snapshots
      WHERE property_id = ?
      ORDER BY effective_date_iso, recorded_at_iso, id
    `).all(propertyId).map((row) => {
      const valuation = row as {
        id: string;
        property_id: string;
        effective_date_iso: string;
        amount_minor: number;
        currency_code: string;
        recorded_at_iso: string;
        correction_json: string | null;
      };
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
    });
  }

  function createHoldingRecord(holding: HoldingRecord): void {
    if (
      holding.id.trim().length === 0 ||
      holding.householdId.trim().length === 0 ||
      !holding.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(holding.createdAtIso))
    ) {
      throw new Error("Investment holding identity or creation timestamp is invalid.");
    }
    if (
      db.prepare("SELECT 1 FROM households WHERE id = ?").get(holding.householdId) === undefined
    ) {
      throw new Error(`Household not found for investment holding: ${holding.householdId}`);
    }

    const validated = validateHoldingRecordInput(holding);
    db.prepare(`
      INSERT INTO investment_holdings (
        id, household_id, label, quantity, cost_basis_minor, currency_code, created_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      holding.id,
      holding.householdId,
      validated.label,
      validated.quantity,
      validated.costBasisMinor,
      validated.currencyCode,
      holding.createdAtIso
    );
  }

  function listHoldingRecords(householdId: string): HoldingRecord[] {
    return db.prepare(`
      SELECT id, household_id, label, quantity, cost_basis_minor, currency_code, created_at_iso, revisions_json
      FROM investment_holdings
      WHERE household_id = ?
      ORDER BY label COLLATE NOCASE, id
    `).all(householdId).map((row) => {
      const holding = row as {
        id: string;
        household_id: string;
        label: string;
        quantity: number;
        cost_basis_minor: number;
        currency_code: string;
        created_at_iso: string;
        revisions_json: string | null;
      };
      const parsed: unknown = holding.revisions_json === null ? [] : JSON.parse(holding.revisions_json);
      if (!Array.isArray(parsed)) throw new Error("Investment holding revisions are invalid.");
      const revisions = parsed.map(validateHoldingRevision);
      if (new Set(revisions.map((revision) => revision.id)).size !== revisions.length) {
        throw new Error("Investment holding revision IDs must be unique.");
      }
      return {
        id: holding.id,
        householdId: holding.household_id,
        label: holding.label,
        quantity: holding.quantity,
        costBasisMinor: holding.cost_basis_minor,
        currencyCode: holding.currency_code,
        createdAtIso: holding.created_at_iso,
        ...(revisions.length === 0 ? {} : { revisions }),
      };
    });
  }

  function correctHoldingRecord(holding: HoldingRecord, revision: HoldingRecordRevision): void {
    const validated = validateHoldingRecordInput(holding);
    const previous = validateHoldingRevision(revision);
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = listHoldingRecords(holding.householdId).find((record) => record.id === holding.id);
      if (current === undefined || current.createdAtIso !== holding.createdAtIso ||
          current.label !== previous.label || current.quantity !== previous.quantity ||
          current.costBasisMinor !== previous.costBasisMinor ||
          current.currencyCode !== previous.currencyCode) {
        throw new Error("Investment holding changed before the correction could be saved.");
      }
      const revisions = [...(current.revisions ?? []), previous];
      if (new Set(revisions.map((item) => item.id)).size !== revisions.length) {
        throw new Error("Investment holding revision IDs must be unique.");
      }
      db.prepare(`
        UPDATE investment_holdings
        SET label = ?, quantity = ?, cost_basis_minor = ?, currency_code = ?, revisions_json = ?
        WHERE id = ? AND household_id = ?
      `).run(validated.label, validated.quantity, validated.costBasisMinor,
        validated.currencyCode, JSON.stringify(revisions), holding.id, holding.householdId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function appendHoldingValuationSnapshot(valuation: HoldingValuationSnapshot): void {
    if (
      valuation.id.trim().length === 0 ||
      !valuation.recordedAtIso.includes("T") ||
      Number.isNaN(Date.parse(valuation.recordedAtIso))
    ) {
      throw new Error("Investment holding valuation identity or recorded timestamp is invalid.");
    }
    const validated = validateHoldingValuationInput(valuation);
    if (
      db.prepare("SELECT 1 FROM investment_holdings WHERE id = ?")
        .get(validated.holdingId) === undefined
    ) {
      throw new Error(`Investment holding not found for valuation: ${validated.holdingId}`);
    }

    const correction = valuation.correction === undefined
      ? undefined
      : validateHoldingValuationCorrectionMetadata(valuation.correction);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (correction !== undefined) {
        const values = listHoldingValuationSnapshots(validated.holdingId);
        if (correction.targetValuationId === valuation.id ||
            !values.some((value) => value.id === correction.targetValuationId) ||
            values.some((value) => value.correction?.targetValuationId === correction.targetValuationId)) {
          throw new Error("Investment holding value is missing or has already been corrected.");
        }
      }
      db.prepare(`
        INSERT INTO holding_valuation_snapshots (
          id, holding_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso, correction_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        valuation.id,
        validated.holdingId,
        validated.effectiveDateIso,
        validated.amountMinor,
        validated.currencyCode,
        valuation.recordedAtIso,
        correction === undefined ? null : JSON.stringify(correction)
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listHoldingValuationSnapshots(holdingId: string): HoldingValuationSnapshot[] {
    return db.prepare(`
      SELECT id, holding_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso, correction_json
      FROM holding_valuation_snapshots
      WHERE holding_id = ?
      ORDER BY effective_date_iso, recorded_at_iso, id
    `).all(holdingId).map((row) => {
      const valuation = row as {
        id: string;
        holding_id: string;
        effective_date_iso: string;
        amount_minor: number;
        currency_code: string;
        recorded_at_iso: string;
        correction_json: string | null;
      };
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
    });
  }

  function createLoanRecord(loan: LoanRecord): void {
    if (
      loan.id.trim().length === 0 ||
      loan.householdId.trim().length === 0 ||
      !loan.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(loan.createdAtIso))
    ) {
      throw new Error("Loan record identity or creation timestamp is invalid.");
    }
    if (
      db.prepare("SELECT 1 FROM households WHERE id = ?").get(loan.householdId) === undefined
    ) {
      throw new Error(`Household not found for loan: ${loan.householdId}`);
    }

    const propertyIds = listPropertyRecords(loan.householdId).map((property) => property.id);
    const validated = validateLoanRecordInput(loan, propertyIds);
    db.prepare(`
      INSERT INTO loan_records (
        id, household_id, label, principal_minor, annual_interest_rate_basis_points,
        term_months, payment_amount_minor, payment_frequency, currency_code, property_id,
        created_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      loan.id,
      loan.householdId,
      validated.label,
      validated.principalMinor,
      validated.annualInterestRateBasisPoints,
      validated.termMonths,
      validated.paymentAmountMinor,
      validated.paymentFrequency,
      validated.currencyCode,
      validated.propertyId ?? null,
      loan.createdAtIso
    );
  }

  function listLoanRecords(householdId: string): LoanRecord[] {
    return db.prepare(`
      SELECT id, household_id, label, principal_minor, annual_interest_rate_basis_points,
        term_months, payment_amount_minor, payment_frequency, currency_code, property_id,
        created_at_iso
      FROM loan_records
      WHERE household_id = ?
      ORDER BY label COLLATE NOCASE, id
    `).all(householdId).map((row) => {
      const loan = row as {
        id: string;
        household_id: string;
        label: string;
        principal_minor: number;
        annual_interest_rate_basis_points: number;
        term_months: number;
        payment_amount_minor: number;
        payment_frequency: LoanRecord["paymentFrequency"];
        currency_code: string;
        property_id: string | null;
        created_at_iso: string;
      };
      return {
        id: loan.id,
        householdId: loan.household_id,
        label: loan.label,
        principalMinor: loan.principal_minor,
        annualInterestRateBasisPoints: loan.annual_interest_rate_basis_points,
        termMonths: loan.term_months,
        paymentAmountMinor: loan.payment_amount_minor,
        paymentFrequency: loan.payment_frequency,
        currencyCode: loan.currency_code,
        ...(loan.property_id === null ? {} : { propertyId: loan.property_id }),
        createdAtIso: loan.created_at_iso,
      };
    });
  }

  function appendLoanBalanceSnapshot(balance: LoanBalanceSnapshot): void {
    if (
      balance.id.trim().length === 0 ||
      !balance.recordedAtIso.includes("T") ||
      Number.isNaN(Date.parse(balance.recordedAtIso))
    ) {
      throw new Error("Loan balance snapshot identity or recorded timestamp is invalid.");
    }
    const loan = db.prepare(`
      SELECT currency_code
      FROM loan_records
      WHERE id = ?
    `).get(balance.loanId) as { currency_code: string } | undefined;
    if (loan === undefined) {
      throw new Error(`Loan not found for balance snapshot: ${balance.loanId}`);
    }
    const validated = validateLoanBalanceInput(balance);
    if (balance.currencyCode !== loan.currency_code) {
      throw new Error("Loan balance currency must match the loan's original currency.");
    }

    db.prepare(`
      INSERT INTO loan_balance_snapshots (
        id, loan_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      balance.id,
      validated.loanId,
      validated.effectiveDateIso,
      validated.amountMinor,
      balance.currencyCode,
      balance.recordedAtIso
    );
  }

  function listLoanBalanceSnapshots(loanId: string): LoanBalanceSnapshot[] {
    return db.prepare(`
      SELECT id, loan_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso
      FROM loan_balance_snapshots
      WHERE loan_id = ?
      ORDER BY effective_date_iso, recorded_at_iso, id
    `).all(loanId).map((row) => {
      const balance = row as {
        id: string;
        loan_id: string;
        effective_date_iso: string;
        amount_minor: number;
        currency_code: string;
        recorded_at_iso: string;
      };
      return {
        id: balance.id,
        loanId: balance.loan_id,
        effectiveDateIso: balance.effective_date_iso,
        amountMinor: balance.amount_minor,
        currencyCode: balance.currency_code,
        recordedAtIso: balance.recorded_at_iso,
      };
    });
  }

  function backfillImportJobHistory(): void {
    const legacyJobs = db.prepare(`
      SELECT job.id, job.household_id, job.source_type, job.source_name, job.adapter_id,
        job.candidate_count, job.validation_failure_count, job.started_at_iso,
        job.finished_at_iso, job.provenance_json
      FROM import_jobs AS job
      LEFT JOIN import_job_operations AS operation ON operation.import_job_id = job.id
      WHERE operation.import_job_id IS NULL
    `).all() as Array<{
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

    db.exec("BEGIN");
    try {
      for (const job of legacyJobs) {
        const transactions = db.prepare(`
          SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
            currency_code, source_type, source_reference, category_id, import_job_id,
            category_allocations_json
          FROM transactions
          WHERE import_job_id = ?
        `).all(job.id) as unknown as TransactionRow[];
        const importJob: ImportJob = {
          id: job.id,
          householdId: job.household_id,
          sourceType: parseSourceType(job.source_type),
          sourceName: job.source_name,
          startedAtIso: job.started_at_iso,
          ...(job.adapter_id === null ? {} : { adapterId: job.adapter_id }),
          ...(job.candidate_count === null ? {} : { candidateCount: job.candidate_count }),
          ...(job.validation_failure_count === null
            ? {}
            : { validationFailureCount: job.validation_failure_count }),
          ...(job.finished_at_iso === null ? {} : { finishedAtIso: job.finished_at_iso }),
          ...(job.provenance_json === null
            ? {}
            : { provenance: JSON.parse(job.provenance_json) as ImportJobProvenance }),
        };
        persistImportJobOperation(db, importJob, transactions.map(mapTransactionRow));
        db.prepare("UPDATE import_job_operations SET undo_available = 0 WHERE import_job_id = ?")
          .run(job.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  backfillImportJobHistory();

  function loadLedgerSnapshotData(): LedgerSnapshotData {
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
    `).all().map((row) => {
      const period = row as {
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
    });

    const accountBalanceCheckpoints = db.prepare(`
      SELECT id, account_id, date_iso, currency_code, balance_minor, source,
        source_reference, recorded_at_iso
      FROM account_balance_checkpoints
      ORDER BY account_id, date_iso, recorded_at_iso, id
    `).all().map((row) => {
      const checkpoint = row as {
        id: string;
        account_id: string;
        date_iso: string;
        currency_code: string;
        balance_minor: number;
        source: string;
        source_reference: string | null;
        recorded_at_iso: string;
      };
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
    });
    const exchangeRates = listExchangeRates();
    const properties = db.prepare(`
      SELECT id, household_id, label, created_at_iso
      FROM properties
      ORDER BY id
    `).all().map((row) => {
      const property = row as {
        id: string;
        household_id: string;
        label: string;
        created_at_iso: string;
      };
      return {
        id: property.id,
        householdId: property.household_id,
        label: property.label,
        createdAtIso: property.created_at_iso,
      };
    });
    const propertyValuations = db.prepare(`
      SELECT id, property_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso,
        correction_json
      FROM property_valuation_snapshots
      ORDER BY property_id, effective_date_iso, recorded_at_iso, id
    `).all().map((row) => {
      const valuation = row as {
        id: string;
        property_id: string;
        effective_date_iso: string;
        amount_minor: number;
        currency_code: string;
        recorded_at_iso: string;
        correction_json: string | null;
      };
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
    });
    const holdings = listHoldingRecords(householdRow.id);
    const holdingValuations = db.prepare(`
      SELECT id, holding_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso, correction_json
      FROM holding_valuation_snapshots
      ORDER BY holding_id, effective_date_iso, recorded_at_iso, id
    `).all().map((row) => {
      const valuation = row as {
        id: string;
        holding_id: string;
        effective_date_iso: string;
        amount_minor: number;
        currency_code: string;
        recorded_at_iso: string;
        correction_json: string | null;
      };
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
    });
    const loanRecords = listLoanRecords(householdRow.id);
    const loanBalanceSnapshots = db.prepare(`
      SELECT id, loan_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso
      FROM loan_balance_snapshots
      ORDER BY loan_id, effective_date_iso, recorded_at_iso, id
    `).all().map((row) => {
      const balance = row as {
        id: string;
        loan_id: string;
        effective_date_iso: string;
        amount_minor: number;
        currency_code: string;
        recorded_at_iso: string;
      };
      return {
        id: balance.id,
        loanId: balance.loan_id,
        effectiveDateIso: balance.effective_date_iso,
        amountMinor: balance.amount_minor,
        currencyCode: balance.currency_code,
        recordedAtIso: balance.recorded_at_iso,
      };
    });

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
    };
  }

  function replaceLedgerSnapshotData(snapshot: LedgerSnapshotData): void {
    db.exec("BEGIN");
    try {
      db.exec(`
        DELETE FROM import_job_transaction_baselines;
        DELETE FROM import_job_operations;
        DELETE FROM same_merchant_propagation_changes;
        DELETE FROM same_merchant_propagation_operations;
        DELETE FROM merchant_correction_provenance;
        DELETE FROM exchange_rates;
        DELETE FROM account_balance_checkpoints;
        DELETE FROM account_statement_coverage_periods;
        DELETE FROM monthly_category_targets;
        DELETE FROM pending_transaction_observations;
        DELETE FROM transactions;
        DELETE FROM import_jobs;
        DELETE FROM merchant_category_rules;
        DELETE FROM loan_balance_snapshots;
        DELETE FROM loan_records;
        DELETE FROM holding_valuation_snapshots;
        DELETE FROM investment_holdings;
        DELETE FROM property_valuation_snapshots;
        DELETE FROM properties;
        DELETE FROM accounts;
        DELETE FROM households;
      `);
      insertLedgerSnapshot(db, snapshot);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function upsertMonthlyCategoryTarget(target: MonthlyCategoryTarget): void {
    db.prepare(
      "INSERT INTO monthly_category_targets (year_month, category_id, target_minor) VALUES (?, ?, ?) ON CONFLICT(year_month, category_id) DO UPDATE SET target_minor = excluded.target_minor"
    ).run(target.yearMonth, target.categoryId, target.targetMinor);
  }

  function saveLedgerView(savedLedgerView: SavedLedgerView): void {
    db.prepare(
      "INSERT INTO saved_ledger_views (id, name, filters_json) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET id = excluded.id, filters_json = excluded.filters_json"
    ).run(savedLedgerView.id, savedLedgerView.name, JSON.stringify(savedLedgerView.filters));
  }

  function listSavedLedgerViews(): SavedLedgerView[] {
    return db
      .prepare("SELECT id, name, filters_json FROM saved_ledger_views ORDER BY name COLLATE NOCASE")
      .all()
      .map((row) => {
        const savedView = row as { id: string; name: string; filters_json: string };
        return {
          id: savedView.id,
          name: savedView.name,
          filters: JSON.parse(savedView.filters_json) as SavedLedgerView["filters"],
        };
      });
  }

  function deleteSavedLedgerView(viewId: string): boolean {
    const result = db
      .prepare("DELETE FROM saved_ledger_views WHERE id = ?")
      .run(viewId) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }

  function saveBackupSnapshot(entry: BackupSnapshotCatalogEntry): void {
    db.prepare(`
      INSERT INTO backup_snapshots (
        snapshot_path, kind, version, household_name, created_at_iso, saved_at_iso,
        account_count, transaction_count, content_hash_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_path) DO UPDATE SET
        kind = excluded.kind,
        version = excluded.version,
        household_name = excluded.household_name,
        created_at_iso = excluded.created_at_iso,
        saved_at_iso = excluded.saved_at_iso,
        account_count = excluded.account_count,
        transaction_count = excluded.transaction_count,
        content_hash_sha256 = excluded.content_hash_sha256
    `).run(
      entry.snapshotPath,
      entry.kind,
      entry.version,
      entry.householdName,
      entry.createdAtIso,
      entry.savedAtIso,
      entry.accountCount,
      entry.transactionCount,
      entry.contentHashSha256
    );
  }

  function listBackupSnapshots(): BackupSnapshotCatalogEntry[] {
    return db.prepare(`
      SELECT snapshot_path, kind, version, household_name, created_at_iso, saved_at_iso,
        account_count, transaction_count, content_hash_sha256
      FROM backup_snapshots
      ORDER BY saved_at_iso DESC, snapshot_path ASC
    `).all().map((row) => {
      const snapshot = row as {
        snapshot_path: string;
        kind: BackupSnapshotCatalogEntry["kind"];
        version: BackupSnapshotCatalogEntry["version"];
        household_name: string;
        created_at_iso: string;
        saved_at_iso: string;
        account_count: number;
        transaction_count: number;
        content_hash_sha256: string;
      };
      return {
        snapshotPath: snapshot.snapshot_path,
        kind: snapshot.kind,
        version: snapshot.version,
        householdName: snapshot.household_name,
        createdAtIso: snapshot.created_at_iso,
        savedAtIso: snapshot.saved_at_iso,
        accountCount: snapshot.account_count,
        transactionCount: snapshot.transaction_count,
        contentHashSha256: snapshot.content_hash_sha256,
      };
    });
  }

  function deleteBackupSnapshot(snapshotPath: string): boolean {
    const result = db.prepare(
      "DELETE FROM backup_snapshots WHERE snapshot_path = ?"
    ).run(snapshotPath) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }

  function saveCsvImportProfile(profile: CsvImportProfile): void {
    const accountExists = db.prepare(
      "SELECT 1 FROM accounts WHERE id = ? AND household_id = ?"
    ).get(profile.accountId, profile.householdId);
    if (accountExists === undefined) {
      throw new Error("CSV import profile account must belong to its household.");
    }

    db.prepare(`
      INSERT INTO csv_import_profiles (
        id, household_id, name, account_id, column_mapping_json, created_at_iso, updated_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        household_id = excluded.household_id,
        name = excluded.name,
        account_id = excluded.account_id,
        column_mapping_json = excluded.column_mapping_json,
        updated_at_iso = excluded.updated_at_iso
    `).run(
      profile.id,
      profile.householdId,
      profile.name,
      profile.accountId,
      JSON.stringify(profile.columnMapping),
      profile.createdAtIso,
      profile.updatedAtIso
    );
  }

  function listCsvImportProfiles(householdId: string): CsvImportProfile[] {
    return db.prepare(`
      SELECT id, household_id, name, account_id, column_mapping_json, created_at_iso, updated_at_iso
      FROM csv_import_profiles
      WHERE household_id = ?
      ORDER BY name COLLATE NOCASE
    `).all(householdId).map((row) => {
      const profile = row as {
        id: string;
        household_id: string;
        name: string;
        account_id: string;
        column_mapping_json: string;
        created_at_iso: string;
        updated_at_iso: string;
      };
      return {
        id: profile.id,
        householdId: profile.household_id,
        name: profile.name,
        accountId: profile.account_id,
        columnMapping: JSON.parse(profile.column_mapping_json) as CsvImportProfile["columnMapping"],
        createdAtIso: profile.created_at_iso,
        updatedAtIso: profile.updated_at_iso,
      };
    });
  }

  function deleteCsvImportProfile(householdId: string, profileId: string): boolean {
    const result = db.prepare(
      "DELETE FROM csv_import_profiles WHERE household_id = ? AND id = ?"
    ).run(householdId, profileId) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }

  function queryTransactions(householdId: string, query: TransactionQuery): TransactionPage {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_TRANSACTION_PAGE_SIZE;
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new RangeError("page must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_TRANSACTION_PAGE_SIZE) {
      throw new RangeError(`pageSize must be an integer between 1 and ${MAX_TRANSACTION_PAGE_SIZE}.`);
    }

    const predicates = ["t.household_id = ?"];
    const parameters: Array<string | number> = [householdId];
    const dateBounds = resolveTransactionDateBounds(query);
    if (query.accountId !== undefined) {
      predicates.push("t.account_id = ?");
      parameters.push(query.accountId);
    }
    if (dateBounds.bookedFromIso !== undefined) {
      const bookedFrom = dateBounds.bookedFromIso;
      predicates.push("t.booked_at_iso >= ?");
      parameters.push(/^\d{4}-\d{2}-\d{2}$/.test(bookedFrom) ? `${bookedFrom}T00:00:00.000Z` : bookedFrom);
    }
    if (dateBounds.bookedToIso !== undefined) {
      const bookedTo = dateBounds.bookedToIso;
      if (/^\d{4}-\d{2}-\d{2}$/.test(bookedTo)) {
        const nextDay = new Date(`${bookedTo}T00:00:00.000Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        predicates.push("t.booked_at_iso < ?");
        parameters.push(nextDay.toISOString());
      } else {
        predicates.push("t.booked_at_iso <= ?");
        parameters.push(bookedTo);
      }
    }
    if (query.amountMinor !== undefined) {
      predicates.push("t.amount_minor = ?");
      parameters.push(query.amountMinor);
    }
    if (query.amountFromMinor !== undefined) {
      predicates.push("t.amount_minor >= ?");
      parameters.push(query.amountFromMinor);
    }
    if (query.amountToMinor !== undefined) {
      predicates.push("t.amount_minor <= ?");
      parameters.push(query.amountToMinor);
    }
    if (query.categoryId !== undefined) {
      predicates.push(`(
        t.category_id = ? OR EXISTS (
          SELECT 1
          FROM json_each(t.category_allocations_json) AS allocation
          WHERE json_extract(allocation.value, '$.categoryId') = ?
        )
      )`);
      parameters.push(query.categoryId, query.categoryId);
    }
    if (query.uncategorizedOnly) {
      predicates.push(
        "t.category_id IS NULL AND NOT EXISTS (SELECT 1 FROM json_each(t.category_allocations_json))"
      );
    }
    if (query.transactionType === "income") predicates.push("t.amount_minor > 0");
    if (query.transactionType === "expenses") predicates.push("t.amount_minor < 0");
    if (query.largeTransactionsOnly) {
      predicates.push("ABS(t.amount_minor) >= ?");
      parameters.push(LARGE_TRANSACTION_THRESHOLD_MINOR);
    }
    if (query.merchant?.trim()) {
      predicates.push("t.merchant_search LIKE ? ESCAPE '\\'");
      parameters.push(`%${query.merchant.trim().toUpperCase().replace(/[\\%_]/g, "\\$&")}%`);
    }

    const whereClause = predicates.join(" AND ");
    const fromClause = "FROM transactions AS t LEFT JOIN accounts AS a ON a.id = t.account_id";
    const countRow = db.prepare(
      `SELECT COUNT(*) AS total_count ${fromClause} WHERE ${whereClause}`
    ).get(...parameters) as { total_count: number };

    const sortBy = query.sortBy ?? "bookedAtIso";
    const sortDirection: TransactionSortDirection = query.sortDirection ?? "desc";
    const orderParameters = sortBy === "categoryId" ? categorySortParameters : [];
    const transactionRows = db.prepare(`
      SELECT t.id, t.household_id, t.account_id, t.booked_at_iso, t.amount_minor,
        t.merchant_raw, t.currency_code, t.source_type, t.source_reference,
        t.category_id, t.import_job_id, t.category_allocations_json
      ${fromClause}
      WHERE ${whereClause}
      ORDER BY ${transactionSortColumns[sortBy]} ${sortDirection.toUpperCase()}, t.id ASC
      LIMIT ? OFFSET ?
    `).all(...parameters, ...orderParameters, pageSize, (page - 1) * pageSize) as unknown as TransactionRow[];

    return {
      transactions: transactionRows.map(mapTransactionRow),
      totalCount: countRow.total_count,
      page,
      pageSize,
    };
  }

  function listUncategorizedTransactions(householdId: string): Transaction[] {
    const transactions = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id,
        category_allocations_json
      FROM transactions
      WHERE household_id = ? AND category_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM json_each(category_allocations_json))
      ORDER BY substr(booked_at_iso, 1, 10) ASC, id ASC
    `).all(householdId) as unknown as TransactionRow[];
    return transactions.map(mapTransactionRow);
  }

  function getAccountsForHousehold(householdId: string): Account[] {
    const accounts = db
      .prepare(
        "SELECT id, household_id, name, currency_code FROM accounts WHERE household_id = ? ORDER BY id"
      )
      .all(householdId) as Array<{
      id: string;
      household_id: string;
      name: string;
      currency_code: string;
    }>;

    return accounts.map((account) => ({
      id: account.id,
      householdId: account.household_id,
      name: account.name,
      currencyCode: account.currency_code,
    }));
  }

  function appendImportJob(importJob: ImportJob): void {
    db.exec("BEGIN");
    try {
      db.prepare(
      "INSERT OR IGNORE INTO import_jobs (id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
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
      persistImportJobOperation(db, importJob, []);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function retainedImportTransactions(importJobId: string): UndoImportJobResult["retainedTransactions"] {
    const transactions = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id,
        category_allocations_json
      FROM transactions
      WHERE import_job_id = ?
      ORDER BY booked_at_iso, id
    `).all(importJobId) as unknown as TransactionRow[];
    const baselines = new Map(db.prepare(`
      SELECT transaction_id
      FROM import_job_transaction_baselines
      WHERE import_job_id = ?
    `).all(importJobId).map((row) => {
      const baseline = row as { transaction_id: string };
      return [baseline.transaction_id, true] as const;
    }));

    return transactions.map((row) => {
      const transaction = mapTransactionRow(row);
      return {
        id: transaction.id,
        bookedAtIso: transaction.bookedAtIso,
        amountMinor: transaction.amountMinor,
        merchantRaw: transaction.merchantRaw,
        currencyCode: transaction.currencyCode ?? "NOK",
        reason: baselines.has(transaction.id) ? "changed-after-import" : "baseline-unavailable",
      };
    });
  }

  function listImportJobHistory(householdId: string): ImportJobHistoryEntry[] {
    return db.prepare(`
      SELECT job.id, job.household_id, job.source_type, job.source_name, job.adapter_id,
        job.started_at_iso, job.finished_at_iso,
        operation.account_id,
        COALESCE(operation.candidate_count, job.candidate_count, 0) AS candidate_count,
        COALESCE(operation.imported_count, 0) AS imported_count,
        COALESCE(operation.duplicate_count, 0) AS duplicate_count,
        operation.undone_at_iso,
        COALESCE(operation.undo_removed_count, 0) AS undo_removed_count,
        COALESCE(operation.undo_retained_count, 0) AS undo_retained_count,
        CASE WHEN operation.undo_available = 1 AND operation.undone_at_iso IS NULL THEN 1 ELSE 0 END AS undo_available
      FROM import_jobs AS job
      LEFT JOIN import_job_operations AS operation ON operation.import_job_id = job.id
      WHERE job.household_id = ?
      ORDER BY job.started_at_iso DESC, job.id DESC
    `).all(householdId).map((row) => {
      const history = row as {
        id: string;
        household_id: string;
        source_type: string;
        source_name: string;
        adapter_id: string | null;
        account_id: string | null;
        candidate_count: number;
        imported_count: number;
        duplicate_count: number;
        started_at_iso: string;
        finished_at_iso: string | null;
        undone_at_iso: string | null;
        undo_removed_count: number;
        undo_retained_count: number;
        undo_available: number;
      };
      return {
        id: history.id,
        householdId: history.household_id,
        sourceType: parseSourceType(history.source_type),
        sourceName: history.source_name,
        adapterId: history.adapter_id,
        accountId: history.account_id,
        candidateCount: history.candidate_count,
        importedCount: history.imported_count,
        duplicateCount: history.duplicate_count,
        undoAvailable: history.undo_available === 1,
        startedAtIso: history.started_at_iso,
        finishedAtIso: history.finished_at_iso,
        undoneAtIso: history.undone_at_iso,
        undoRemovedCount: history.undo_removed_count,
        undoRetainedCount: history.undo_retained_count,
        retainedTransactions: history.undone_at_iso === null || history.undo_retained_count === 0
          ? []
          : retainedImportTransactions(history.id),
      } satisfies ImportJobHistoryEntry;
    });
  }

  function undoImportJob(importJobId: string): UndoImportJobResult {
    const operation = db.prepare(`
      SELECT imported_count, undone_at_iso, undo_removed_count, undo_retained_count, undo_available
      FROM import_job_operations
      WHERE import_job_id = ?
    `).get(importJobId) as {
      imported_count: number;
      undone_at_iso: string | null;
      undo_removed_count: number;
      undo_retained_count: number;
      undo_available: number;
    } | undefined;
    if (operation === undefined) throw new Error(`Import job not found: ${importJobId}`);
    if (operation.undone_at_iso !== null) {
      return {
        importJobId,
        removedCount: operation.undo_removed_count,
        retainedCount: operation.undo_retained_count,
        alreadyUndone: true,
        retainedTransactions: retainedImportTransactions(importJobId),
      };
    }

    const transactions = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id,
        category_allocations_json
      FROM transactions
      WHERE import_job_id = ?
      ORDER BY id
    `).all(importJobId) as unknown as TransactionRow[];
    const pendingObservations = db.prepare(`
      SELECT id, reconciled_transaction_id
      FROM pending_transaction_observations
      WHERE import_job_id = ?
      ORDER BY id
    `).all(importJobId) as Array<{ id: string; reconciled_transaction_id: string | null }>;
    const baselines = new Map(db.prepare(`
      SELECT transaction_id, baseline_json
      FROM import_job_transaction_baselines
      WHERE import_job_id = ?
    `).all(importJobId).map((row) => {
      const baseline = row as { transaction_id: string; baseline_json: string };
      return [baseline.transaction_id, baseline.baseline_json] as const;
    }));

    let removedCount = 0;
    let retainedCount = 0;
    const retainedTransactions: UndoImportJobResult["retainedTransactions"] = [];
    const undoneAtIso = new Date().toISOString();
    db.exec("BEGIN");
    try {
      if (operation.undo_available === 1) {
        const deleteTransaction = db.prepare(
          "DELETE FROM transactions WHERE id = ? AND import_job_id = ?"
        );
        const restorePendingObservation = db.prepare(`
          UPDATE pending_transaction_observations
          SET reconciled_transaction_id = NULL, reconciled_at_iso = NULL
          WHERE reconciled_transaction_id = ?
        `);
        for (const row of transactions) {
          const transaction = mapTransactionRow(row);
          const baselineJson = baselines.get(transaction.id);
          if (baselineJson !== undefined && serializeTransactionForUndo(transaction) === baselineJson) {
            const result = deleteTransaction.run(transaction.id, importJobId) as { changes: number | bigint };
            const removedTransactionCount = Number(result.changes);
            removedCount += removedTransactionCount;
            if (removedTransactionCount > 0) {
              restorePendingObservation.run(transaction.id);
            }
          } else {
            retainedCount += 1;
            retainedTransactions.push({
              id: transaction.id,
              bookedAtIso: transaction.bookedAtIso,
              amountMinor: transaction.amountMinor,
              merchantRaw: transaction.merchantRaw,
              currencyCode: transaction.currencyCode ?? "NOK",
              reason: baselineJson === undefined ? "baseline-unavailable" : "changed-after-import",
            });
          }
        }
        const undoPendingObservation = db.prepare(`
          DELETE FROM pending_transaction_observations
          WHERE id = ? AND reconciled_transaction_id IS NULL
        `);
        for (const observation of pendingObservations) {
          if (observation.reconciled_transaction_id !== null) {
            retainedCount += 1;
            continue;
          }
          const result = undoPendingObservation.run(observation.id) as {
            changes: number | bigint;
          };
          removedCount += Number(result.changes);
        }
      } else {
        retainedCount = transactions.length + pendingObservations.length;
        for (const row of transactions) {
          const transaction = mapTransactionRow(row);
          retainedTransactions.push({
            id: transaction.id,
            bookedAtIso: transaction.bookedAtIso,
            amountMinor: transaction.amountMinor,
            merchantRaw: transaction.merchantRaw,
            currencyCode: transaction.currencyCode ?? "NOK",
            reason: baselines.has(transaction.id) ? "changed-after-import" : "baseline-unavailable",
          });
        }
      }

      db.prepare(`
        UPDATE import_job_operations
        SET undone_at_iso = ?, undo_removed_count = ?, undo_retained_count = ?, undo_available = 0
        WHERE import_job_id = ?
      `).run(undoneAtIso, removedCount, retainedCount, importJobId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return { importJobId, removedCount, retainedCount, alreadyUndone: false, retainedTransactions };
  }

  function hasImportJob(importJobId: string): boolean {
    return db.prepare("SELECT 1 FROM import_jobs WHERE id = ?").get(importJobId) !== undefined;
  }

  function getTransactionsForImportJob(importJobId: string): Transaction[] {
    return loadLedgerSnapshotData().transactions.filter((transaction) => transaction.importJobId === importJobId);
  }

  function listImportReviewItems(householdId: string): ImportReviewItem[] {
    return (
      db.prepare(`
        SELECT id, import_job_id, household_id, account_id, source_type, source_name, source_identity,
          source_row_index, source_evidence_json, raw_row, parser_errors_json, status, created_at_iso, updated_at_iso,
          corrected_at_iso, corrected_transaction_id, correction_json, dismissal_reason, dismissed_at_iso
        FROM import_review_items
        WHERE household_id = ?
        ORDER BY created_at_iso, id
      `).all(householdId)
    ).map(mapImportReviewItemRow);
  }

  function getImportReviewItemById(reviewItemId: string): ImportReviewItem | undefined {
    const row = db.prepare(`
      SELECT id, import_job_id, household_id, account_id, source_type, source_name, source_identity,
        source_row_index, source_evidence_json, raw_row, parser_errors_json, status, created_at_iso, updated_at_iso,
        corrected_at_iso, corrected_transaction_id, correction_json, dismissal_reason, dismissed_at_iso
      FROM import_review_items
      WHERE id = ?
    `).get(reviewItemId);
    return row === undefined ? undefined : mapImportReviewItemRow(row);
  }

  function completeImportReviewCorrection(
    reviewItemId: string,
    transaction: Transaction,
    correctionJson: string,
    correctedAtIso: string
  ): { item: ImportReviewItem; transaction: Transaction } {
    db.exec("BEGIN");
    try {
      const reviewItem = getImportReviewItemById(reviewItemId);
      if (reviewItem === undefined) {
        throw new Error(`Import review item not found: ${reviewItemId}`);
      }
      if (
        reviewItem.importJobId !== transaction.importJobId ||
        reviewItem.householdId !== transaction.householdId ||
        reviewItem.sourceType !== transaction.sourceType
      ) {
        throw new Error("Corrected transaction provenance does not match the import review item.");
      }
      if (reviewItem.status === "corrected") {
        if (reviewItem.correctionJson !== correctionJson || reviewItem.correctedTransactionId === undefined) {
          throw new Error(`Import review item has already been corrected: ${reviewItemId}`);
        }
        const existingTransaction = getTransactionById(reviewItem.correctedTransactionId);
        if (existingTransaction === undefined) {
          throw new Error(`Corrected transaction is missing: ${reviewItem.correctedTransactionId}`);
        }
        db.exec("COMMIT");
        return { item: reviewItem, transaction: existingTransaction };
      }
      if (reviewItem.status !== "unresolved") {
        throw new Error(`Import review item is already resolved: ${reviewItemId}`);
      }

      const result = db.prepare(`
        INSERT OR IGNORE INTO transactions (
          id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search,
          currency_code, source_type, source_reference, category_id, import_job_id, categorization_json,
          category_allocations_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transaction.id,
        transaction.householdId,
        transaction.accountId,
        transaction.bookedAtIso,
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
      ) as { changes: number | bigint };
      if (Number(result.changes) !== 1) {
        throw new Error(`Corrected transaction already exists: ${transaction.id}`);
      }

      const updateResult = db.prepare(`
        UPDATE import_review_items
        SET status = 'corrected', updated_at_iso = ?, corrected_at_iso = ?,
          corrected_transaction_id = ?, correction_json = ?
        WHERE id = ? AND status = 'unresolved'
      `).run(correctedAtIso, correctedAtIso, transaction.id, correctionJson, reviewItemId) as { changes: number | bigint };
      if (Number(updateResult.changes) !== 1) {
        throw new Error(`Import review item changed while correcting: ${reviewItemId}`);
      }

      const operationResult = db.prepare(`
        UPDATE import_job_operations
        SET candidate_count = candidate_count + 1, imported_count = imported_count + 1
        WHERE import_job_id = ?
      `).run(reviewItem.importJobId) as { changes: number | bigint };
      if (Number(operationResult.changes) !== 1) {
        throw new Error(`Import job history not found for review item: ${reviewItemId}`);
      }
      persistTransactionBaseline(db, reviewItem.importJobId, transaction);

      const updatedItem = getImportReviewItemById(reviewItemId);
      const savedTransaction = getTransactionById(transaction.id);
      if (updatedItem === undefined || savedTransaction === undefined) {
        throw new Error(`Corrected import review item could not be reloaded: ${reviewItemId}`);
      }

      db.exec("COMMIT");
      return { item: updatedItem, transaction: savedTransaction };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function completeImportReviewDismissal(
    reviewItemId: string,
    reason: string,
    dismissedAtIso: string
  ): ImportReviewItem {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new Error("A dismissal reason is required.");

    db.exec("BEGIN");
    try {
      const reviewItem = getImportReviewItemById(reviewItemId);
      if (reviewItem === undefined) {
        throw new Error(`Import review item not found: ${reviewItemId}`);
      }
      if (reviewItem.status === "dismissed") {
        if (reviewItem.dismissalReason !== normalizedReason) {
          throw new Error(`Import review item has already been dismissed: ${reviewItemId}`);
        }
        db.exec("COMMIT");
        return reviewItem;
      }
      if (reviewItem.status !== "unresolved") {
        throw new Error(`Import review item is already resolved: ${reviewItemId}`);
      }

      const result = db.prepare(`
        UPDATE import_review_items
        SET status = 'dismissed', updated_at_iso = ?, dismissal_reason = ?, dismissed_at_iso = ?
        WHERE id = ? AND status = 'unresolved'
      `).run(dismissedAtIso, normalizedReason, dismissedAtIso, reviewItemId) as { changes: number | bigint };
      if (Number(result.changes) !== 1) {
        throw new Error(`Import review item changed while dismissing: ${reviewItemId}`);
      }

      const updatedItem = getImportReviewItemById(reviewItemId);
      if (updatedItem === undefined) {
        throw new Error(`Dismissed import review item could not be reloaded: ${reviewItemId}`);
      }

      db.exec("COMMIT");
      return updatedItem;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function getImportedTransactionsForSource(
    sourceType: ImportJob["sourceType"],
    sourceName: string,
    accountId: string,
    sourceIdentity?: string
  ): Transaction[] {
    const snapshot = loadLedgerSnapshotData();
    const canonicalSourcePath = (path: string): string => {
      const resolvedPath = resolve(path);
      return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
    };
    const directSourceJobs = snapshot.importJobs.filter(
      (job) => job.sourceType === sourceType && canonicalSourcePath(job.sourceName) === canonicalSourcePath(sourceName)
    );
    const knownContentDigests = new Set([
      ...directSourceJobs.map((job) => job.provenance?.contentDigest),
      sourceIdentity,
    ].filter((digest): digest is string => digest !== undefined));
    const sourceJobIds = new Set(snapshot.importJobs
      .filter((job) => job.sourceType === sourceType &&
        (job.id === sourceIdentity ||
          knownContentDigests.has(job.id) ||
          canonicalSourcePath(job.sourceName) === canonicalSourcePath(sourceName) ||
          (job.provenance?.contentDigest !== undefined && knownContentDigests.has(job.provenance.contentDigest)) ||
          (sourceType === "csv" && job.provenance?.sourceIdentity !== undefined && knownContentDigests.has(job.provenance.sourceIdentity))))
      .map((job) => job.id));
    return snapshot.transactions.filter((transaction) =>
      transaction.accountId === accountId &&
      transaction.importJobId !== undefined &&
      sourceJobIds.has(transaction.importJobId)
    );
  }

  function appendTransactions(transactions: Transaction[]): number {
    const insertTransaction = db.prepare(
  "INSERT OR IGNORE INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json, category_allocations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    let insertedCount = 0;
    const insertedTransactions: Transaction[] = [];
    db.exec("BEGIN");
    try {
      for (const transaction of transactions) {
        const result = insertTransaction.run(
          transaction.id,
          transaction.householdId,
          transaction.accountId,
          transaction.bookedAtIso,
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
        ) as { changes: number | bigint };
        if (Number(result.changes) > 0) {
          insertedCount += Number(result.changes);
          insertedTransactions.push(transaction);
        }
      }
      for (const transaction of insertedTransactions) {
        if (transaction.importJobId === undefined) continue;
        const operation = db.prepare(
          "SELECT 1 FROM import_job_operations WHERE import_job_id = ?"
        ).get(transaction.importJobId);
        if (operation === undefined) continue;
        persistTransactionBaseline(db, transaction.importJobId, transaction);
        db.prepare(`
          UPDATE import_job_operations
          SET imported_count = imported_count + 1,
            candidate_count = MAX(candidate_count, imported_count + 1)
          WHERE import_job_id = ?
        `).run(transaction.importJobId);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return insertedCount;
  }

  function appendImportJobAndTransactions(
    importJob: ImportJob,
    transactions: Transaction[],
    reviewItems: ImportReviewItem[] = [],
    pendingObservations: PendingTransactionObservation[] = []
  ): number {
    const insertImportJob = db.prepare(
      "INSERT OR IGNORE INTO import_jobs (id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertTransaction = db.prepare(
  "INSERT OR IGNORE INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json, category_allocations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertReviewItem = db.prepare(`
      INSERT OR IGNORE INTO import_review_items (
        id, import_job_id, household_id, account_id, source_type, source_name, source_identity,
        source_row_index, source_evidence_json, raw_row, parser_errors_json, status, created_at_iso, updated_at_iso,
        corrected_at_iso, corrected_transaction_id, correction_json, dismissal_reason, dismissed_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPendingObservation = db.prepare(`
      INSERT OR IGNORE INTO pending_transaction_observations (
        id, household_id, account_id, transaction_date_iso, amount_minor, merchant_raw,
        source_row_index, currency_code, source_type, source_reference, import_job_id,
        status, source_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const findPendingByReference = db.prepare(`
      SELECT id, household_id, account_id, source_reference, reconciled_transaction_id
      FROM pending_transaction_observations
      WHERE household_id = ? AND account_id = ? AND TRIM(source_reference) = ?
        AND reconciled_transaction_id IS NULL
      ORDER BY id
      LIMIT 2
    `);
    const markPendingReconciled = db.prepare(`
      UPDATE pending_transaction_observations
      SET reconciled_transaction_id = ?, reconciled_at_iso = ?
      WHERE id = ? AND reconciled_transaction_id IS NULL
    `);

    db.exec("BEGIN");
    try {
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

      let insertedPendingCount = 0;
      for (const observation of pendingObservations) {
        if (
          observation.householdId !== importJob.householdId ||
          (observation.importJobId !== undefined && observation.importJobId !== importJob.id)
        ) {
          throw new Error("Pending observations must belong to the import job and household being persisted.");
        }
        const accountExists = db.prepare(
          "SELECT 1 FROM accounts WHERE id = ? AND household_id = ?"
        ).get(observation.accountId, observation.householdId);
        if (accountExists === undefined) {
          throw new Error("Pending observation account must belong to its household.");
        }
        const result = insertPendingObservation.run(
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
          observation.sourceStatus
        ) as { changes: number | bigint };
        insertedPendingCount += Number(result.changes);
      }

      let insertedCount = 0;
      const insertedTransactions: Transaction[] = [];
      for (const transaction of transactions) {
        const result = insertTransaction.run(
          transaction.id,
          transaction.householdId,
          transaction.accountId,
          transaction.bookedAtIso,
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
        ) as { changes: number | bigint };
        if (Number(result.changes) > 0) {
          insertedCount += Number(result.changes);
          insertedTransactions.push(transaction);
        }
      }

      const pendingCandidates: PendingTransactionMatchCandidate[] = [];
      const queriedReferenceKeys = new Set<string>();
      for (const transaction of transactions) {
        if (transaction.sourceType !== "csv" && transaction.sourceType !== "pdf") continue;
        const sourceReference = transaction.sourceReference?.trim();
        if (!sourceReference) continue;
        const key = JSON.stringify([
          transaction.householdId,
          transaction.accountId,
          sourceReference,
        ]);
        if (queriedReferenceKeys.has(key)) continue;
        queriedReferenceKeys.add(key);
        const pendingRows = findPendingByReference.all(
          transaction.householdId,
          transaction.accountId,
          sourceReference
        ) as Array<{
          id: string;
          household_id: string;
          account_id: string;
          source_reference: string | null;
          reconciled_transaction_id: string | null;
        }>;
        pendingCandidates.push(...pendingRows.map((row) => ({
          id: row.id,
          householdId: row.household_id,
          accountId: row.account_id,
          ...(row.source_reference === null ? {} : { sourceReference: row.source_reference }),
          ...(row.reconciled_transaction_id === null
            ? {}
            : { reconciledTransactionId: row.reconciled_transaction_id }),
        })));
      }

      for (const match of matchPendingTransactionObservations(transactions, pendingCandidates)) {
        markPendingReconciled.run(
          match.transactionId,
          importJob.finishedAtIso ?? importJob.startedAtIso,
          match.pendingObservationId
        );
      }

      for (const reviewItem of reviewItems) {
        if (reviewItem.importJobId !== importJob.id || reviewItem.householdId !== importJob.householdId) {
          throw new Error("Import review items must belong to the import job and household being persisted.");
        }
        insertReviewItem.run(
          reviewItem.id,
          reviewItem.importJobId,
          reviewItem.householdId,
          reviewItem.accountId,
          reviewItem.sourceType,
          reviewItem.sourceName,
          reviewItem.sourceIdentity,
          reviewItem.sourceRowIndex,
          reviewItem.sourceEvidence === undefined ? null : JSON.stringify(reviewItem.sourceEvidence),
          reviewItem.rawRow,
          JSON.stringify(reviewItem.parserErrors),
          reviewItem.status,
          reviewItem.createdAtIso,
          reviewItem.updatedAtIso,
          reviewItem.correctedAtIso ?? null,
          reviewItem.correctedTransactionId ?? null,
          reviewItem.correctionJson ?? null,
          reviewItem.dismissalReason ?? null,
          reviewItem.dismissedAtIso ?? null
        );
      }

      persistImportJobOperation(db, importJob, insertedTransactions, insertedPendingCount);
      for (const transaction of insertedTransactions) {
        persistTransactionBaseline(db, importJob.id, transaction);
      }

      db.exec("COMMIT");
      return insertedCount;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function updateTransactionCategory(transactionId: string, categoryId: string): void {
    const result = db
      .prepare("UPDATE transactions SET category_id = ? WHERE id = ?")
      .run(categoryId, transactionId) as { changes: number | bigint };

    if (Number(result.changes) !== 1) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }
  }

  function updateTransactionCategoryAndRule(
    transactionId: string,
    rule: MerchantCategoryRule,
    categorization?: CategorizationDecision
  ): void {
    db.exec("BEGIN");
    try {
      const originalCategorizationRow = db
        .prepare("SELECT categorization_json FROM transactions WHERE id = ?")
        .get(transactionId) as { categorization_json: string | null } | undefined;
      const correctionProvenance = createCorrectionProvenance({
        id: randomUUID(),
        sourceTransactionId: transactionId,
        merchantAlias: rule.merchantAlias,
        categoryId: rule.categoryId,
        actor: "local-user",
        correctedAtIso: new Date().toISOString(),
        ...(originalCategorizationRow?.categorization_json == null
          ? {}
          : {
              originalCategorization: JSON.parse(
                originalCategorizationRow.categorization_json
              ) as CategorizationDecision,
            }),
      });
      updateTransactionCategory(transactionId, rule.categoryId);
      if (categorization !== undefined) {
        db.prepare("UPDATE transactions SET categorization_json = ? WHERE id = ?").run(
          JSON.stringify(categorization),
          transactionId
        );
      }
      upsertMerchantCategoryRule(rule);
      db.prepare(`
        INSERT INTO merchant_correction_provenance (
          id, source_transaction_id, merchant_alias, category_id, actor, corrected_at_iso,
          original_categorization_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        correctionProvenance.id,
        correctionProvenance.sourceTransactionId,
        correctionProvenance.merchantAlias,
        correctionProvenance.categoryId,
        correctionProvenance.actor,
        correctionProvenance.correctedAtIso,
        correctionProvenance.originalCategorization === undefined
          ? null
          : JSON.stringify(correctionProvenance.originalCategorization)
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listMerchantCorrectionProvenance(): MerchantCorrectionProvenance[] {
    return db
      .prepare(`
        SELECT id, source_transaction_id, merchant_alias, category_id, actor, corrected_at_iso,
          original_categorization_json
        FROM merchant_correction_provenance
        ORDER BY corrected_at_iso, id
      `)
      .all()
      .map((row) => {
        const typedRow = row as {
          id: string;
          source_transaction_id: string;
          merchant_alias: string;
          category_id: string;
          actor: "local-user";
          corrected_at_iso: string;
          original_categorization_json: string | null;
        };
        const provenance: MerchantCorrectionProvenance = {
          id: typedRow.id,
          sourceTransactionId: typedRow.source_transaction_id,
          merchantAlias: typedRow.merchant_alias,
          categoryId: typedRow.category_id,
          actor: typedRow.actor,
          correctedAtIso: typedRow.corrected_at_iso,
        };
        if (typedRow.original_categorization_json !== null) {
          provenance.originalCategorization = JSON.parse(
            typedRow.original_categorization_json
          ) as CategorizationDecision;
        }
        return provenance;
      });
  }

  function applySameMerchantPropagation(
    input: SameMerchantPropagationInput
  ): SameMerchantPropagationOperation {
    if (input.transactionIds.length === 0) {
      throw new Error("At least one transaction must be selected for propagation.");
    }
    if (new Set(input.transactionIds).size !== input.transactionIds.length) {
      throw new Error("Propagation transaction IDs must be unique.");
    }

    const operation: SameMerchantPropagationOperation = {
      id: randomUUID(),
      sourceTransactionId: input.sourceTransactionId,
      merchantAlias: input.merchantAlias,
      categoryId: input.categoryId,
      appliedAtIso: new Date().toISOString(),
      changes: [],
    };
    const insertOperation = db.prepare(`
      INSERT INTO same_merchant_propagation_operations (
        id, source_transaction_id, merchant_alias, category_id, applied_at_iso
      ) VALUES (?, ?, ?, ?, ?)
    `);
    const getTransaction = db.prepare(
      "SELECT household_id, merchant_raw, category_id, categorization_json FROM transactions WHERE id = ?"
    );
    const insertChange = db.prepare(`
      INSERT INTO same_merchant_propagation_changes (
        operation_id, transaction_id, before_category_id, after_category_id,
        before_categorization_json, after_categorization_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateCategory = db.prepare(
      "UPDATE transactions SET category_id = ?, categorization_json = ? WHERE id = ? AND category_id IS NULL"
    );

    db.exec("BEGIN");
    try {
      const sourceCorrection = db.prepare(`
        SELECT 1
        FROM merchant_correction_provenance
        WHERE source_transaction_id = ? AND merchant_alias = ? AND category_id = ?
      `).get(input.sourceTransactionId, input.merchantAlias, input.categoryId);
      const sourceTransaction = getTransaction.get(input.sourceTransactionId) as
        | {
          household_id: string;
          merchant_raw: string;
          category_id: string | null;
          categorization_json: string | null;
        }
        | undefined;
      const sourceRule = db.prepare(
        "SELECT category_id FROM merchant_category_rules WHERE merchant_alias = ?"
      ).get(input.merchantAlias) as { category_id: string } | undefined;
      if (
        sourceTransaction === undefined ||
        sourceCorrection === undefined ||
        sourceTransaction.category_id !== input.categoryId ||
        normalizeMerchantName(sourceTransaction.merchant_raw) !== input.merchantAlias ||
        sourceRule?.category_id !== input.categoryId
      ) {
        throw new Error(`Source correction not found: ${input.sourceTransactionId}`);
      }

      insertOperation.run(
        operation.id,
        operation.sourceTransactionId,
        operation.merchantAlias,
        operation.categoryId,
        operation.appliedAtIso
      );
      for (const transactionId of input.transactionIds) {
        const row = getTransaction.get(transactionId) as
          | {
            household_id: string;
            merchant_raw: string;
            category_id: string | null;
            categorization_json: string | null;
          }
          | undefined;
        if (row === undefined) throw new Error(`Transaction not found: ${transactionId}`);
        if (
          row.household_id !== sourceTransaction.household_id ||
          normalizeMerchantName(row.merchant_raw) !== input.merchantAlias
        ) {
          throw new Error(`Transaction is not eligible for same-merchant propagation: ${transactionId}`);
        }
        if (row.category_id !== null) throw new Error(`Transaction is already categorized: ${transactionId}`);

        const result = updateCategory.run(
          input.categoryId,
          sourceTransaction.categorization_json,
          transactionId
        ) as { changes: number | bigint };
        if (Number(result.changes) !== 1) throw new Error(`Transaction could not be propagated: ${transactionId}`);
        insertChange.run(
          operation.id,
          transactionId,
          row.category_id,
          input.categoryId,
          row.categorization_json,
          sourceTransaction.categorization_json
        );
        operation.changes.push({
          transactionId,
          beforeCategoryId: row.category_id,
          afterCategoryId: input.categoryId,
          ...(row.categorization_json === null
            ? {}
            : { beforeCategorization: JSON.parse(row.categorization_json) as CategorizationDecision }),
          ...(sourceTransaction.categorization_json === null
            ? {}
            : { afterCategorization: JSON.parse(sourceTransaction.categorization_json) as CategorizationDecision }),
        });
      }
      db.exec("COMMIT");
      return operation;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listSameMerchantPropagationOperations(): SameMerchantPropagationOperation[] {
    const rows = db.prepare(`
      SELECT
        operation.id,
        operation.source_transaction_id,
        operation.merchant_alias,
        operation.category_id,
        operation.applied_at_iso,
        operation.undone_at_iso,
        change.transaction_id,
        change.before_category_id,
        change.after_category_id,
        change.before_categorization_json,
        change.after_categorization_json
      FROM same_merchant_propagation_operations AS operation
      LEFT JOIN same_merchant_propagation_changes AS change ON change.operation_id = operation.id
      ORDER BY operation.applied_at_iso, operation.id, change.transaction_id
    `).all() as Array<{
      id: string;
      source_transaction_id: string;
      merchant_alias: string;
      category_id: string;
      applied_at_iso: string;
      undone_at_iso: string | null;
      transaction_id: string | null;
      before_category_id: string | null;
      after_category_id: string | null;
      before_categorization_json: string | null;
      after_categorization_json: string | null;
    }>;
    const operations = new Map<string, SameMerchantPropagationOperation>();

    for (const row of rows) {
      let operation = operations.get(row.id);
      if (operation === undefined) {
        operation = {
          id: row.id,
          sourceTransactionId: row.source_transaction_id,
          merchantAlias: row.merchant_alias,
          categoryId: row.category_id,
          appliedAtIso: row.applied_at_iso,
          ...(row.undone_at_iso === null ? {} : { undoneAtIso: row.undone_at_iso }),
          changes: [],
        };
        operations.set(row.id, operation);
      }
      if (row.transaction_id !== null && row.after_category_id !== null) {
        operation.changes.push({
          transactionId: row.transaction_id,
          beforeCategoryId: row.before_category_id,
          afterCategoryId: row.after_category_id,
          ...(row.before_categorization_json === null
            ? {}
            : { beforeCategorization: JSON.parse(row.before_categorization_json) as CategorizationDecision }),
          ...(row.after_categorization_json === null
            ? {}
            : { afterCategorization: JSON.parse(row.after_categorization_json) as CategorizationDecision }),
        });
      }
    }

    return [...operations.values()];
  }

  function undoSameMerchantPropagation(operationId: string): boolean {
    db.exec("BEGIN");
    try {
      const operation = db.prepare(`
        SELECT undone_at_iso
        FROM same_merchant_propagation_operations
        WHERE id = ?
      `).get(operationId) as { undone_at_iso: string | null } | undefined;
      if (operation === undefined || operation.undone_at_iso !== null) {
        db.exec("ROLLBACK");
        return false;
      }

      const changes = db.prepare(`
        SELECT
          transaction_id,
          before_category_id,
          after_category_id,
          before_categorization_json,
          after_categorization_json
        FROM same_merchant_propagation_changes
        WHERE operation_id = ?
        ORDER BY transaction_id
      `).all(operationId) as Array<{
        transaction_id: string;
        before_category_id: string | null;
        after_category_id: string;
        before_categorization_json: string | null;
        after_categorization_json: string | null;
      }>;
      const restoreCategory = db.prepare(`
        UPDATE transactions
        SET category_id = ?, categorization_json = ?
        WHERE id = ? AND category_id = ? AND categorization_json IS ?
      `);
      for (const change of changes) {
        const result = restoreCategory.run(
          change.before_category_id,
          change.before_categorization_json,
          change.transaction_id,
          change.after_category_id,
          change.after_categorization_json
        ) as { changes: number | bigint };
        if (Number(result.changes) !== 1) {
          throw new Error(`Transaction changed since propagation: ${change.transaction_id}`);
        }
      }

      const markUndone = db.prepare(`
        UPDATE same_merchant_propagation_operations
        SET undone_at_iso = ?
        WHERE id = ? AND undone_at_iso IS NULL
      `).run(new Date().toISOString(), operationId) as { changes: number | bigint };
      if (Number(markUndone.changes) !== 1) {
        throw new Error(`Propagation operation could not be undone: ${operationId}`);
      }

      db.exec("COMMIT");
      return true;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listMerchantCategoryRules(): MerchantCategoryRule[] {
    return db
      .prepare("SELECT merchant_alias, category_id FROM merchant_category_rules ORDER BY merchant_alias")
      .all()
      .map((row) => {
        const typedRow = row as { merchant_alias: string; category_id: string };
        return { merchantAlias: typedRow.merchant_alias, categoryId: typedRow.category_id };
      });
  }

  function upsertMerchantCategoryRule(rule: MerchantCategoryRule): void {
    if (typeof rule.merchantAlias !== "string" || !rule.merchantAlias.trim()) {
      throw new Error("merchantAlias must be a non-empty string.");
    }
    db.prepare(
      "INSERT INTO merchant_category_rules (merchant_alias, category_id) VALUES (?, ?) ON CONFLICT(merchant_alias) DO UPDATE SET category_id = excluded.category_id"
    ).run(rule.merchantAlias, rule.categoryId);
  }

  function appendManualEntry(importJob: ImportJob, transaction: Transaction): void {
    const insertImportJob = db.prepare(
      "INSERT INTO import_jobs (id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertTransaction = db.prepare(
  "INSERT INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json, category_allocations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    db.exec("BEGIN");
    try {
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
      insertTransaction.run(
        transaction.id,
        transaction.householdId,
        transaction.accountId,
        transaction.bookedAtIso,
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
      persistImportJobOperation(db, importJob, [transaction]);
      persistTransactionBaseline(db, importJob.id, transaction);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    hasHousehold: () => hasHousehold(db),
    createInitialHouseholdAndAccount: (input) => createInitialHouseholdAndAccount(db, input),
    loadRuntimeMetadata,
    listMonthlyTotals,
    getTransactionsForMonth,
    getTransactionsForAccount,
    listPendingTransactionObservations,
    getTransactionById,
    updateTransactionCategoryAllocations,
    saveAccountStatementCoveragePeriod,
    appendAccountBalanceCheckpoint,
    listAccountStatementCoveragePeriods,
    listAccountBalanceCheckpoints,
    upsertExchangeRate,
    upsertExchangeRates,
    listExchangeRates,
    createPropertyRecord,
    updatePropertyRecordLabel,
    listPropertyRecords,
    appendPropertyValuationSnapshot,
    listPropertyValuationSnapshots,
    createHoldingRecord,
    listHoldingRecords,
    correctHoldingRecord,
    appendHoldingValuationSnapshot,
    listHoldingValuationSnapshots,
    createLoanRecord,
    listLoanRecords,
    appendLoanBalanceSnapshot,
    listLoanBalanceSnapshots,
    loadLedgerSnapshotData,
    replaceLedgerSnapshotData,
    queryTransactions,
    listUncategorizedTransactions,
    saveLedgerView,
    listSavedLedgerViews,
    deleteSavedLedgerView,
    saveBackupSnapshot,
    listBackupSnapshots,
    deleteBackupSnapshot,
    saveCsvImportProfile,
    listCsvImportProfiles,
    deleteCsvImportProfile,
    listImportJobHistory,
    undoImportJob,
    getAccountsForHousehold,
    upsertMonthlyCategoryTarget,
    appendImportJob,
    hasImportJob,
    getTransactionsForImportJob,
    getImportedTransactionsForSource,
    listImportReviewItems,
    completeImportReviewCorrection,
    completeImportReviewDismissal,
    appendImportJobAndTransactions,
    appendTransactions,
    updateTransactionCategory,
    updateTransactionCategoryAndRule,
    listMerchantCorrectionProvenance,
    applySameMerchantPropagation,
    listSameMerchantPropagationOperations,
    undoSameMerchantPropagation,
    listMerchantCategoryRules,
    upsertMerchantCategoryRule,
    appendManualEntry,
    close: () => db.close(),
  };
}