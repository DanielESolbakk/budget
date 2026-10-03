import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import type { Transaction } from "../../src/domain/types.js";

const HOUSEHOLD = {
  id: "hh-ledger-query",
  name: "Ledger Query Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const CHECKING_ACCOUNT = {
  id: "z-account-checking",
  householdId: HOUSEHOLD.id,
  name: "Brukskonto",
  currencyCode: "NOK" as const,
};

const SAVINGS_ACCOUNT = {
  id: "a-account-savings",
  householdId: HOUSEHOLD.id,
  name: "Sparekonto",
  currencyCode: "NOK" as const,
};

function transaction(
  id: string,
  bookedAtIso: string,
  amountMinor: number,
  merchantRaw: string,
  options: { accountId?: string; categoryId?: string; merchantAlias?: string } = {}
): Transaction {
  return {
    id,
    householdId: HOUSEHOLD.id,
    accountId: options.accountId ?? CHECKING_ACCOUNT.id,
    bookedAtIso,
    amountMinor,
    merchantRaw,
    ...(options.categoryId === undefined ? {} : { categoryId: options.categoryId }),
    ...(options.merchantAlias === undefined ? {} : { merchantAlias: options.merchantAlias }),
  };
}

function withDatabase<Result>(
  transactions: Transaction[],
  run: (database: ReturnType<typeof createLocalLedgerDatabase>) => Result
): Result {
  const directory = mkdtempSync(join(tmpdir(), "budget-ledger-query-"));
  const database = createLocalLedgerDatabase({
    dbPath: join(directory, "ledger.sqlite"),
    seedData: {
      household: HOUSEHOLD,
      accounts: [CHECKING_ACCOUNT, SAVINGS_ACCOUNT],
      transactions,
      importJobs: [],
      monthlyCategoryTargets: [],
      merchantCategoryRules: [],
    },
  });

  try {
    return run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("SQLite ledger queries", () => {
  it("filters before returning a bounded page and its matching total count", () => {
    const transactions = [
      transaction("rema-old", "2026-05-01T08:00:00Z", -5000, "Rema 1000", { categoryId: "groceries" }),
      transaction("rema-new", "2026-05-05T08:00:00Z", -2500, "REMA 1000", { categoryId: "groceries" }),
      transaction("outside-amount", "2026-05-06T08:00:00Z", -7000, "Rema 1000", { categoryId: "groceries" }),
      transaction("other-account", "2026-05-07T08:00:00Z", -4000, "Rema 1000", {
        accountId: SAVINGS_ACCOUNT.id,
        categoryId: "groceries",
      }),
      transaction("other-merchant", "2026-05-08T08:00:00Z", -3000, "Kiwi", { categoryId: "groceries" }),
      transaction("other-category", "2026-05-09T08:00:00Z", -3500, "Rema 1000", { categoryId: "housing" }),
      transaction("outside-date", "2026-06-01T08:00:00Z", -3000, "Rema 1000", { categoryId: "groceries" }),
      transaction("income", "2026-05-10T08:00:00Z", 3000, "Rema 1000", { categoryId: "groceries" }),
    ];

    withDatabase(transactions, (database) => {
      const result = database.queryTransactions(HOUSEHOLD.id, {
        accountId: CHECKING_ACCOUNT.id,
        bookedFromIso: "2026-05-01",
        bookedToIso: "2026-05-31",
        merchant: "rema",
        amountFromMinor: -6000,
        amountToMinor: -2000,
        categoryId: "groceries",
        transactionType: "expenses",
        sortBy: "amountMinor",
        sortDirection: "asc",
        page: 2,
        pageSize: 1,
      });

      expect(result).toMatchObject({
        totalCount: 2,
        page: 2,
        pageSize: 1,
      });
      expect(result.transactions.map((item) => item.id)).toEqual(["rema-new"]);
    });
  });

  it("matches Unicode merchant text and aliases without loading unrelated transactions", () => {
    withDatabase([
      transaction("salary", "2026-05-01T08:00:00Z", 50000, "Lønn AS", { merchantAlias: "arbeidsgiver" }),
      transaction("groceries", "2026-05-02T08:00:00Z", -5000, "Kiwi", { categoryId: "groceries" }),
    ], (database) => {
      expect(database.queryTransactions(HOUSEHOLD.id, { merchant: "lønn" }).transactions.map((item) => item.id))
        .toEqual(["salary"]);
      expect(database.queryTransactions(HOUSEHOLD.id, { merchant: "ARBEIDSGIVER" }).transactions.map((item) => item.id))
        .toEqual(["salary"]);
    });
  });

  it("sorts account and category columns by their displayed labels", () => {
    withDatabase([
      transaction("uncategorized-checking", "2026-05-01T08:00:00Z", -1000, "Uncategorized", {
        accountId: CHECKING_ACCOUNT.id,
      }),
      transaction("groceries-savings", "2026-05-02T08:00:00Z", -2000, "Groceries", {
        accountId: SAVINGS_ACCOUNT.id,
        categoryId: "groceries",
      }),
      transaction("housing-checking", "2026-05-03T08:00:00Z", -3000, "Housing", {
        accountId: CHECKING_ACCOUNT.id,
        categoryId: "housing",
      }),
    ], (database) => {
      const accountSorted = database.queryTransactions(HOUSEHOLD.id, {
        sortBy: "accountId",
        sortDirection: "asc",
        pageSize: 10,
      });
      const categorySorted = database.queryTransactions(HOUSEHOLD.id, {
        sortBy: "categoryId",
        sortDirection: "asc",
        pageSize: 10,
      });

      expect(accountSorted.transactions.map((item) => item.id)).toEqual([
        "housing-checking",
        "uncategorized-checking",
        "groceries-savings",
      ]);
      expect(categorySorted.transactions.map((item) => item.id)).toEqual([
        "groceries-savings",
        "housing-checking",
        "uncategorized-checking",
      ]);
    });
  });

  it("returns uncategorized rows oldest-first with transaction ID tie-breaking", () => {
    withDatabase([
      transaction("newest", "2026-05-31T08:00:00Z", -3000, "Newest"),
      transaction("same-date-z", "2026-05-30T08:00:00Z", -2000, "Same date Z"),
      transaction("oldest", "2026-05-29T08:00:00Z", -1000, "Oldest"),
      transaction("same-date-a", "2026-05-30T23:00:00Z", -2500, "Same date A"),
      transaction("categorized", "2026-05-28T08:00:00Z", -500, "Categorized", { categoryId: "transport" }),
    ], (database) => {
      expect(database.listUncategorizedTransactions(HOUSEHOLD.id).map((item) => item.id)).toEqual([
        "oldest",
        "same-date-a",
        "same-date-z",
        "newest",
      ]);
    });
  });

  it("returns only the requested page for a 10,001-transaction ledger", () => {
    const transactions = Array.from({ length: 10_001 }, (_, index) => transaction(
      `synthetic-${String(index).padStart(5, "0")}`,
      `2026-05-${String((index % 28) + 1).padStart(2, "0")}T08:00:00Z`,
      index % 2 === 0 ? 125 : -125,
      `Synthetic merchant ${index % 100}`,
      { categoryId: "groceries" }
    ));

    withDatabase(transactions, (database) => {
      const result = database.queryTransactions(HOUSEHOLD.id, { page: 2, pageSize: 50 });

      expect(result).toMatchObject({ totalCount: 10_001, page: 2, pageSize: 50 });
      expect(result.transactions).toHaveLength(50);
    });
  });
});