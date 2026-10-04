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
import { normalizeMerchantName } from "../../domain/merchant/normalizeMerchantName.js";
import type { CsvImportProfile } from "../../domain/import/csvImportProfile.js";
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
import type {
  Account,
  CategorizationDecision,
  Household,
  ImportJob,
  ImportJobProvenance,
  MerchantCorrectionProvenance,
  MerchantCategoryRule,
  MonthlyCategoryTarget,
  MonthlyTotal,
  SameMerchantPropagationInput,
  SameMerchantPropagationOperation,
  Transaction,
} from "../../domain/types.js";
import { isYearMonth } from "../../domain/types.js";

interface LocalLedgerSeedData {
  household: Household;
  accounts: Account[];
  transactions: Transaction[];
  importJobs: ImportJob[];
  monthlyCategoryTargets: MonthlyCategoryTarget[];
  merchantCategoryRules?: MerchantCategoryRule[];
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
  getTransactionById: (transactionId: string) => Transaction | undefined;
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
  appendImportJobAndTransactions: (importJob: ImportJob, transactions: Transaction[]) => number;
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
  return mapped;
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
    importJobId: transaction.importJobId ?? null,
  });
}

function persistImportJobOperation(
  db: DatabaseSync,
  importJob: ImportJob,
  importedTransactions: Transaction[]
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
      imported_count = excluded.imported_count,
      duplicate_count = excluded.duplicate_count
  `).run(
    importJob.id,
    importJob.householdId,
    accountId,
    candidateCount,
    importedTransactions.length,
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
      categorization_json TEXT
    );

    CREATE INDEX IF NOT EXISTS transactions_by_household_booked_at
      ON transactions (household_id, booked_at_iso);

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

    CREATE TABLE IF NOT EXISTS monthly_category_targets (
      year_month TEXT NOT NULL,
      category_id TEXT NOT NULL,
      target_minor INTEGER NOT NULL,
      PRIMARY KEY (year_month, category_id)
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
  if (!transactionColumns.some((column) => column.name === "merchant_search")) {
    db.exec("ALTER TABLE transactions ADD COLUMN merchant_search TEXT NOT NULL DEFAULT ''");
  }
  const correctionProvenanceColumns = db
    .prepare("PRAGMA table_info(merchant_correction_provenance)")
    .all() as Array<{ name: string }>;
  if (!correctionProvenanceColumns.some((column) => column.name === "original_categorization_json")) {
    db.exec("ALTER TABLE merchant_correction_provenance ADD COLUMN original_categorization_json TEXT");
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
    db.exec("ALTER TABLE backup_snapshots ADD COLUMN version TEXT NOT NULL DEFAULT '2'");
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

  const insertTransaction = db.prepare(
  "INSERT INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
      transaction.categorization === undefined ? null : JSON.stringify(transaction.categorization)
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

  const insertTarget = db.prepare(
    "INSERT INTO monthly_category_targets (year_month, category_id, target_minor) VALUES (?, ?, ?)"
  );
  for (const target of snapshot.monthlyCategoryTargets) {
    insertTarget.run(target.yearMonth, target.categoryId, target.targetMinor);
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
        currency_code, source_type, source_reference, category_id, import_job_id
      FROM transactions
      WHERE household_id = ? AND booked_at_iso >= ? AND booked_at_iso < ?
      ORDER BY booked_at_iso ASC, id ASC
    `).all(householdId, `${yearMonth}-01`, `${nextYearMonth(yearMonth)}-01`) as unknown as TransactionRow[];
    return rows.map(mapTransactionRow);
  }

  function getTransactionsForAccount(accountId: string): Transaction[] {
    const rows = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id
      FROM transactions
      WHERE account_id = ?
      ORDER BY booked_at_iso ASC, id ASC
    `).all(accountId) as unknown as TransactionRow[];
    return rows.map(mapTransactionRow);
  }

  function getTransactionById(transactionId: string): Transaction | undefined {
    const row = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id
      FROM transactions
      WHERE id = ?
    `).get(transactionId) as TransactionRow | undefined;
    return row === undefined ? undefined : mapTransactionRow(row);
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
            currency_code, source_type, source_reference, category_id, import_job_id
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
        "SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json FROM transactions ORDER BY id"
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
    }>;

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

    const mappedTransactions: Transaction[] = transactions.map((transaction) => {
      const mapped: Transaction = {
        id: transaction.id,
        householdId: transaction.household_id,
        accountId: transaction.account_id,
        bookedAtIso: transaction.booked_at_iso,
        amountMinor: transaction.amount_minor,
        merchantRaw: transaction.merchant_raw,
      };

      if (transaction.currency_code !== null) {
        mapped.currencyCode = transaction.currency_code;
      }
      if (transaction.source_type !== null) {
        mapped.sourceType = transaction.source_type;
      }

      if (transaction.source_reference !== null) {
        mapped.sourceReference = transaction.source_reference;
      }

      if (transaction.category_id !== null) {
        mapped.categoryId = transaction.category_id;
      }

      if (transaction.import_job_id !== null) {
        mapped.importJobId = transaction.import_job_id;
      }
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
        DELETE FROM monthly_category_targets;
        DELETE FROM transactions;
        DELETE FROM import_jobs;
        DELETE FROM merchant_category_rules;
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
      predicates.push("t.category_id = ?");
      parameters.push(query.categoryId);
    }
    if (query.uncategorizedOnly) predicates.push("t.category_id IS NULL");
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
        t.category_id, t.import_job_id
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
        currency_code, source_type, source_reference, category_id, import_job_id
      FROM transactions
      WHERE household_id = ? AND category_id IS NULL
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
      };
    }

    const transactions = db.prepare(`
      SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        currency_code, source_type, source_reference, category_id, import_job_id
      FROM transactions
      WHERE import_job_id = ?
      ORDER BY id
    `).all(importJobId) as unknown as TransactionRow[];
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
    db.exec("BEGIN");
    try {
      if (operation.undo_available === 1) {
        const deleteTransaction = db.prepare(
          "DELETE FROM transactions WHERE id = ? AND import_job_id = ?"
        );
        for (const row of transactions) {
          const transaction = mapTransactionRow(row);
          const baselineJson = baselines.get(transaction.id);
          if (baselineJson !== undefined && serializeTransactionForUndo(transaction) === baselineJson) {
            const result = deleteTransaction.run(transaction.id, importJobId) as { changes: number | bigint };
            removedCount += Number(result.changes);
          } else {
            retainedCount += 1;
          }
        }
      } else {
        retainedCount = transactions.length;
      }

      const undoneAtIso = new Date().toISOString();
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

    return { importJobId, removedCount, retainedCount, alreadyUndone: false };
  }

  function hasImportJob(importJobId: string): boolean {
    return db.prepare("SELECT 1 FROM import_jobs WHERE id = ?").get(importJobId) !== undefined;
  }

  function getTransactionsForImportJob(importJobId: string): Transaction[] {
    return loadLedgerSnapshotData().transactions.filter((transaction) => transaction.importJobId === importJobId);
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
  "INSERT OR IGNORE INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
          transaction.categorization === undefined ? null : JSON.stringify(transaction.categorization)
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
    transactions: Transaction[]
  ): number {
    const insertImportJob = db.prepare(
      "INSERT OR IGNORE INTO import_jobs (id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertTransaction = db.prepare(
  "INSERT OR IGNORE INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
          transaction.categorization === undefined ? null : JSON.stringify(transaction.categorization)
        ) as { changes: number | bigint };
        if (Number(result.changes) > 0) {
          insertedCount += Number(result.changes);
          insertedTransactions.push(transaction);
        }
      }

      persistImportJobOperation(db, importJob, insertedTransactions);
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
          id, source_transaction_id, merchant_alias, category_id, corrected_at_iso,
          original_categorization_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        transactionId,
        rule.merchantAlias,
        rule.categoryId,
        new Date().toISOString(),
        originalCategorizationRow?.categorization_json ?? null
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
        SELECT id, source_transaction_id, merchant_alias, category_id, corrected_at_iso,
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
          corrected_at_iso: string;
          original_categorization_json: string | null;
        };
        const provenance: MerchantCorrectionProvenance = {
          id: typedRow.id,
          sourceTransactionId: typedRow.source_transaction_id,
          merchantAlias: typedRow.merchant_alias,
          categoryId: typedRow.category_id,
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
      "SELECT household_id, merchant_raw, category_id FROM transactions WHERE id = ?"
    );
    const insertChange = db.prepare(`
      INSERT INTO same_merchant_propagation_changes (
        operation_id, transaction_id, before_category_id, after_category_id
      ) VALUES (?, ?, ?, ?)
    `);
    const updateCategory = db.prepare(
      "UPDATE transactions SET category_id = ? WHERE id = ? AND category_id IS NULL"
    );

    db.exec("BEGIN");
    try {
      const sourceCorrection = db.prepare(`
        SELECT 1
        FROM merchant_correction_provenance
        WHERE source_transaction_id = ? AND merchant_alias = ? AND category_id = ?
      `).get(input.sourceTransactionId, input.merchantAlias, input.categoryId);
      const sourceTransaction = getTransaction.get(input.sourceTransactionId) as
        | { household_id: string; merchant_raw: string; category_id: string | null }
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
          | { household_id: string; merchant_raw: string; category_id: string | null }
          | undefined;
        if (row === undefined) throw new Error(`Transaction not found: ${transactionId}`);
        if (
          row.household_id !== sourceTransaction.household_id ||
          normalizeMerchantName(row.merchant_raw) !== input.merchantAlias
        ) {
          throw new Error(`Transaction is not eligible for same-merchant propagation: ${transactionId}`);
        }
        if (row.category_id !== null) throw new Error(`Transaction is already categorized: ${transactionId}`);

        const result = updateCategory.run(input.categoryId, transactionId) as { changes: number | bigint };
        if (Number(result.changes) !== 1) throw new Error(`Transaction could not be propagated: ${transactionId}`);
        insertChange.run(operation.id, transactionId, row.category_id, input.categoryId);
        operation.changes.push({
          transactionId,
          beforeCategoryId: row.category_id,
          afterCategoryId: input.categoryId,
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
        change.after_category_id
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
        SELECT transaction_id, before_category_id, after_category_id
        FROM same_merchant_propagation_changes
        WHERE operation_id = ?
        ORDER BY transaction_id
      `).all(operationId) as Array<{
        transaction_id: string;
        before_category_id: string | null;
        after_category_id: string;
      }>;
      const restoreCategory = db.prepare(
        "UPDATE transactions SET category_id = ? WHERE id = ? AND category_id = ?"
      );
      for (const change of changes) {
        const result = restoreCategory.run(
          change.before_category_id,
          change.transaction_id,
          change.after_category_id
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
  "INSERT INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id, categorization_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        transaction.categorization === undefined ? null : JSON.stringify(transaction.categorization)
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
    getTransactionById,
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