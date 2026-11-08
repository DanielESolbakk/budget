import {
  type TransactionRow,
  type PendingTransactionObservationRow,
  mapTransactionRow,
  mapPendingTransactionObservationRow,
} from "./ledgerTransactionRows.js";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CATEGORY_OPTIONS } from "../../domain/categorization/categoryOptions.js";
import { normalizeMerchantName } from "../../domain/merchant/normalizeMerchantName.js";
import {
  DEFAULT_TRANSACTION_PAGE_SIZE,
  LARGE_TRANSACTION_THRESHOLD_MINOR,
  MAX_TRANSACTION_PAGE_SIZE,
  resolveTransactionDateBounds,
  type TransactionPage,
  type TransactionQuery,
  type TransactionSortDirection,
  type TransactionSortField,
} from "../../domain/ledger/filterTransactions.js";
import { validateTransactionCategoryAllocations } from "../../domain/ledger/transactionAllocations.js";
import type {
  Account,
  CategorizationDecision,
  ImportJob,
  PendingTransactionObservation,
  MonthlyTotal,
  Transaction,
  TransactionCategoryAllocation,
} from "../../domain/types.js";
import { isYearMonth } from "../../domain/types.js";
import { nextYearMonth } from "../../domain/date/calendarDate.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type SnapshotReader = Pick<LocalLedgerDatabase,
  | "loadLedgerSnapshotData"
>;
type TransactionRepository = Pick<LocalLedgerDatabase,
  | "listMonthlyTotals"
  | "getTransactionsForMonth"
  | "getTransactionsForAccount"
  | "listPendingTransactionObservations"
  | "getTransactionById"
  | "updateTransactionCategoryAllocations"
  | "queryTransactions"
  | "listUncategorizedTransactions"
  | "getAccountsForHousehold"
  | "getTransactionsForImportJob"
  | "getImportedTransactionsForSource"
>;

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

export function createTransactionRepository(db: DatabaseSync, readers: SnapshotReader): TransactionRepository {
  const { loadLedgerSnapshotData } = readers;

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
        category_allocations_json, categorization_json
      FROM transactions
      WHERE household_id = ? AND booked_at_iso >= ? AND booked_at_iso < ?
      ORDER BY booked_at_iso ASC, id ASC
    `).all(householdId, `${yearMonth}-01`, `${nextYearMonth(yearMonth)}-01`) as unknown as
      Array<TransactionRow & { categorization_json: string | null }>;
    return rows.map((row) => {
      const transaction = mapTransactionRow(row);
      if (row.categorization_json !== null) {
        transaction.categorization = JSON.parse(row.categorization_json) as CategorizationDecision;
      }
      return transaction;
    });
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
    if (dateBounds.bookedFromMs !== undefined) {
      predicates.push("t.booked_at_millis >= ?");
      parameters.push(dateBounds.bookedFromMs);
    }
    if (dateBounds.bookedToMs !== undefined) {
      predicates.push("t.booked_at_millis <= ?");
      parameters.push(dateBounds.bookedToMs);
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
      transactions: transactionRows.map((row) => ({
        ...mapTransactionRow(row),
        merchantAlias: normalizeMerchantName(row.merchant_raw),
      })),
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

  return {
    listMonthlyTotals,
    getTransactionsForMonth,
    getTransactionsForAccount,
    listPendingTransactionObservations,
    getTransactionById,
    updateTransactionCategoryAllocations,
    queryTransactions,
    listUncategorizedTransactions,
    getAccountsForHousehold,
    getTransactionsForImportJob,
    getImportedTransactionsForSource,
  };
}
