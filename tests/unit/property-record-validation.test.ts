import { describe, expect, it } from "vitest";
import {
  validatePropertyRecordInput,
  validatePropertyValuationCorrectionInput,
  validatePropertyValuationInput,
} from "../../src/domain/propertyRecordValidation.js";

describe("property record validation", () => {
  it("accepts a locally labeled property without an address", () => {
    const input = { label: "Home" };

    expect(validatePropertyRecordInput(input)).toMatchObject({ label: "Home" });
  });

  it("rejects a whitespace-only property label", () => {
    expect(() => validatePropertyRecordInput({ label: "   " })).toThrow();
  });
});

describe("property valuation validation", () => {
  it("preserves the effective date, original amount, and currency", () => {
    const input = {
      propertyId: "property-home",
      effectiveDateIso: "2026-10-01",
      amountMinor: 500_000_000,
      currencyCode: "NOK",
    };

    expect(validatePropertyValuationInput(input)).toMatchObject({
      propertyId: "property-home",
      effectiveDateIso: "2026-10-01",
      amountMinor: 500_000_000,
      currencyCode: "NOK",
    });
  });

  it("accepts a zero valuation", () => {
    expect(
      validatePropertyValuationInput({
        propertyId: "property-home",
        effectiveDateIso: "2026-10-01",
        amountMinor: 0,
        currencyCode: "NOK",
      }).amountMinor
    ).toBe(0);
  });

  it("rejects an impossible effective date", () => {
    expect(() =>
      validatePropertyValuationInput({
        propertyId: "property-home",
        effectiveDateIso: "2026-02-30",
        amountMinor: 500_000_000,
        currencyCode: "NOK",
      })
    ).toThrow();
  });

  it("rejects a negative amount", () => {
    expect(() =>
      validatePropertyValuationInput({
        propertyId: "property-home",
        effectiveDateIso: "2026-10-01",
        amountMinor: -1,
        currencyCode: "NOK",
      })
    ).toThrow();
  });

  it("rejects a malformed currency code", () => {
    expect(() =>
      validatePropertyValuationInput({
        propertyId: "property-home",
        effectiveDateIso: "2026-10-01",
        amountMinor: 500_000_000,
        currencyCode: "NOKK",
      })
    ).toThrow();
  });
});

describe("property valuation correction validation", () => {
  it("accepts a superseding entry that retains its target and replacement value", () => {
    const input = {
      action: "supersede",
      propertyId: "property-home",
      targetValuationId: "valuation-home-original",
      effectiveDateIso: "2026-10-01",
      amountMinor: 480_000_000,
      currencyCode: "NOK",
    };

    expect(validatePropertyValuationCorrectionInput(input)).toEqual(input);
  });

  it("accepts a void entry without replacement amount fields", () => {
    const input = {
      action: "void",
      propertyId: "property-home",
      targetValuationId: "valuation-home-original",
    };

    expect(validatePropertyValuationCorrectionInput(input)).toEqual(input);
  });

  it("rejects a correction without a target valuation", () => {
    expect(() => validatePropertyValuationCorrectionInput({
      action: "void",
      propertyId: "property-home",
      targetValuationId: " ",
    })).toThrow();
  });
});
