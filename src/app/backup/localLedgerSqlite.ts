import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LedgerSnapshotData } from "../../domain/backup/snapshotContract.js";
import { CATEGORY_OPTIONS } from "../../domain/categorization/categoryOptions.js";
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
  Household,
  ImportJob,
  ImportJobProvenance,
  MerchantCategoryRule,
  MonthlyCategoryTarget,
  Transaction,
} from "../../domain/types.js";

interface LocalLedgerSeedData {
  household: Household;
  accounts: Account[];
  transactions: Transaction[];
  importJobs: ImportJob[];
  monthlyCategoryTargets: MonthlyCategoryTarget[];
  merchantCategoryRules?: MerchantCategoryRule[];
}

export interface LocalLedgerDatabase {
  loadLedgerSnapshotData: () => LedgerSnapshotData;
  replaceLedgerSnapshotData: (snapshot: LedgerSnapshotData) => void;
  queryTransactions: (householdId: string, query: TransactionQuery) => TransactionPage;
  listUncategorizedTransactions: (householdId: string) => Transaction[];
  saveLedgerView: (savedLedgerView: SavedLedgerView) => void;
  listSavedLedgerViews: () => SavedLedgerView[];
  deleteSavedLedgerView: (viewId: string) => boolean;
  getAccountsForHousehold: (householdId: string) => Account[];
  upsertMonthlyCategoryTarget: (target: MonthlyCategoryTarget) => void;
  appendImportJob: (importJob: ImportJob) => void;
  hasImportJob: (importJobId: string) => boolean;
  getTransactionsForImportJob: (importJobId: string) => Transaction[];
  getImportedTransactionsForSource: (sourceType: ImportJob["sourceType"], sourceName: string, accountId: string, sourceIdentity?: string) => Transaction[];
  appendImportJobAndTransactions: (importJob: ImportJob, transactions: Transaction[]) => number;
  appendTransactions: (transactions: Transaction[]) => number;
  updateTransactionCategory: (transactionId: string, categoryId: string) => void;
  updateTransactionCategoryAndRule: (transactionId: string, rule: MerchantCategoryRule) => void;
  listMerchantCategoryRules: () => MerchantCategoryRule[];
  upsertMerchantCategoryRule: (rule: MerchantCategoryRule) => void;
  appendManualEntry: (importJob: ImportJob, transaction: Transaction) => void;
  close: () => void;
}

interface CreateLocalLedgerDatabaseOptions {
  dbPath?: string;
  seedData: LocalLedgerSeedData;
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
  categoryId: "t.category_id",
  accountId: "COALESCE(a.name, t.account_id)",
};
const categorySortExpression = `CASE WHEN t.category_id IS NULL THEN ? ELSE CASE t.category_id ${CATEGORY_OPTIONS
  .map(() => "WHEN ? THEN ?")
  .join(" ")} ELSE t.category_id END END`;
const categorySortParameters = [
  "Uncategorized",
  ...CATEGORY_OPTIONS.flatMap(({ id, label }) => [id, label]),
];

function merchantSearchValue(transaction: Pick<Transaction, "merchantRaw" | "merchantAlias">): string {
  return `${transaction.merchantRaw}\n${transaction.merchantAlias ?? ""}`.toUpperCase();
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
      import_job_id TEXT
    );

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

    CREATE TABLE IF NOT EXISTS saved_ledger_views (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      filters_json TEXT NOT NULL
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

  if (!transactionColumns.some((column) => column.name === "merchant_search")) {
    db.exec("ALTER TABLE transactions ADD COLUMN merchant_search TEXT NOT NULL DEFAULT ''");
  }
  const transactionsWithoutMerchantSearch = db
    .prepare("SELECT id, merchant_raw FROM transactions WHERE merchant_search = ''")
    .all() as Array<{ id: string; merchant_raw: string }>;
  const updateMerchantSearch = db.prepare("UPDATE transactions SET merchant_search = ? WHERE id = ?");
  for (const transaction of transactionsWithoutMerchantSearch) {
    updateMerchantSearch.run(transaction.merchant_raw.toUpperCase(), transaction.id);
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
  `);
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
    "INSERT INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
      transaction.importJobId ?? null
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
  seedIfEmpty(db, options.seedData);

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
        "SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, currency_code, source_type, source_reference, category_id, import_job_id FROM transactions ORDER BY id"
      )
      .all() as unknown as TransactionRow[];

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

    const mappedTransactions = transactions.map(mapTransactionRow);

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

  function queryTransactions(householdId: string, query: TransactionQuery): TransactionPage {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_TRANSACTION_PAGE_SIZE;
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new RangeError("page must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_TRANSACTION_PAGE_SIZE) {
      throw new RangeError(`pageSize must be an integer between 1 and ${MAX_TRANSACTION_PAGE_SIZE}.`);
    }

    const sortBy = query.sortBy ?? "bookedAtIso";
    const sortColumn = sortBy === "categoryId"
      ? `${categorySortExpression} COLLATE NOCASE`
      : transactionSortColumns[sortBy];
    if (sortColumn === undefined) throw new Error("sortBy must be a supported ledger field.");
    const sortDirection: TransactionSortDirection = query.sortDirection ?? "desc";
    if (sortDirection !== "asc" && sortDirection !== "desc") {
      throw new Error("sortDirection must be 'asc' or 'desc'.");
    }

    const conditions = ["t.household_id = ?"];
    const parameters: Array<string | number> = [householdId];
    const { bookedFromIso, bookedToIso } = resolveTransactionDateBounds(query);
    if (query.accountId !== undefined) {
      conditions.push("t.account_id = ?");
      parameters.push(query.accountId);
    }
    if (bookedFromIso !== undefined) {
      const start = /^\d{4}-\d{2}-\d{2}$/.test(bookedFromIso)
        ? `${bookedFromIso}T00:00:00.000Z`
        : bookedFromIso;
      conditions.push("julianday(t.booked_at_iso) >= julianday(?)");
      parameters.push(start);
    }
    if (bookedToIso !== undefined) {
      const end = /^\d{4}-\d{2}-\d{2}$/.test(bookedToIso)
        ? `${bookedToIso}T23:59:59.999Z`
        : bookedToIso;
      conditions.push("julianday(t.booked_at_iso) <= julianday(?)");
      parameters.push(end);
    }
    if (query.merchant !== undefined && query.merchant.trim() !== "") {
      conditions.push("instr(t.merchant_search, ?) > 0");
      parameters.push(query.merchant.trim().toUpperCase());
    }
    if (query.amountMinor !== undefined) {
      conditions.push("t.amount_minor = ?");
      parameters.push(query.amountMinor);
    }
    if (query.amountFromMinor !== undefined) {
      conditions.push("t.amount_minor >= ?");
      parameters.push(query.amountFromMinor);
    }
    if (query.amountToMinor !== undefined) {
      conditions.push("t.amount_minor <= ?");
      parameters.push(query.amountToMinor);
    }
    if (query.categoryId !== undefined) {
      conditions.push("t.category_id = ?");
      parameters.push(query.categoryId);
    }
    if (query.uncategorizedOnly === true) conditions.push("t.category_id IS NULL");
    if (query.transactionType === "income") conditions.push("t.amount_minor > 0");
    if (query.transactionType === "expenses") conditions.push("t.amount_minor < 0");
    if (query.largeTransactionsOnly === true) {
      conditions.push("ABS(t.amount_minor) >= ?");
      parameters.push(LARGE_TRANSACTION_THRESHOLD_MINOR);
    }

    const whereClause = conditions.join(" AND ");
    const countRow = db
      .prepare(`SELECT COUNT(*) AS total_count FROM transactions AS t WHERE ${whereClause}`)
      .get(...parameters) as { total_count: number | bigint };
    const totalCount = Number(countRow.total_count);
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new RangeError("page offset is too large.");

    const transactions = db
      .prepare(`
        SELECT t.id, t.household_id, t.account_id, t.booked_at_iso, t.amount_minor,
          t.merchant_raw, t.currency_code, t.source_type, t.source_reference,
          t.category_id, t.import_job_id
        FROM transactions AS t
        LEFT JOIN accounts AS a ON a.id = t.account_id
        WHERE ${whereClause}
        ORDER BY ${sortColumn} ${sortDirection.toUpperCase()}, t.id ASC
        LIMIT ? OFFSET ?
      `)
      .all(
        ...parameters,
        ...(sortBy === "categoryId" ? categorySortParameters : []),
        pageSize,
        offset
      ) as unknown as TransactionRow[];

    return { transactions: transactions.map(mapTransactionRow), totalCount, page, pageSize };
  }

  function listUncategorizedTransactions(householdId: string): Transaction[] {
    const transactions = db
      .prepare(`
        SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
          currency_code, source_type, source_reference, category_id, import_job_id
        FROM transactions
        WHERE household_id = ? AND category_id IS NULL
        ORDER BY substr(booked_at_iso, 1, 10) ASC, id ASC
      `)
      .all(householdId) as unknown as TransactionRow[];
    return transactions.map(mapTransactionRow);
  }

  function replaceLedgerSnapshotData(snapshot: LedgerSnapshotData): void {
    db.exec("BEGIN");
    try {
      db.exec(`
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
      "INSERT OR IGNORE INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    let insertedCount = 0;
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
          transaction.importJobId ?? null
        ) as { changes: number | bigint };
        insertedCount += Number(result.changes);
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
      "INSERT OR IGNORE INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
          transaction.importJobId ?? null
        ) as { changes: number | bigint };
        insertedCount += Number(result.changes);
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

  function updateTransactionCategoryAndRule(transactionId: string, rule: MerchantCategoryRule): void {
    db.exec("BEGIN");
    try {
      updateTransactionCategory(transactionId, rule.categoryId);
      upsertMerchantCategoryRule(rule);
      db.exec("COMMIT");
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
      "INSERT INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, merchant_search, currency_code, source_type, source_reference, category_id, import_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        transaction.importJobId ?? null
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    loadLedgerSnapshotData,
    replaceLedgerSnapshotData,
    queryTransactions,
    listUncategorizedTransactions,
    saveLedgerView,
    listSavedLedgerViews,
    deleteSavedLedgerView,
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
    listMerchantCategoryRules,
    upsertMerchantCategoryRule,
    appendManualEntry,
    close: () => db.close(),
  };
}
