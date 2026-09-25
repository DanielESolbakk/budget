import { describe, expect, it } from "vitest";
import {
  CSV_COLUMN_NAMES,
  mapCsvRowToTransaction,
  mapCsvRows,
  previewCsvRows,
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

  it("uses a stable fingerprint when idPrefix is omitted", () => {
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

    expect(mapped.transaction.id).toMatch(/^[a-f0-9]{64}$/);
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
    expect(result.transactions[0]?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(result.transactions[1]?.amountMinor).toBe(10_000);
  });

  it("maps user-selected source headers to canonical transaction fields", () => {
    const row = {
      When: "01.05.2026",
      Payee: "Synthetic merchant",
      "Debit amount": "12.34",
      "Currency code": "NOK",
      "Bank reference": "KID-123",
    };

    const mapped = mapCsvRowToTransaction(row, 0, {
      ...mappingOptions,
      columnMapping: {
        executionDate: "When",
        description: "Payee",
        amountOut: "Debit amount",
        currency: "Currency code",
        reference: "Bank reference",
      },
    });

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.transaction).toMatchObject({
      bookedAtIso: "2026-05-01T00:00:00Z",
      amountMinor: -1234,
      merchantRaw: "Synthetic merchant",
      currencyCode: "NOK",
      sourceReference: "KID-123",
    });
  });

  it("maps documented English CSV header aliases", () => {
    const row = {
      Date: "01.05.2026",
      "Posting Date": "03.05.2026",
      Merchant: "Alias merchant",
      Debit: "45.55",
      Currency: "NOK",
      Reference: "BANK-456",
    };

    const mapped = mapCsvRowToTransaction(row, 0, mappingOptions);

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.transaction).toMatchObject({
      bookedAtIso: "2026-05-03T00:00:00Z",
      amountMinor: -4555,
      merchantRaw: "Alias merchant",
      currencyCode: "NOK",
      sourceReference: "BANK-456",
    });
  });

  it("rejects an amount that overflows finite number parsing", () => {
    const row = withOverrides({
      [CSV_COLUMN_NAMES.amountIn]: "9".repeat(400),
      [CSV_COLUMN_NAMES.amountOut]: "",
    });

    expect(validateCsvRow(row)).toContainEqual(
      expect.objectContaining({
        code: "INVALID_AMOUNT_FORMAT",
        field: CSV_COLUMN_NAMES.amountIn,
      })
    );
  });

  it("returns empty preview collections when the CSV has no data rows", () => {
    expect(previewCsvRows([], mappingOptions)).toEqual({ rows: [], transactions: [] });
  });

  it("keeps preview indexes and transaction references aligned across invalid rows", () => {
    const first = withOverrides({
      [CSV_COLUMN_NAMES.description]: "Same merchant",
      [CSV_COLUMN_NAMES.amountOut]: "10.00",
      [CSV_COLUMN_NAMES.reference]: "BANK-1",
    });
    const invalid = withOverrides({
      [CSV_COLUMN_NAMES.description]: " ",
      [CSV_COLUMN_NAMES.reference]: "INVALID-ROW",
    });
    const last = withOverrides({
      [CSV_COLUMN_NAMES.description]: "Same merchant",
      [CSV_COLUMN_NAMES.amountOut]: "10.00",
      [CSV_COLUMN_NAMES.reference]: "BANK-2",
    });

    const preview = previewCsvRows([first, invalid, last], {
      ...mappingOptions,
      sourceScope: "synthetic.csv",
    });

    expect(preview.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2]);
    expect(preview.rows[0]?.transaction?.sourceReference).toBe("BANK-1");
    expect(preview.rows[1]).toMatchObject({
      rowIndex: 1,
      errors: [expect.objectContaining({ code: "MISSING_DESCRIPTION" })],
    });
    expect(preview.rows[1]?.transaction).toBeUndefined();
    expect(preview.rows[2]?.transaction?.sourceReference).toBe("BANK-2");
    expect(preview.transactions).toHaveLength(2);
    expect(preview.transactions.map((transaction) => transaction.sourceReference)).toEqual([
      "BANK-1",
      "BANK-2",
    ]);
    expect(preview.transactions[0]?.id).not.toBe(preview.transactions[1]?.id);
  });
});
