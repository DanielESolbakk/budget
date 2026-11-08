import { describe, expect, it } from "vitest";
import { isIsoCalendarDate, nextYearMonth } from "../../src/domain/date/calendarDate.js";
import { validatePropertyValuationInput } from "../../src/domain/propertyRecordValidation.js";

describe("strict calendar dates", () => {
  it.each([
    ["0000-02-29", true], ["0099-12-31", true], ["1900-02-29", false],
    ["2000-02-29", true], ["2024-02-29", true], ["2025-02-29", false],
    ["2026-04-31", false], ["2026-13-01", false], ["2026-00-01", false],
    ["2026-01-00", false], ["9999-12-31", true], ["10000-01-01", false],
    [" 2026-01-01", false], ["2026-01-01 ", false], ["2026-1-1", false],
    ["2026-01-01T00:00:00Z", false], ["", false], [null, false], [42, false],
  ])("recognizes %j without trimming or calendar rollover", (value, expected) => {
    expect(isIsoCalendarDate(value)).toBe(expected);
  });
  it.each(["0000-02-29", "0099-12-31", "2000-02-29", "2024-02-29", "9999-12-31"])(
    "preserves accepted property valuation date %s",
    (effectiveDateIso) => {
      const input = { propertyId: "synthetic-property", effectiveDateIso, amountMinor: 100, currencyCode: "NOK" };
      expect(validatePropertyValuationInput(input)).toEqual(input);
    }
  );
  it.each(["1900-02-29", "2025-02-29", "2026-04-31", " 2026-01-01", "2026-01-01 ", null, 42])(
    "rejects invalid property valuation date %j",
    (effectiveDateIso) => {
      expect(() => validatePropertyValuationInput({
        propertyId: "synthetic-property", effectiveDateIso, amountMinor: 100, currencyCode: "NOK",
      })).toThrow();
    }
  );

  it.each([["2026-11", "2026-12"], ["2026-12", "2027-01"], ["0099-12", "100-01"]])(
    "increments %s preserving the existing year serialization",
    (value, expected) => expect(nextYearMonth(value)).toBe(expected)
  );
});
