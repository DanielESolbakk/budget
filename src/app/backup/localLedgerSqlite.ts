import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LedgerSnapshotData } from "../../domain/backup/snapshotContract.js";
import type {
  Account,
  Household,
  ImportJob,
  MonthlyCategoryTarget,
  Transaction,
} from "../../domain/types.js";

interface LocalLedgerSeedData {
  household: Household;
  accounts: Account[];
  transactions: Transaction[];
  importJobs: ImportJob[];
  monthlyCategoryTargets: MonthlyCategoryTarget[];
}

export interface LocalLedgerDatabase {
  loadLedgerSnapshotData: () => LedgerSnapshotData;
  upsertMonthlyCategoryTarget: (target: MonthlyCategoryTarget) => void;
  appendImportJob: (importJob: ImportJob) => void;
  appendTransactions: (transactions: Transaction[]) => void;
  close: () => void;
}

interface CreateLocalLedgerDatabaseOptions {
  dbPath?: string;
  seedData: LocalLedgerSeedData;
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
      finished_at_iso TEXT
    );

    CREATE TABLE IF NOT EXISTS monthly_category_targets (
      year_month TEXT NOT NULL,
      category_id TEXT NOT NULL,
      target_minor INTEGER NOT NULL,
      PRIMARY KEY (year_month, category_id)
    );
  `);

  const existingImportJobColumns = new Set(
    (db.prepare("PRAGMA table_info(import_jobs)").all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );

  const importJobColumns = [
    ["adapter_id", "TEXT"],
    ["candidate_count", "INTEGER"],
    ["validation_failure_count", "INTEGER"],
  ] as const;

  for (const [columnName, columnType] of importJobColumns) {
    if (!existingImportJobColumns.has(columnName)) {
      db.exec(`ALTER TABLE import_jobs ADD COLUMN ${columnName} ${columnType}`);
    }
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
    db.prepare(
      "INSERT INTO households (id, name, created_at_iso) VALUES (?, ?, ?)"
    ).run(seedData.household.id, seedData.household.name, seedData.household.createdAtIso);

    const insertAccount = db.prepare(
      "INSERT INTO accounts (id, household_id, name, currency_code) VALUES (?, ?, ?, ?)"
    );
    for (const account of seedData.accounts) {
      insertAccount.run(account.id, account.householdId, account.name, account.currencyCode);
    }

    const insertTransaction = db.prepare(
      "INSERT INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, category_id, import_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const transaction of seedData.transactions) {
      insertTransaction.run(
        transaction.id,
        transaction.householdId,
        transaction.accountId,
        transaction.bookedAtIso,
        transaction.amountMinor,
        transaction.merchantRaw,
        transaction.categoryId ?? null,
        transaction.importJobId ?? null
      );
    }

    const insertImportJob = db.prepare(
      "INSERT INTO import_jobs (id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const importJob of seedData.importJobs) {
      insertImportJob.run(
        importJob.id,
        importJob.householdId,
        importJob.sourceType,
        importJob.sourceName,
        importJob.adapterId ?? null,
        importJob.candidateCount ?? null,
        importJob.validationFailureCount ?? null,
        importJob.startedAtIso,
        importJob.finishedAtIso ?? null
      );
    }

    const insertTarget = db.prepare(
      "INSERT INTO monthly_category_targets (year_month, category_id, target_minor) VALUES (?, ?, ?)"
    );
    for (const target of seedData.monthlyCategoryTargets) {
      insertTarget.run(target.yearMonth, target.categoryId, target.targetMinor);
    }

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
        "SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, category_id, import_job_id FROM transactions ORDER BY id"
      )
      .all() as Array<{
      id: string;
      household_id: string;
      account_id: string;
      booked_at_iso: string;
      amount_minor: number;
      merchant_raw: string;
      category_id: string | null;
      import_job_id: string | null;
    }>;

    const importJobs = db
      .prepare(
        "SELECT id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso FROM import_jobs ORDER BY id"
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
    }>;

    const monthlyCategoryTargets = db
      .prepare(
        "SELECT year_month, category_id, target_minor FROM monthly_category_targets ORDER BY year_month, category_id"
      )
      .all() as Array<{ year_month: string; category_id: string; target_minor: number }>;

    const mappedTransactions: Transaction[] = transactions.map((transaction) => {
      const mapped: Transaction = {
        id: transaction.id,
        householdId: transaction.household_id,
        accountId: transaction.account_id,
        bookedAtIso: transaction.booked_at_iso,
        amountMinor: transaction.amount_minor,
        merchantRaw: transaction.merchant_raw,
      };

      if (transaction.category_id !== null) {
        mapped.categoryId = transaction.category_id;
      }

      if (transaction.import_job_id !== null) {
        mapped.importJobId = transaction.import_job_id;
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
        currencyCode: "NOK",
      })),
      transactions: mappedTransactions,
      importJobs: mappedImportJobs,
      monthlyCategoryTargets: monthlyCategoryTargets.map((target) => ({
        yearMonth: target.year_month,
        categoryId: target.category_id,
        targetMinor: target.target_minor,
      })),
    };
  }

  function upsertMonthlyCategoryTarget(target: MonthlyCategoryTarget): void {
    db.prepare(
      "INSERT INTO monthly_category_targets (year_month, category_id, target_minor) VALUES (?, ?, ?) ON CONFLICT(year_month, category_id) DO UPDATE SET target_minor = excluded.target_minor"
    ).run(target.yearMonth, target.categoryId, target.targetMinor);
  }

  function appendImportJob(importJob: ImportJob): void {
    db.prepare(
      "INSERT INTO import_jobs (id, household_id, source_type, source_name, adapter_id, candidate_count, validation_failure_count, started_at_iso, finished_at_iso) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      importJob.id,
      importJob.householdId,
      importJob.sourceType,
      importJob.sourceName,
      importJob.adapterId ?? null,
      importJob.candidateCount ?? null,
      importJob.validationFailureCount ?? null,
      importJob.startedAtIso,
      importJob.finishedAtIso ?? null
    );
  }

  function appendTransactions(transactions: Transaction[]): void {
    const insertTransaction = db.prepare(
      "INSERT OR IGNORE INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, category_id, import_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    db.exec("BEGIN");
    try {
      for (const transaction of transactions) {
        insertTransaction.run(
          transaction.id,
          transaction.householdId,
          transaction.accountId,
          transaction.bookedAtIso,
          transaction.amountMinor,
          transaction.merchantRaw,
          transaction.categoryId ?? null,
          transaction.importJobId ?? null
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    loadLedgerSnapshotData,
    upsertMonthlyCategoryTarget,
    appendImportJob,
    appendTransactions,
    close: () => db.close(),
  };
}
