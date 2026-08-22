import { describe, expect, it } from "vitest";
import {
  validateManualEntryInput,
  ManualEntryValidationException,
  type ManualEntryInput,
} from "../../../src/domain/types.js";

const validInput: ManualEntryInput = {
  householdId: "hh-1",
  accountId: "acc-1",
  bookedAtIso: "2026-05-23",
  amountMinor: -1250,
  merchantRaw: "Kiwi Stavanger",
  categoryId: "groceries",
};

describe("validateManualEntryInput", () => {
  it("returns the input unchanged for a fully valid entry", () => {
    const result = validateManualEntryInput(validInput);
    expect(result).toStrictEqual(validInput);
  });

  it("accepts a bookedAtIso with full ISO 8601 datetime", () => {
    const result = validateManualEntryInput({
      ...validInput,
      bookedAtIso: "2026-05-23T10:30:00Z",
    });
    expect(result.bookedAtIso).toBe("2026-05-23T10:30:00Z");
  });

  it("accepts a negative amountMinor (expense)", () => {
    expect(() => validateManualEntryInput({ ...validInput, amountMinor: -50000 })).not.toThrow();
  });

  it("accepts a zero amountMinor", () => {
    expect(() => validateManualEntryInput({ ...validInput, amountMinor: 0 })).not.toThrow();
  });

  it("accepts a positive amountMinor (income)", () => {
    expect(() => validateManualEntryInput({ ...validInput, amountMinor: 54000 })).not.toThrow();
  });

  it("accepts input without categoryId (optional field)", () => {
    const { categoryId: _c, ...withoutCategory } = validInput;
    expect(() => validateManualEntryInput(withoutCategory)).not.toThrow();
  });

  it("throws INVALID_HOUSEHOLD_ID for empty householdId", () => {
    expect(() =>
      validateManualEntryInput({ ...validInput, householdId: "  " })
    ).toThrow(ManualEntryValidationException);
    expect(() =>
      validateManualEntryInput({ ...validInput, householdId: "" })
    ).toThrow(expect.objectContaining({ code: "INVALID_HOUSEHOLD_ID" }));
  });

  it("throws INVALID_ACCOUNT_ID for empty accountId", () => {
    expect(() =>
      validateManualEntryInput({ ...validInput, accountId: "" })
    ).toThrow(expect.objectContaining({ code: "INVALID_ACCOUNT_ID" }));
  });

  it("throws INVALID_BOOKED_AT_ISO for an invalid date string", () => {
    expect(() =>
      validateManualEntryInput({ ...validInput, bookedAtIso: "not-a-date" })
    ).toThrow(expect.objectContaining({ code: "INVALID_BOOKED_AT_ISO" }));
  });

  it("throws INVALID_BOOKED_AT_ISO for partial date like '2026-13'", () => {
    expect(() =>
      validateManualEntryInput({ ...validInput, bookedAtIso: "2026-13" })
    ).toThrow(expect.objectContaining({ code: "INVALID_BOOKED_AT_ISO" }));
  });

  it("throws INVALID_BOOKED_AT_ISO for an impossible calendar date", () => {
    expect(() =>
      validateManualEntryInput({ ...validInput, bookedAtIso: "2026-02-31" })
    ).toThrow(expect.objectContaining({ code: "INVALID_BOOKED_AT_ISO" }));
  });

  it("throws INVALID_BOOKED_AT_ISO for an invalid time", () => {
    expect(() =>
      validateManualEntryInput({ ...validInput, bookedAtIso: "2026-05-23T99:99:99Z" })
    ).toThrow(expect.objectContaining({ code: "INVALID_BOOKED_AT_ISO" }));
  });

  it("throws INVALID_AMOUNT_MINOR_INTEGER for a non-integer amount", () => {
    expect(() =>
      validateManualEntryInput({ ...validInput, amountMinor: 12.5 })
    ).toThrow(expect.objectContaining({ code: "INVALID_AMOUNT_MINOR_INTEGER" }));
  });

  it("throws INVALID_MERCHANT_RAW for empty merchantRaw", () => {
    expect(() =>
      validateManualEntryInput({ ...validInput, merchantRaw: "  " })
    ).toThrow(expect.objectContaining({ code: "INVALID_MERCHANT_RAW" }));
  });

  it("throws INVALID_CATEGORY_ID for a malformed optional category", () => {
    expect(() =>
      validateManualEntryInput({ ...validInput, categoryId: 123 as unknown as string })
    ).toThrow(expect.objectContaining({ code: "INVALID_CATEGORY_ID" }));
  });

  it("throws INVALID_CATEGORY_ID for a blank optional category", () => {
    expect(() =>
      validateManualEntryInput({ ...validInput, categoryId: "  " })
    ).toThrow(expect.objectContaining({ code: "INVALID_CATEGORY_ID" }));
  });
});
