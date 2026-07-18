import { describe, expect, it } from "vitest";
import {
  isYearMonth,
  MonthlyCategoryTargetValidationError,
  validateMonthlyCategoryTargetInput,
  validateMonthlyCategoryTargetQuery,
} from "../../src/domain/types.js";

describe("validateMonthlyCategoryTargetInput", () => {
  it("accepts a valid month-category target payload unchanged", () => {
    const input = {
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 12000,
    };

    const validated = validateMonthlyCategoryTargetInput(input);

    expect(validated).toBe(input);
    expect(validated).toEqual(input);
  });

  it("rejects malformed yearMonth with stable validation error shape", () => {
    expect(() =>
      validateMonthlyCategoryTargetInput({
        yearMonth: "2026-13",
        categoryId: "groceries",
        targetMinor: 12000,
      })
    ).toThrowError(
      expect.objectContaining<Partial<MonthlyCategoryTargetValidationError>>({
        name: "MonthlyCategoryTargetValidationError",
        code: "INVALID_TARGET_YEAR_MONTH",
        message: "Invalid target yearMonth: 2026-13",
      })
    );
  });

  it("rejects blank categoryId with stable validation error shape", () => {
    expect(() =>
      validateMonthlyCategoryTargetInput({
        yearMonth: "2026-05",
        categoryId: " ",
        targetMinor: 12000,
      })
    ).toThrowError(
      expect.objectContaining<Partial<MonthlyCategoryTargetValidationError>>({
        name: "MonthlyCategoryTargetValidationError",
        code: "INVALID_TARGET_CATEGORY_ID",
        message: "Target categoryId must be a non-empty string.",
      })
    );
  });

  it("rejects non-integer targetMinor with stable validation error shape", () => {
    expect(() =>
      validateMonthlyCategoryTargetInput({
        yearMonth: "2026-05",
        categoryId: "groceries",
        targetMinor: 1.5,
      })
    ).toThrowError(
      expect.objectContaining<Partial<MonthlyCategoryTargetValidationError>>({
        name: "MonthlyCategoryTargetValidationError",
        code: "INVALID_TARGET_MINOR_INTEGER",
        message: "Target targetMinor must be an integer: 1.5",
      })
    );
  });

  it("rejects negative targetMinor with stable validation error shape", () => {
    expect(() =>
      validateMonthlyCategoryTargetInput({
        yearMonth: "2026-05",
        categoryId: "groceries",
        targetMinor: -1,
      })
    ).toThrowError(
      expect.objectContaining<Partial<MonthlyCategoryTargetValidationError>>({
        name: "MonthlyCategoryTargetValidationError",
        code: "INVALID_TARGET_MINOR_RANGE",
        message: "Target targetMinor must be zero or positive: -1",
      })
    );
  });
});

describe("month-category key validation", () => {
  it("accepts a canonical YYYY-MM month key", () => {
    expect(isYearMonth("2026-05")).toBe(true);
  });

  it("rejects malformed month keys deterministically", () => {
    expect(isYearMonth("2026-5")).toBe(false);
    expect(isYearMonth("2026-13")).toBe(false);
  });

  it("accepts a valid month-category query unchanged", () => {
    const query = {
      yearMonth: "2026-05",
      categoryId: "transport",
    };

    const validated = validateMonthlyCategoryTargetQuery(query);

    expect(validated).toBe(query);
    expect(validated).toEqual(query);
  });

  it("rejects malformed query month key", () => {
    expect(() =>
      validateMonthlyCategoryTargetQuery({
        yearMonth: "2026-13",
        categoryId: "transport",
      })
    ).toThrow("Invalid target query yearMonth: 2026-13");
  });

  it("rejects blank query category key", () => {
    expect(() =>
      validateMonthlyCategoryTargetQuery({
        yearMonth: "2026-05",
        categoryId: " ",
      })
    ).toThrow("Target query categoryId must be a non-empty string.");
  });
});
