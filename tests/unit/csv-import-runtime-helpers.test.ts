import { describe, expect, it } from "vitest";
import {
  buildCsvImportRequest,
  normalizeCsvImportErrors,
  type CsvImportFailure,
  type CsvImportRequest,
  type CsvImportSuccess,
} from "../../src/app/import/importCsv.js";
import { CSV_COLUMN_NAMES } from "../../src/domain/import/csvRowMapper.js";

describe("csv-import-runtime-helpers", () => {
  describe("AC-1: buildCsvImportRequest normalizes supported input parameters", () => {
    it("returns a request with trimmed filePath, householdId, and accountId", () => {
      const request: CsvImportRequest = buildCsvImportRequest("  /path/to/file.csv  ", {
        householdId: "hh-test",
        accountId: "acc-test",
      });

      expect(request.filePath).toBe("/path/to/file.csv");
      expect(request.householdId).toBe("hh-test");
      expect(request.accountId).toBe("acc-test");
    });

    it("preserves householdId and accountId exactly as provided", () => {
      const request = buildCsvImportRequest("/some/path.csv", {
        householdId: "hh-abc-123",
        accountId: "acc-xyz-456",
      });

      expect(request.householdId).toBe("hh-abc-123");
      expect(request.accountId).toBe("acc-xyz-456");
    });

    it("returns an object with the required request fields", () => {
      const request = buildCsvImportRequest("/some/path.csv", {
        householdId: "hh-1",
        accountId: "acc-1",
      });

      expect(Object.keys(request)).toEqual(
        expect.arrayContaining(["filePath", "householdId", "accountId"])
      );
    });
  });

  describe("AC-1: buildCsvImportRequest rejects invalid input with explicit errors", () => {
    it("throws when filePath is empty", () => {
      expect(() =>
        buildCsvImportRequest("  ", { householdId: "hh-1", accountId: "acc-1" })
      ).toThrow("filePath must be a non-empty string");
    });

    it("throws when householdId is empty", () => {
      expect(() =>
        buildCsvImportRequest("/path.csv", { householdId: "  ", accountId: "acc-1" })
      ).toThrow("householdId must be a non-empty string");
    });

    it("throws when accountId is empty", () => {
      expect(() =>
        buildCsvImportRequest("/path.csv", { householdId: "hh-1", accountId: "  " })
      ).toThrow("accountId must be a non-empty string");
    });
  });

  describe("AC-3: normalizeCsvImportErrors produces stable error payload shape", () => {
    it("returns ok=false with errors array matching the skipped input", () => {
      const skipped = [
        {
          rowIndex: 0,
          errors: [
            {
              code: "MISSING_DATE" as const,
              message: "Row must have either Utført dato or Bokført dato.",
              field: CSV_COLUMN_NAMES.executionDate,
            },
          ],
        },
      ];

      const result: CsvImportFailure = normalizeCsvImportErrors(skipped);

      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.rowIndex).toBe(0);
      expect(result.errors[0]!.codes).toContain("MISSING_DATE");
      expect(result.errors[0]!.fields).toContain(CSV_COLUMN_NAMES.executionDate);
      expect(result.errors[0]!.messages).toHaveLength(1);
    });

    it("maps multiple errors from a single row into parallel codes, fields, and messages arrays", () => {
      const skipped = [
        {
          rowIndex: 2,
          errors: [
            {
              code: "MISSING_DATE" as const,
              message: "Row must have either Utført dato or Bokført dato.",
              field: CSV_COLUMN_NAMES.executionDate,
            },
            {
              code: "MISSING_DESCRIPTION" as const,
              message: "Row must have a non-empty Beskrivelse.",
              field: CSV_COLUMN_NAMES.description,
            },
          ],
        },
      ];

      const result = normalizeCsvImportErrors(skipped);

      expect(result.errors[0]!.rowIndex).toBe(2);
      expect(result.errors[0]!.codes).toEqual(["MISSING_DATE", "MISSING_DESCRIPTION"]);
      expect(result.errors[0]!.fields).toEqual([
        CSV_COLUMN_NAMES.executionDate,
        CSV_COLUMN_NAMES.description,
      ]);
    });

    it("maps multiple skipped rows into one error entry each", () => {
      const skipped = [
        {
          rowIndex: 1,
          errors: [{ code: "MISSING_DATE" as const, message: "msg", field: "f" }],
        },
        {
          rowIndex: 3,
          errors: [{ code: "MISSING_DESCRIPTION" as const, message: "msg2", field: "f2" }],
        },
      ];

      const result = normalizeCsvImportErrors(skipped);

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]!.rowIndex).toBe(1);
      expect(result.errors[1]!.rowIndex).toBe(3);
    });

    it("returns empty errors array when skipped is empty", () => {
      const result = normalizeCsvImportErrors([]);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([]);
    });

    it("result is assignable to CsvImportFailure discriminated union shape", () => {
      const result = normalizeCsvImportErrors([]);

      // Type assertion verifies shape remains compatible with the union.
      const typed: CsvImportFailure = result;
      expect(typed.ok).toBe(false);
    });

    it("CsvImportSuccess shape has ok=true with importJobId and transactionCount", () => {
      const success: CsvImportSuccess = {
        ok: true,
        importJobId: "job-123",
        transactionCount: 42,
      };

      expect(success.ok).toBe(true);
      expect(success.importJobId).toBe("job-123");
      expect(success.transactionCount).toBe(42);
    });
  });

  describe("AC-1/AC-3: helper output contracts are compatible with CSV row-mapping interfaces", () => {
    it("normalizeCsvImportErrors error codes match CsvRowValidationErrorCode values", () => {
      const validCodes = [
        "MISSING_DATE",
        "INVALID_DATE_FORMAT",
        "MISSING_DESCRIPTION",
        "AMBIGUOUS_AMOUNT",
        "INVALID_AMOUNT_FORMAT",
      ];

      const skipped = validCodes.map((code, i) => ({
        rowIndex: i,
        errors: [{ code: code as never, message: "msg", field: "field" }],
      }));

      const result = normalizeCsvImportErrors(skipped);

      expect(result.errors).toHaveLength(validCodes.length);
      for (let i = 0; i < validCodes.length; i++) {
        expect(result.errors[i]!.codes).toContain(validCodes[i]);
      }
    });
  });
});
