import { describe, expect, it } from "vitest";
import { buildDashboardViewContract } from "../../src/app/dashboardApi.js";
import {
  CSV_COLUMN_NAMES,
  mapCsvRows,
  mapCsvRowToTransaction,
  validateCsvRow,
} from "../../src/domain/import/csvRowMapper.js";
import {
  buildTransactionsFromFixturePath,
  importFixtureCsv,
} from "../../src/tooling/fixtures/fixtureTransactions.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";

const MAPPING_OPTIONS = {
  householdId: "hh-test",
  accountId: "acc-test",
};

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function makeRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    [CSV_COLUMN_NAMES.executionDate]: "28.05.2026",
    [CSV_COLUMN_NAMES.bookedDate]: "28.05.2026",
    Rentedato: "",
    [CSV_COLUMN_NAMES.description]: "MERCHANT_TEST",
    Type: "Varekjøp",
    Undertype: "Debetkort",
    "Fra konto": "ACCT-001",
    Avsender: "",
    "Til konto": "",
    Mottakernavn: "",
    [CSV_COLUMN_NAMES.amountIn]: "",
    [CSV_COLUMN_NAMES.amountOut]: "-12.50",
    [CSV_COLUMN_NAMES.currency]: "NOK",
    [CSV_COLUMN_NAMES.status]: "Bokført",
    [CSV_COLUMN_NAMES.reference]: "",
    ...overrides,
  };
}

describe("csv import contract", () => {
  describe("AC-1: stable supported-row mapping and validation surface", () => {
    it("maps a valid expense row to a Transaction with correct fields", () => {
      const result = mapCsvRowToTransaction(makeRow(), 0, MAPPING_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.transaction.householdId).toBe("hh-test");
      expect(result.transaction.accountId).toBe("acc-test");
      expect(result.transaction.bookedAtIso).toBe("2026-05-28T00:00:00Z");
      expect(result.transaction.amountMinor).toBe(-1250);
      expect(result.transaction.merchantRaw).toBe("MERCHANT_TEST");
    });

    it("maps a valid income row with Beløp inn to a positive amountMinor", () => {
      const result = mapCsvRowToTransaction(
        makeRow({ [CSV_COLUMN_NAMES.amountIn]: "50000.00", [CSV_COLUMN_NAMES.amountOut]: "" }),
        0,
        MAPPING_OPTIONS
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transaction.amountMinor).toBe(5000000);
    });

    it("falls back to Utført dato when Bokført dato is empty", () => {
      const result = mapCsvRowToTransaction(
        makeRow({ [CSV_COLUMN_NAMES.bookedDate]: "" }),
        0,
        MAPPING_OPTIONS
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transaction.bookedAtIso).toBe("2026-05-28T00:00:00Z");
    });

    it("treats Beløp inn = 0.00 as absent and maps Beløp ut correctly", () => {
      const result = mapCsvRowToTransaction(
        makeRow({ [CSV_COLUMN_NAMES.amountIn]: "0.00", [CSV_COLUMN_NAMES.amountOut]: "-350.00" }),
        0,
        MAPPING_OPTIONS
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transaction.amountMinor).toBe(-35000);
    });

    it("assigns zero amountMinor when both amount fields are empty", () => {
      const result = mapCsvRowToTransaction(
        makeRow({ [CSV_COLUMN_NAMES.amountIn]: "", [CSV_COLUMN_NAMES.amountOut]: "" }),
        0,
        MAPPING_OPTIONS
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transaction.amountMinor).toBe(0);
    });

    it("sets importJobId when provided in options", () => {
      const result = mapCsvRowToTransaction(makeRow(), 0, {
        ...MAPPING_OPTIONS,
        importJobId: "job-42",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transaction.importJobId).toBe("job-42");
    });

    it("uses idPrefix and rowIndex to build the transaction id", () => {
      const result = mapCsvRowToTransaction(makeRow(), 4, {
        ...MAPPING_OPTIONS,
        idPrefix: "test-import",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transaction.id).toBe("test-import-5");
    });

    it("returns INVALID_DATE_FORMAT for a malformed date", () => {
      const errors = validateCsvRow(
        makeRow({ [CSV_COLUMN_NAMES.executionDate]: "not-a-date", [CSV_COLUMN_NAMES.bookedDate]: "" })
      );

      expect(errors.some((e) => e.code === "INVALID_DATE_FORMAT")).toBe(true);
    });

    it("returns INVALID_DATE_FORMAT for an impossible calendar date", () => {
      const errors = validateCsvRow(
        makeRow({ [CSV_COLUMN_NAMES.executionDate]: "31.02.2026", [CSV_COLUMN_NAMES.bookedDate]: "" })
      );

      expect(errors.some((e) => e.code === "INVALID_DATE_FORMAT")).toBe(true);
    });

    it("returns MISSING_DATE when both date fields are absent", () => {
      const errors = validateCsvRow(
        makeRow({ [CSV_COLUMN_NAMES.executionDate]: "", [CSV_COLUMN_NAMES.bookedDate]: "" })
      );

      expect(errors.some((e) => e.code === "MISSING_DATE")).toBe(true);
    });

    it("returns MISSING_DESCRIPTION when Beskrivelse is empty", () => {
      const errors = validateCsvRow(makeRow({ [CSV_COLUMN_NAMES.description]: "" }));

      expect(errors.some((e) => e.code === "MISSING_DESCRIPTION")).toBe(true);
    });

    it("returns explicit validation errors when required headers are missing from the row shape", () => {
      const rowWithoutRequiredHeaders = {
        Type: "Varekjøp",
        Undertype: "Debetkort",
        [CSV_COLUMN_NAMES.amountOut]: "-12.50",
      } as Record<string, string>;

      const errors = validateCsvRow(rowWithoutRequiredHeaders);

      expect(errors.some((e) => e.code === "MISSING_DATE")).toBe(true);
      expect(errors.some((e) => e.code === "MISSING_DESCRIPTION")).toBe(true);
    });

    it("returns AMBIGUOUS_AMOUNT when both Beløp inn and Beløp ut are non-zero", () => {
      const errors = validateCsvRow(
        makeRow({ [CSV_COLUMN_NAMES.amountIn]: "100.00", [CSV_COLUMN_NAMES.amountOut]: "-50.00" })
      );

      expect(errors.some((e) => e.code === "AMBIGUOUS_AMOUNT")).toBe(true);
    });

    it("returns INVALID_AMOUNT_FORMAT for a non-numeric amount", () => {
      const errors = validateCsvRow(makeRow({ [CSV_COLUMN_NAMES.amountOut]: "not-a-number" }));

      expect(errors.some((e) => e.code === "INVALID_AMOUNT_FORMAT")).toBe(true);
    });

    it("mapCsvRows returns no partial record set when any row is invalid", () => {
      const validRow = makeRow();
      const invalidRow = makeRow({ [CSV_COLUMN_NAMES.executionDate]: "", [CSV_COLUMN_NAMES.bookedDate]: "" });
      const result = mapCsvRows([validRow, invalidRow, validRow], MAPPING_OPTIONS);

      expect(result.transactions).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.rowIndex).toBe(1);
    });

    it("mapCsvRows returns empty skipped array when all rows are valid", () => {
      const result = mapCsvRows([makeRow(), makeRow()], MAPPING_OPTIONS);

      expect(result.transactions).toHaveLength(2);
      expect(result.skipped).toEqual([]);
    });
  });

  describe("AC-2: fixture adapter determinism", () => {
    it("buildTransactionsFromFixturePath returns the same result across repeated calls", () => {
      const first = buildTransactionsFromFixturePath(FIXTURE_PATH);
      const second = buildTransactionsFromFixturePath(FIXTURE_PATH);

      expect(first).toEqual(second);
    });

    it("all mapped transactions have the required domain fields", () => {
      const transactions = buildTransactionsFromFixturePath(FIXTURE_PATH);

      expect(transactions.length).toBeGreaterThan(0);
      for (const tx of transactions) {
        expect(typeof tx.id).toBe("string");
        expect(tx.id.length).toBeGreaterThan(0);
        expect(tx.householdId).toBe("hh-fixture");
        expect(tx.accountId).toBe("acc-fixture");
        expect(typeof tx.amountMinor).toBe("number");
        expect(Number.isInteger(tx.amountMinor)).toBe(true);
        expect(tx.bookedAtIso).toMatch(ISO_DATETIME_PATTERN);
        expect(typeof tx.merchantRaw).toBe("string");
        expect(tx.merchantRaw.length).toBeGreaterThan(0);
      }
    });

    it("importFixtureCsv returns a CsvImportResult covering all fixture rows", () => {
      const result = importFixtureCsv(FIXTURE_PATH);

      expect(result.transactions.length + result.skipped.length).toBeGreaterThan(0);
      expect(result.transactions).toBeInstanceOf(Array);
      expect(result.skipped).toBeInstanceOf(Array);
      expect(result.skipped).toEqual([]);
    });

    it("importFixtureCsv respects custom householdId and accountId options", () => {
      const result = importFixtureCsv(FIXTURE_PATH, {
        householdId: "hh-custom",
        accountId: "acc-custom",
      });

      expect(result.transactions.every((tx) => tx.householdId === "hh-custom")).toBe(true);
      expect(result.transactions.every((tx) => tx.accountId === "acc-custom")).toBe(true);
    });

    it("importFixtureCsv with importJobId propagates the id to all transactions", () => {
      const result = importFixtureCsv(FIXTURE_PATH, { importJobId: "job-fixture-01" });

      expect(result.transactions.every((tx) => tx.importJobId === "job-fixture-01")).toBe(true);
    });

    it("transaction ids from the fixture are unique", () => {
      const transactions = buildTransactionsFromFixturePath(FIXTURE_PATH);
      const ids = transactions.map((tx) => tx.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it("mapped fixture transactions remain compatible with the dashboard app consumer", () => {
      const transactions = buildTransactionsFromFixturePath(FIXTURE_PATH);
      const contract = buildDashboardViewContract({
        transactions,
        selectedYearMonth: "2026-05",
      });

      expect(contract.state).toBe("ready");
      if (contract.state !== "ready") return;

      expect(contract.snapshot.selectedYearMonth).toBe("2026-05");
      expect(contract.snapshot.monthlyTotals.yearMonth).toBe("2026-05");
      expect(contract.snapshot.categoryBreakdown.entries.length).toBeGreaterThan(0);
    });
  });

  describe("Regression guard: amount-sign, date, and header defects", () => {
    it("regression: Beløp ut stored as positive value is mapped to negative amountMinor", () => {
      // Defect guard: some CSV exports omit the negative sign on Beløp ut, so
      // the mapper must normalise to negative regardless of the sign in the source.
      const resultPositive = mapCsvRowToTransaction(
        makeRow({ [CSV_COLUMN_NAMES.amountOut]: "99.00" }),
        0,
        MAPPING_OPTIONS,
      );
      const resultNegative = mapCsvRowToTransaction(
        makeRow({ [CSV_COLUMN_NAMES.amountOut]: "-99.00" }),
        0,
        MAPPING_OPTIONS,
      );

      expect(resultPositive.ok).toBe(true);
      if (!resultPositive.ok) return;
      expect(resultPositive.transaction.amountMinor).toBe(-9900);

      expect(resultNegative.ok).toBe(true);
      if (!resultNegative.ok) return;
      expect(resultNegative.transaction.amountMinor).toBe(-9900);
    });

    it("regression: leap-year date 29.02.2024 is accepted as valid", () => {
      const errors = validateCsvRow(
        makeRow({ [CSV_COLUMN_NAMES.executionDate]: "29.02.2024", [CSV_COLUMN_NAMES.bookedDate]: "" }),
      );

      expect(errors.filter((e) => e.code === "INVALID_DATE_FORMAT")).toHaveLength(0);
    });

    it("regression: non-leap-year date 29.02.2026 is rejected with INVALID_DATE_FORMAT", () => {
      const errors = validateCsvRow(
        makeRow({ [CSV_COLUMN_NAMES.executionDate]: "29.02.2026", [CSV_COLUMN_NAMES.bookedDate]: "" }),
      );

      expect(errors.some((e) => e.code === "INVALID_DATE_FORMAT")).toBe(true);
    });

    it("regression: amount with comma separator is rejected with INVALID_AMOUNT_FORMAT", () => {
      // Defect guard: some CSV exports use comma as the decimal separator; the
      // mapper must reject "12,50" rather than silently coercing it to a NaN result.
      const errors = validateCsvRow(
        makeRow({ [CSV_COLUMN_NAMES.amountOut]: "12,50" }),
      );

      expect(errors.some((e) => e.code === "INVALID_AMOUNT_FORMAT")).toBe(true);
    });

    it("regression: missing Beskrivelse header produces MISSING_DESCRIPTION not an uncaught exception", () => {
      const rowMissingDescription: Record<string, string> = {
        [CSV_COLUMN_NAMES.executionDate]: "28.05.2026",
        [CSV_COLUMN_NAMES.bookedDate]: "28.05.2026",
        [CSV_COLUMN_NAMES.amountOut]: "-10.00",
        [CSV_COLUMN_NAMES.currency]: "NOK",
        [CSV_COLUMN_NAMES.status]: "Bokført",
      };

      const errors = validateCsvRow(rowMissingDescription);

      expect(errors.some((e) => e.code === "MISSING_DESCRIPTION")).toBe(true);
    });
  });
});
