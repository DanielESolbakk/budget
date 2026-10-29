import { describe, expect, it } from "vitest";
import {
  HoldingRecordValidationError,
  validateHoldingRecordInput,
  validateHoldingValuationInput,
} from "../../src/domain/holdingRecordValidation.js";

function getValidationError(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected invalid holding input to be rejected.");
}

describe("holding record validation", () => {
  it("retains a valid holding and valuation's quantities, amounts, dates, and currencies", () => {
    const holding = Object.freeze({
      label: "  Global fund  ",
      quantity: 10,
      costBasisMinor: 1_000_000,
      currencyCode: "EUR",
    });
    const originalHolding = { ...holding };
    const valuation = Object.freeze({
      holdingId: "holding-global-fund",
      effectiveDateIso: "2026-10-01",
      amountMinor: 1_100_000,
      currencyCode: "EUR",
    });
    const originalValuation = { ...valuation };

    expect(validateHoldingRecordInput(holding)).toEqual({
      ...holding,
      label: "Global fund",
    });
    expect(holding).toEqual(originalHolding);
    expect(validateHoldingValuationInput(valuation)).toEqual(valuation);
    expect(valuation).toEqual(originalValuation);
  });

  it("rejects a blank holding label with a label-specific error", () => {
    const error = getValidationError(() =>
      validateHoldingRecordInput({
        label: "   ",
        quantity: 10,
        costBasisMinor: 1_000_000,
        currencyCode: "EUR",
      })
    );

    expect(error).toBeInstanceOf(HoldingRecordValidationError);
    expect(error).toMatchObject({ field: "label" });
  });

  it("rejects a negative quantity with a quantity-specific error", () => {
    const error = getValidationError(() =>
      validateHoldingRecordInput({
        label: "Global fund",
        quantity: -1,
        costBasisMinor: 1_000_000,
        currencyCode: "EUR",
      })
    );

    expect(error).toBeInstanceOf(HoldingRecordValidationError);
    expect(error).toMatchObject({ field: "quantity" });
  });

  it("rejects a negative cost basis with a cost-basis-specific error", () => {
    const error = getValidationError(() =>
      validateHoldingRecordInput({
        label: "Global fund",
        quantity: 10,
        costBasisMinor: -1,
        currencyCode: "EUR",
      })
    );

    expect(error).toBeInstanceOf(HoldingRecordValidationError);
    expect(error).toMatchObject({ field: "costBasisMinor" });
  });

  it("rejects a negative valuation with an amount-specific error", () => {
    const error = getValidationError(() =>
      validateHoldingValuationInput({
        holdingId: "holding-global-fund",
        effectiveDateIso: "2026-10-01",
        amountMinor: -1,
        currencyCode: "EUR",
      })
    );

    expect(error).toBeInstanceOf(HoldingRecordValidationError);
    expect(error).toMatchObject({ field: "amountMinor" });
  });

  it("rejects an impossible valuation date with a date-specific error", () => {
    const error = getValidationError(() =>
      validateHoldingValuationInput({
        holdingId: "holding-global-fund",
        effectiveDateIso: "2026-02-30",
        amountMinor: 1_100_000,
        currencyCode: "EUR",
      })
    );

    expect(error).toBeInstanceOf(HoldingRecordValidationError);
    expect(error).toMatchObject({ field: "effectiveDateIso" });
  });

  it("rejects a malformed holding currency with a currency-specific error", () => {
    const error = getValidationError(() =>
      validateHoldingRecordInput({
        label: "Global fund",
        quantity: 10,
        costBasisMinor: 1_000_000,
        currencyCode: "EURO",
      })
    );

    expect(error).toBeInstanceOf(HoldingRecordValidationError);
    expect(error).toMatchObject({ field: "currencyCode" });
  });

  it("reports all invalid holding fields from one submitted form", () => {
    const error = getValidationError(() =>
      validateHoldingRecordInput({
        label: "   ",
        quantity: -1,
        costBasisMinor: 1_000_000,
        currencyCode: "EUR",
      })
    );

    expect(error).toBeInstanceOf(HoldingRecordValidationError);
    expect(error).toMatchObject({
      field: "label",
      fieldErrors: {
        label: "Enter a holding label.",
        quantity: "Enter a positive quantity.",
      },
    });
  });
});
