import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import type { Transaction } from "../../src/domain/types.js";
import {
  buildDashboardViewContract,
  getMonthlyAttentionSummary,
  queryHouseholdDashboardData,
} from "../../src/app/dashboardApi.js";
import { filterTransactions, type TransactionQuery } from "../../src/domain/ledger/filterTransactions.js";
import { queryLedger } from "../../src/app/queryLedger.js";

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
  run: (database: ReturnType<typeof createLocalLedgerDatabase>, dbPath: string) => Result
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
    return run(database, join(directory, "ledger.sqlite"));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("SQLite ledger queries", () => {
  it("matches the report's cross-month dated FX and missing-rate subtotals", () => {
    const entries: Transaction[] = [
      transaction("salary", "2026-01-25T00:15:00+02:00", 300000, "Synthetic salary"),
      transaction("kiwi", "2026-02-01", -50000, "Kiwi Stavanger"),
      { ...transaction("eur", "2026-02-24T23:30:00-02:00", -10000, "Rema 1000"), currencyCode: "EUR" },
      { ...transaction("sek", "2026-02-24", -10000, "Synthetic SEK"), currencyCode: "SEK" },
      transaction("outside", "2026-02-25", -90000, "Outside range"),
      transaction("before", "2026-01-24T23:30:00-02:00", -70000, "Before range"),
    ];
    withDatabase(entries, (database) => {
      database.upsertExchangeRate({
        id: "eur", currencyCode: "EUR", rateNokPerUnit: "11.50",
        effectiveDate: "2026-01-01", kind: "dated", source: "Synthetic", provenance: "manual",
      });
      database.upsertExchangeRate({
        id: "later-eur", currencyCode: "EUR", rateNokPerUnit: "12",
        effectiveDate: "2026-02-25", kind: "dated", source: "Synthetic", provenance: "manual",
      });
      const report = buildDashboardViewContract({
        transactions: entries,
        accounts: database.getAccountsForHousehold(HOUSEHOLD.id),
        rates: database.listExchangeRates(),
        selectedYearMonth: "2026-01",
        reportingPeriodRule: { type: "fixed-day", dayOfMonth: 25 },
      });
      if (report.state === "loading") throw new Error("Expected a resolved report.");
      const filters = { bookedFromIso: "2026-01-25", bookedToIso: "2026-02-24", dateBasis: "booking-date" as const };
      database.saveLedgerView({ id: "report", name: "Report dates", filters });
      const saved = database.listSavedLedgerViews()[0];
      expect(saved?.filters).toEqual(filters);
      const result = queryLedger(database, HOUSEHOLD.id, { ...saved?.filters, pageSize: 2 });
      expect(result.transactions).toHaveLength(2);
      expect(result.totalCount).toBe(4);
      expect(result.summary).toMatchObject({
        incomeMinor: 300000, expenseMinor: 165000, netMinor: 135000,
        incompleteCurrencies: ["SEK"],
      });
      expect(result.summary).toMatchObject({
        incomeMinor: report.snapshot.monthlyTotals.incomeMinor,
        expenseMinor: report.snapshot.monthlyTotals.expenseMinor,
        netMinor: report.snapshot.monthlyTotals.netMinor,
        nativeSubtotals: report.snapshot.currencyReport?.nativeSubtotals,
        incompleteCurrencies: report.snapshot.currencyReport?.incompleteCurrencies,
      });
    });
  });

  it("reconciles all filtered pages with report totals and excludes other dates and households", () => {
    const entries = Array.from({ length: 125 }, (_, index) =>
      transaction(`kiwi-${index}`, "2026-05-15", -100, "Kiwi Stavanger"));
    withDatabase([
      ...entries,
      transaction("salary", "2026-05-01", 300000, "Synthetic salary"),
      transaction("outside", "2026-06-01", -90000, "Kiwi Stavanger"),
      { ...transaction("other-household", "2026-05-15", -70000, "Kiwi Stavanger"), householdId: "other-household" },
    ], (database) => {
      const filters = { bookedFromIso: "2026-05-01", bookedToIso: "2026-05-31" };
      for (const page of [1, 2, 3]) {
        const result = queryLedger(database, HOUSEHOLD.id, { ...filters, page, pageSize: 50, sortBy: "amountMinor", sortDirection: page === 2 ? "asc" : "desc" });
        expect(result.totalCount).toBe(126);
        expect(result.summary).toMatchObject({ incomeMinor: 300000, expenseMinor: 12500, netMinor: 287500, incompleteCurrencies: [] });
      }
      const filtered = queryLedger(database, HOUSEHOLD.id, { ...filters, merchant: "Kiwi", pageSize: 50 });
      expect(filtered.totalCount).toBe(125);
      expect(filtered.summary).toMatchObject({ incomeMinor: 0, expenseMinor: 12500, netMinor: -12500 });
      expect(queryLedger(database, HOUSEHOLD.id, { ...filters, merchant: "absent" }).summary)
        .toMatchObject({ incomeMinor: 0, expenseMinor: 0, netMinor: 0 });
    });
  });

  it("upgrades historical bookings to an indexed numeric value without rewriting their text", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-booking-upgrade-"));
    const dbPath = join(directory, "ledger.sqlite");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE transactions (
        id TEXT PRIMARY KEY, household_id TEXT NOT NULL, account_id TEXT NOT NULL,
        booked_at_iso TEXT NOT NULL, amount_minor INTEGER NOT NULL, merchant_raw TEXT NOT NULL,
        category_id TEXT, import_job_id TEXT
      );
      INSERT INTO transactions VALUES ('bare', 'hh-ledger-query', 'z-account-checking', '1970-01-01', -100, 'Kiwi Stavanger', 'groceries', NULL);
      INSERT INTO transactions VALUES ('offset', 'hh-ledger-query', 'z-account-checking', '1969-12-31T23:00:00-01:00', -200, 'Rema 1000', NULL, NULL);
    `);
    legacy.close();
    let ledger: ReturnType<typeof createLocalLedgerDatabase> | undefined;
    let inspection: DatabaseSync | undefined;
    try {
      ledger = createLocalLedgerDatabase({ dbPath });
      expect(ledger.queryTransactions(HOUSEHOLD.id, {
        bookedFromIso: "1970-01-01T00:00:00Z", bookedToIso: "1970-01-01T00:00:00.000Z",
      }).transactions.map(({ id }) => id).sort()).toEqual(["bare", "offset"]);
      inspection = new DatabaseSync(dbPath);
      expect(inspection.prepare("SELECT id, booked_at_iso, booked_at_millis FROM transactions ORDER BY id").all())
        .toEqual([
          { id: "bare", booked_at_iso: "1970-01-01", booked_at_millis: 0 },
          { id: "offset", booked_at_iso: "1969-12-31T23:00:00-01:00", booked_at_millis: 0 },
        ]);
      inspection.exec(`
        INSERT INTO transactions (id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw)
        VALUES ('older-application', 'hh-ledger-query', 'z-account-checking', '1970-01-02', -100, 'Kiwi');
      `);
      inspection.close();
      inspection = undefined;
      ledger.close();
      ledger = createLocalLedgerDatabase({ dbPath });
      expect(ledger.queryTransactions(HOUSEHOLD.id, { bookedFromIso: "1970-01-01", bookedToIso: "1970-01-01" }).totalCount)
        .toBe(2);
      expect(ledger.queryTransactions(HOUSEHOLD.id, { bookedFromIso: "1970-01-02", bookedToIso: "1970-01-02" }).transactions)
        .toMatchObject([{ id: "older-application", bookedAtIso: "1970-01-02" }]);
    } finally {
      inspection?.close();
      ledger?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls back a booking upgrade with unparseable historical data and releases the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-booking-upgrade-invalid-"));
    const dbPath = join(directory, "ledger.sqlite");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE transactions (
        id TEXT PRIMARY KEY, household_id TEXT NOT NULL, account_id TEXT NOT NULL,
        booked_at_iso TEXT NOT NULL, amount_minor INTEGER NOT NULL, merchant_raw TEXT NOT NULL,
        category_id TEXT, import_job_id TEXT
      );
      INSERT INTO transactions VALUES ('valid', 'hh-ledger-query', 'z-account-checking', '1970-01-01', -100, 'Kiwi', NULL, NULL);
      INSERT INTO transactions VALUES ('invalid', 'hh-ledger-query', 'z-account-checking', 'not-a-date', -100, 'Rema', NULL, NULL);
    `);
    legacy.close();
    let inspection: DatabaseSync | undefined;
    try {
      expect(() => {
        const unexpectedLedger = createLocalLedgerDatabase({ dbPath });
        unexpectedLedger.close();
      }).toThrow("Invalid transaction booking date");
      inspection = new DatabaseSync(dbPath);
      const columns = inspection.prepare("PRAGMA table_info(transactions)").all();
      expect(columns.some(({ name }) => name === "booked_at_millis")).toBe(false);
      expect(inspection.prepare("SELECT id, booked_at_iso FROM transactions ORDER BY id").all()).toEqual([
        { id: "invalid", booked_at_iso: "not-a-date" },
        { id: "valid", booked_at_iso: "1970-01-01" },
      ]);
      inspection.exec("BEGIN EXCLUSIVE; ROLLBACK;");
    } finally {
      inspection?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("updates numeric booking values in append and atomic import paths before reopening", () => {
    withDatabase([], (ledger, dbPath) => {
      expect(ledger.appendTransactions([transaction("append", "1970-01-01", -100, "Kiwi")])).toBe(1);
      expect(ledger.appendImportJobAndTransactions({
        id: "numeric-import", householdId: HOUSEHOLD.id, sourceType: "csv",
        sourceName: "synthetic.csv", startedAtIso: "2026-05-23T00:00:00Z",
      }, [transaction("import", "1969-12-31T23:00:00-01:00", -100, "Rema")])).toBe(1);
      expect(ledger.queryTransactions(HOUSEHOLD.id, {
        bookedFromIso: "1970-01-01T00:00:00.000Z", bookedToIso: "1970-01-01T00:00:00.000Z",
      }).totalCount).toBe(2);
      const inspection = new DatabaseSync(dbPath);
      try {
        expect(inspection.prepare("SELECT id, booked_at_millis FROM transactions ORDER BY id").all()).toEqual([
          { id: "append", booked_at_millis: 0 }, { id: "import", booked_at_millis: 0 },
        ]);
      } finally {
        inspection.close();
      }
    });
  });

  it.each(["not-a-date", "2026-05-23' OR 1=1 --"])("rejects invalid date bounds without SQL interpolation: %s", (value) => {
    withDatabase([], (database) => {
      expect(() => database.queryTransactions(HOUSEHOLD.id, { bookedFromIso: value }))
        .toThrow("Invalid transaction booking date");
      expect(() => database.queryTransactions(HOUSEHOLD.id, { bookedToIso: value, datePreset: "thisMonth" }))
        .toThrow("Invalid transaction booking date");
    });
  });

  it("filters pre-epoch timestamps and the final supported calendar day without rollover", () => {
    withDatabase([
      transaction("pre-epoch", "1969-12-31T23:59:59.999Z", -100, "Pre epoch"),
      transaction("negative-offset", "1969-12-31T23:00:00-01:00", -100, "Negative offset"),
      transaction("fractional", "1970-01-01T00:00:00.0009Z", -100, "Fractional"),
      transaction("last-year", "9999-12-31T23:59:59.999Z", -100, "Last year"),
    ], (database) => {
      expect(database.queryTransactions(HOUSEHOLD.id, {
        bookedFromIso: "1970-01-01T00:00:00Z", bookedToIso: "1970-01-01T00:00:00.000Z",
      }).transactions.map(({ id }) => id).sort()).toEqual(["fractional", "negative-offset"]);
      expect(database.queryTransactions(HOUSEHOLD.id, {
        bookedFromIso: "9999-12-31", bookedToIso: "9999-12-31",
      }).transactions.map(({ id }) => id)).toEqual(["last-year"]);
    });
  });

  const boundaryTransactions = [
    transaction("previous", "2026-05-22T23:59:59.999Z", -100, "Previous"),
    transaction("bare", "2026-05-23", -100, "Bare date"),
    transaction("midnight", "2026-05-23T00:00:00Z", -100, "Midnight"),
    transaction("milliseconds", "2026-05-23T00:00:00.000Z", -100, "Milliseconds"),
    transaction("offset", "2026-05-23T02:00:00+02:00", -100, "Offset"),
    transaction("afternoon", "2026-05-23T12:00:00.123Z", -100, "Afternoon"),
    transaction("last", "2026-05-23T23:59:59.999Z", -100, "Last millisecond"),
    transaction("offset-last", "2026-05-24T01:59:59.999+02:00", -100, "Offset last"),
    transaction("next-bare", "2026-05-24", -100, "Next bare date"),
    transaction("next", "2026-05-24T00:00:00Z", -100, "Next"),
  ];

  it("filters and paginates 10,000 mixed booking representations with exact counts", () => {
    const transactions = Array.from({ length: 1_000 }, (_, index) =>
      boundaryTransactions.map((row) => ({ ...row, id: `bulk-${String(index).padStart(4, "0")}-${row.id}` }))
    ).flat();
    withDatabase(transactions, (database) => {
      expect(database.queryTransactions(HOUSEHOLD.id, {
        bookedFromIso: "2026-05-23", bookedToIso: "2026-05-23",
      }).totalCount).toBe(7_000);
      expect(database.queryTransactions(HOUSEHOLD.id, {
        bookedFromIso: "2026-05-23T00:00:00.000Z", bookedToIso: "2026-05-23T02:00:00+02:00",
      }).totalCount).toBe(4_000);
      const page = database.queryTransactions(HOUSEHOLD.id, {
        bookedFromIso: "2026-05-23", bookedToIso: "2026-05-23",
        merchant: "Midnight", sortBy: "merchantRaw", sortDirection: "asc", page: 2, pageSize: 100,
      });
      expect(page.totalCount).toBe(1_000);
      expect(page.transactions.map(({ id }) => id)).toEqual(
        Array.from({ length: 100 }, (_, index) => `bulk-${String(index + 100).padStart(4, "0")}-midnight`)
      );
    });
  });

  it.each<{ name: string; query: TransactionQuery; expected: string[] }>([
    {
      name: "inclusive calendar From includes every midnight representation",
      query: { bookedFromIso: "2026-05-23" },
      expected: ["afternoon", "bare", "last", "midnight", "milliseconds", "next", "next-bare", "offset", "offset-last"],
    },
    {
      name: "inclusive calendar To excludes next-day bare rows but includes offset instants",
      query: { bookedToIso: "2026-05-23" },
      expected: ["afternoon", "bare", "last", "midnight", "milliseconds", "offset", "offset-last", "previous"],
    },
    {
      name: "calendar-day intersection includes only that UTC day",
      query: { bookedFromIso: "2026-05-23", bookedToIso: "2026-05-23" },
      expected: ["afternoon", "bare", "last", "midnight", "milliseconds", "offset", "offset-last"],
    },
    {
      name: "timestamp From treats offset and midnight encodings as the same instant",
      query: { bookedFromIso: "2026-05-23T02:00:00+02:00" },
      expected: ["afternoon", "bare", "last", "midnight", "milliseconds", "next", "next-bare", "offset", "offset-last"],
    },
    {
      name: "timestamp To with milliseconds includes all same-instant rows",
      query: { bookedToIso: "2026-05-23T00:00:00.000Z" },
      expected: ["bare", "midnight", "milliseconds", "offset", "previous"],
    },
    {
      name: "same-instant timestamp range returns every equivalent midnight",
      query: { bookedFromIso: "2026-05-23T00:00:00Z", bookedToIso: "2026-05-23T02:00:00+02:00" },
      expected: ["bare", "midnight", "milliseconds", "offset"],
    },
    {
      name: "fractional timestamp range preserves exact millisecond boundaries",
      query: { bookedFromIso: "2026-05-23T12:00:00.123Z", bookedToIso: "2026-05-23T12:00:00.123Z" },
      expected: ["afternoon"],
    },
    {
      name: "reversed instant bounds return no rows",
      query: { bookedFromIso: "2026-05-24", bookedToIso: "2026-05-23" },
      expected: [],
    },
  ])("$name", ({ query, expected }) => {
    withDatabase(boundaryTransactions, (database) => {
      const result = database.queryTransactions(HOUSEHOLD.id, query);
      expect(result.transactions.map(({ id }) => id).sort()).toEqual(expected);
      expect(result.totalCount).toBe(expected.length);
      expect(filterTransactions(boundaryTransactions, query).map(({ id }) => id).sort()).toEqual(expected);
      expect(database.loadLedgerSnapshotData().transactions.map(({ id, bookedAtIso }) => ({ id, bookedAtIso })))
        .toEqual([...boundaryTransactions].sort((a, b) => a.id.localeCompare(b.id))
          .map(({ id, bookedAtIso }) => ({ id, bookedAtIso })));
    });
  });

  it("counts before paginating timestamp-equivalent rows without changing stored-text ordering", () => {
    withDatabase(boundaryTransactions, (database) => {
      const query: TransactionQuery = {
        bookedFromIso: "2026-05-23T00:00:00.000Z",
        bookedToIso: "2026-05-23T00:00:00.000Z",
        sortBy: "bookedAtIso", sortDirection: "asc", page: 2, pageSize: 2,
      };
      const page = database.queryTransactions(HOUSEHOLD.id, query);
      expect(page.totalCount).toBe(4);
      expect(page.transactions.map(({ id }) => id)).toEqual(["midnight", "offset"]);
    });
  });

  it.each([
    { now: new Date(2024, 1, 15, 12), first: "2024-02-01", last: "2024-02-29", next: "2024-03-01" },
    { now: new Date(2026, 11, 15, 12), first: "2026-12-01", last: "2026-12-31", next: "2027-01-01" },
  ])("includes bare-date month boundaries for $first through $last", ({ now, first, last, next }) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      withDatabase([
        transaction("first", first, -100, "First"),
        transaction("last", last, -100, "Last"),
        transaction("next", next, -100, "Next"),
      ], (database) => {
        expect(database.queryTransactions(HOUSEHOLD.id, { datePreset: "thisMonth" }).transactions.map(({ id }) => id))
          .toEqual(["last", "first"]);
        expect(database.queryTransactions(HOUSEHOLD.id, {
          datePreset: "thisMonth", bookedFromIso: last, bookedToIso: next,
        }).transactions.map(({ id }) => id)).toEqual(["last"]);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rebuilds NOK history and forecasts from persisted dated rates without changing native ledger amounts", () => {
    withDatabase([
      transaction("april-income", "2026-04-03T08:00:00Z", 10_000, "SYNTHETIC INCOME"),
      transaction("may-nok", "2026-05-20T08:00:00Z", -4200, "SYNTHETIC NOK"),
      { ...transaction("may-gbp", "2026-05-20T08:00:00Z", -7800, "SYNTHETIC GBP"), currencyCode: "GBP" },
    ], (database) => {
      const partial = queryHouseholdDashboardData(database, HOUSEHOLD.id);
      expect(partial.monthlyTotals).toEqual([
        { yearMonth: "2026-04", totalMinor: 10_000 },
        { yearMonth: "2026-05", totalMinor: -4200 },
      ]);
      expect(partial.incompleteCurrencyMonths).toEqual(["2026-05"]);
      database.upsertExchangeRate({
        id: "gbp-rate", currencyCode: "GBP", rateNokPerUnit: "12.5",
        effectiveDate: "2026-05-01", kind: "dated", source: "Synthetic rate", provenance: "manual",
      });
      const complete = queryHouseholdDashboardData(database, HOUSEHOLD.id);
      expect(complete.monthlyTotals).toEqual([
        { yearMonth: "2026-04", totalMinor: 10_000 },
        { yearMonth: "2026-05", totalMinor: -101_700 },
      ]);
      expect(complete.incompleteCurrencyMonths).toEqual([]);
      expect(complete.forecast.entries).toEqual([
        { yearMonth: "2026-06", projectedMinor: -45_850, method: "moving-average-3m" },
        { yearMonth: "2026-07", projectedMinor: -45_850, method: "moving-average-3m" },
        { yearMonth: "2026-08", projectedMinor: -45_850, method: "moving-average-3m" },
      ]);
      expect(database.getTransactionsForMonth(HOUSEHOLD.id, "2026-05").find((row) => row.id === "may-gbp"))
        .toMatchObject({ amountMinor: -7800, currencyCode: "GBP" });
    });
  });

  it("preserves categorization confidence in selected-month dashboard queries", () => {
    const uncertain: Transaction = {
      ...transaction("uncertain", "2026-05-01T00:00:00Z", -1000, "KIWI synthetic", { categoryId: "groceries" }),
      categorization: {
        status: "ambiguous", categoryId: "groceries", confidence: 0.35,
        confidenceLevel: "low", requiresReview: true, matchingRules: [],
      },
    };
    withDatabase([uncertain], (database) => {
      const transactions = database.getTransactionsForMonth(HOUSEHOLD.id, "2026-05");
      expect(transactions[0]?.categorization).toEqual(uncertain.categorization);
      expect(getMonthlyAttentionSummary(buildDashboardViewContract({
        selectedYearMonth: "2026-05", transactions,
      }))).toMatchObject({ categoryReviewCount: 1 });
    });
  });

  it("aggregates dashboard month totals and fills missing months", () => {
    withDatabase([
      transaction("april-expense", "2026-04-03T08:00:00Z", -1200, "April expense"),
      transaction("june-income", "2026-06-01T08:00:00Z", 5000, "June income"),
      transaction("june-expense", "2026-06-20T08:00:00Z", -800, "June expense"),
    ], (database) => {
      expect(database.listMonthlyTotals(HOUSEHOLD.id)).toEqual([
        { yearMonth: "2026-04", totalMinor: -1200 },
        { yearMonth: "2026-05", totalMinor: 0 },
        { yearMonth: "2026-06", totalMinor: 4200 },
      ]);
    });
  });

  it("returns only transactions from the selected dashboard month", () => {
    withDatabase([
      transaction("april", "2026-04-30T23:59:59Z", -100, "April"),
      transaction("may-first", "2026-05-01T00:00:00Z", -200, "May first"),
      transaction("may-last", "2026-05-31T23:59:59Z", 300, "May last"),
      transaction("june", "2026-06-01T00:00:00Z", -400, "June"),
    ], (database) => {
      expect(database.getTransactionsForMonth(HOUSEHOLD.id, "2026-05").map(({ id }) => id)).toEqual([
        "may-first",
        "may-last",
      ]);
    });
  });

  it("returns payday-range transactions with an inclusive start and exclusive next boundary", () => {
    withDatabase([
      transaction("before", "2026-10-28T23:59:59Z", -100, "Before payday"),
      transaction("start", "2026-10-29T00:00:00Z", -200, "Payday"),
      transaction("inside-next-month", "2026-11-25T23:59:59Z", -300, "Inside period"),
      transaction("next-start", "2026-11-26T00:00:00Z", -400, "Next payday"),
    ], (database) => {
      expect(database.getTransactionsForDateRange(
        HOUSEHOLD.id,
        "2026-10-29",
        "2026-11-26"
      ).map(({ id }) => id)).toEqual(["start", "inside-next-month"]);
    });
  });

  it("uses the saved reporting rule to build the complete household dashboard period", async () => {
    const queryHouseholdDashboardView = Reflect.get(
      await import("../../src/app/dashboardApi.js"),
      "queryHouseholdDashboardView"
    );
    expect(queryHouseholdDashboardView).toBeTypeOf("function");
    if (typeof queryHouseholdDashboardView !== "function") return;

    withDatabase([
      transaction("before", "2026-10-28T23:59:59Z", -100, "Before payday"),
      transaction("payday-expense", "2026-10-29T00:00:00Z", -10_000, "Groceries", {
        categoryId: "groceries",
      }),
      transaction("next-month-income", "2026-11-25T23:59:59Z", 50_000, "Salary", {
        categoryId: "salary",
      }),
      transaction("next-payday", "2026-11-26T00:00:00Z", -400, "Next payday"),
    ], (database) => {
      database.saveReportingPeriodRule(HOUSEHOLD.id, { type: "last-weekday", weekday: 4 });

      const view = queryHouseholdDashboardView(database, HOUSEHOLD.id, "2026-10");
      expect(view.state).toBe("ready");
      if (view.state !== "ready") return;
      expect(view.snapshot.reportingPeriodRange).toEqual({
        startDateIso: "2026-10-29",
        endDateExclusiveIso: "2026-11-26",
      });
      expect(view.snapshot.monthlyTotals).toEqual({
        yearMonth: "2026-10",
        incomeMinor: 50_000,
        expenseMinor: 10_000,
        netMinor: 40_000,
      });
      expect(view.snapshot.targetVsActualCategoryRows.rows).toEqual([]);
    });
  });

  it("loads dashboard startup metadata without materializing transactions", () => {
    withDatabase([
      transaction("startup-row", "2026-05-01T08:00:00Z", -100, "Existing transaction"),
    ], (database) => {
      const metadata = database.loadRuntimeMetadata();

      expect(metadata).not.toBeNull();
      expect(metadata).toMatchObject({
        household: HOUSEHOLD,
        accounts: [SAVINGS_ACCOUNT, CHECKING_ACCOUNT],
        monthlyCategoryTargets: [],
        merchantCategoryRules: [],
      });
      expect(metadata).not.toHaveProperty("transactions");
    });
  });

  it("intersects This month with explicit date bounds in SQLite queries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15, 12));

    try {
      withDatabase([
        transaction("september", "2026-09-30T23:59:59Z", -1000, "September"),
        transaction("october-start", "2026-10-01T00:00:00Z", -1000, "October start"),
        transaction("october-end", "2026-10-31T23:59:59Z", -1000, "October end"),
        transaction("november", "2026-11-01T00:00:00Z", -1000, "November"),
      ], (database) => {
        const result = database.queryTransactions(HOUSEHOLD.id, {
          datePreset: "thisMonth",
          bookedFromIso: "2026-09-15",
          bookedToIso: "2026-11-15",
        });

        expect(result.transactions.map((item) => item.id)).toEqual([
          "october-end",
          "october-start",
        ]);
      });
    } finally {
      vi.useRealTimers();
    }
  });

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

  it("returns locally standardized merchant aliases without changing source descriptions", () => {
    withDatabase([
      transaction("merchant-variant", "2026-05-01T08:00:00Z", -1200, "Fjord   Syntetisk AS"),
      transaction("suffix-only", "2026-05-02T08:00:00Z", -1300, "ASA"),
    ], (database) => {
      const transactions = database.queryTransactions(HOUSEHOLD.id, { pageSize: 10 }).transactions;

      expect(transactions.find((item) => item.id === "merchant-variant")).toMatchObject({
        merchantRaw: "Fjord   Syntetisk AS",
        merchantAlias: "FJORD SYNTETISK",
      });
      expect(transactions.find((item) => item.id === "suffix-only")).toMatchObject({
        merchantRaw: "ASA",
        merchantAlias: "",
      });
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