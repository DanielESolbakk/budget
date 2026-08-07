import { describe, expect, it } from "vitest";
import {
  CSV_COLUMN_NAMES,
  mapCsvRowToTransaction,
  mapCsvRows,
  validateCsvRow,
  type CsvRowMappingOptions,
} from "../../src/domain/import/csvRowMapper.js";

type SupportedCsvRow = Record<(typeof CSV_COLUMN_NAMES)[keyof typeof CSV_COLUMN_NAMES], string>;

const baseRow: SupportedCsvRow = {
  [CSV_COLUMN_NAMES.executionDate]: "01.05.2026",
  [CSV_COLUMN_NAMES.bookedDate]: "",
  [CSV_COLUMN_NAMES.description]: "Rema 1000",
  [CSV_COLUMN_NAMES.amountIn]: "",
  [CSV_COLUMN_NAMES.amountOut]: "100.50",
  [CSV_COLUMN_NAMES.currency]: "NOK",
  [CSV_COLUMN_NAMES.status]: "Bokfort",
  [CSV_COLUMN_NAMES.reference]: "",
};

const mappingOptions: CsvRowMappingOptions = {
  householdId: "hh-adversarial",
  accountId: "acc-adversarial",
  idPrefix: "adv",
};

function withOverrides(overrides: Partial<SupportedCsvRow>): SupportedCsvRow {
  return {
    ...baseRow,
    ...overrides,
  };
}

describe("csvRowMapper adversarial edge cases", () => {
  it("rejects iso-style date text that does not match norwegian dd.MM.yyyy format", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.executionDate]: "2026-05-01",
      [CSV_COLUMN_NAMES.bookedDate]: "",
    });

    const errors = validateCsvRow(row);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("INVALID_DATE_FORMAT");
    expect(errors[0]?.field).toBe(CSV_COLUMN_NAMES.executionDate);
  });

  it("prioritizes booked date as date source and reports booked field when booked date is invalid", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.executionDate]: "01.05.2026",
      [CSV_COLUMN_NAMES.bookedDate]: "32.05.2026",
    });

    const errors = validateCsvRow(row);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("INVALID_DATE_FORMAT");
    expect(errors[0]?.field).toBe(CSV_COLUMN_NAMES.bookedDate);
  });

  it("reports missing date when both execution and booked dates are blank", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.executionDate]: "",
      [CSV_COLUMN_NAMES.bookedDate]: "",
    });

    const errors = validateCsvRow(row);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("MISSING_DATE");
    expect(errors[0]?.field).toBe(CSV_COLUMN_NAMES.executionDate);
  });

  it("reports missing description when description is blank after trim", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.description]: "   ",
    });

    const errors = validateCsvRow(row);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("MISSING_DESCRIPTION");
    expect(errors[0]?.field).toBe(CSV_COLUMN_NAMES.description);
  });

  it("rejects non-calendar dates even when format looks valid", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.executionDate]: "29.02.2025",
    });

    const errors = validateCsvRow(row);
    expect(errors.some((error) => error.code === "INVALID_DATE_FORMAT")).toBe(true);
  });

  it("flags invalid amount-in format", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountIn]: "NOK12.25",
      [CSV_COLUMN_NAMES.amountOut]: "",
    });

    const errors = validateCsvRow(row);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("INVALID_AMOUNT_FORMAT");
    expect(errors[0]?.field).toBe(CSV_COLUMN_NAMES.amountIn);
  });

  it("flags comma-decimal amount values as invalid format", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountIn]: "12,25",
      [CSV_COLUMN_NAMES.amountOut]: "",
    });

    const errors = validateCsvRow(row);
    expect(errors.some((error) => error.code === "INVALID_AMOUNT_FORMAT")).toBe(true);
  });

  it("reports multiple validation errors for malformed rows", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.executionDate]: "",
      [CSV_COLUMN_NAMES.bookedDate]: "",
      [CSV_COLUMN_NAMES.description]: "   ",
      [CSV_COLUMN_NAMES.amountIn]: "NOK 10",
      [CSV_COLUMN_NAMES.amountOut]: "",
    });

    const errors = validateCsvRow(row);
    expect(errors.map((error) => error.code)).toEqual([
      "MISSING_DATE",
      "MISSING_DESCRIPTION",
      "INVALID_AMOUNT_FORMAT",
    ]);
  });

  it("does not flag ambiguous amount when both amounts are zero", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountIn]: "0",
      [CSV_COLUMN_NAMES.amountOut]: "0",
    });

    const errors = validateCsvRow(row);
    expect(errors).toEqual([]);

    const mapped = mapCsvRowToTransaction(row, 0, mappingOptions);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }

    expect(mapped.transaction.amountMinor).toBe(0);
  });

  it("flags invalid amount-out format", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountIn]: "",
      [CSV_COLUMN_NAMES.amountOut]: "abc",
    });

    const errors = validateCsvRow(row);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("INVALID_AMOUNT_FORMAT");
    expect(errors[0]?.field).toBe(CSV_COLUMN_NAMES.amountOut);
  });

  it("flags ambiguous amount rows when both amount-in and amount-out are non-zero", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountIn]: "12.25",
      [CSV_COLUMN_NAMES.amountOut]: "5.00",
    });

    const errors = validateCsvRow(row);
    expect(errors.some((error) => error.code === "AMBIGUOUS_AMOUNT")).toBe(true);
  });

  it("normalizes negative amount-out values to negative minor units", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountOut]: "-45.55",
    });

    const mapped = mapCsvRowToTransaction(row, 0, mappingOptions);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }

    expect(mapped.transaction.amountMinor).toBe(-4555);
  });

  it("maps amount-in rows to positive minor units", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountIn]: "125.25",
      [CSV_COLUMN_NAMES.amountOut]: "",
    });

    const mapped = mapCsvRowToTransaction(row, 0, mappingOptions);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }

    expect(mapped.transaction.amountMinor).toBe(12_525);
  });

  it("adds importJobId when mapping options include it", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountOut]: "20.00",
    });

    const mapped = mapCsvRowToTransaction(row, 2, {
      ...mappingOptions,
      importJobId: "job-1",
    });

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }

    expect(mapped.transaction.importJobId).toBe("job-1");
  });

  it("uses default id prefix when idPrefix is omitted", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountOut]: "20.00",
    });

    const mapped = mapCsvRowToTransaction(row, 4, {
      householdId: mappingOptions.householdId,
      accountId: mappingOptions.accountId,
    });

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }

    expect(mapped.transaction.id).toBe("csv-5");
    expect("importJobId" in mapped.transaction).toBe(false);
  });

  it("reports two invalid amount format errors when both amount fields are malformed", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountIn]: "NOK 100",
      [CSV_COLUMN_NAMES.amountOut]: "abc",
    });

    const errors = validateCsvRow(row);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      code: "INVALID_AMOUNT_FORMAT",
      field: CSV_COLUMN_NAMES.amountIn,
    });
    expect(errors[1]).toMatchObject({
      code: "INVALID_AMOUNT_FORMAT",
      field: CSV_COLUMN_NAMES.amountOut,
    });
  });

  it("uses booked date when both execution and booked dates are present", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.executionDate]: "01.05.2026",
      [CSV_COLUMN_NAMES.bookedDate]: "03.05.2026",
      [CSV_COLUMN_NAMES.amountOut]: "10.00",
    });

    const mapped = mapCsvRowToTransaction(row, 1, mappingOptions);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }

    expect(mapped.transaction.bookedAtIso).toBe("2026-05-03T00:00:00Z");
  });

  it("returns no mapped transactions when any row fails validation", () => {
    const valid = withOverrides({
      [CSV_COLUMN_NAMES.description]: "Kiwi",
      [CSV_COLUMN_NAMES.amountOut]: "25.00",
    });
    const invalid = withOverrides({
      [CSV_COLUMN_NAMES.executionDate]: "31.11.2026",
    });

    const result = mapCsvRows([valid, invalid], mappingOptions);
    expect(result.transactions).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.rowIndex).toBe(1);
  });

  it("reports every invalid row index when multiple rows are invalid", () => {
    const invalidA = withOverrides({
      [CSV_COLUMN_NAMES.executionDate]: "",
      [CSV_COLUMN_NAMES.bookedDate]: "",
    });
    const invalidB = withOverrides({
      [CSV_COLUMN_NAMES.amountOut]: "bad-number",
    });

    const result = mapCsvRows([invalidA, invalidB], mappingOptions);
    expect(result.transactions).toEqual([]);
    expect(result.skipped.map((entry) => entry.rowIndex)).toEqual([0, 1]);
  });

  it("returns mapped transactions when all rows are valid", () => {
    const first = withOverrides({
      [CSV_COLUMN_NAMES.description]: "Kiwi",
      [CSV_COLUMN_NAMES.amountOut]: "25.00",
      [CSV_COLUMN_NAMES.amountIn]: "",
    });
    const second = withOverrides({
      [CSV_COLUMN_NAMES.description]: "Lonn",
      [CSV_COLUMN_NAMES.amountIn]: "100.00",
      [CSV_COLUMN_NAMES.amountOut]: "",
    });

    const result = mapCsvRows([first, second], mappingOptions);
    expect(result.skipped).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.id).toBe("adv-1");
    expect(result.transactions[1]?.amountMinor).toBe(10_000);
  });
});
