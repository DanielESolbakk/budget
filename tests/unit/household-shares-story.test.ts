import { describe, expect, it } from "vitest";
import {
  defaultHouseholdShare,
  validateHouseholdShare,
  validateLoanResponsibilityShareUpdate,
  validatePropertyOwnershipShareUpdate,
} from "../../src/domain/householdShareValidation.js";

describe("household share contract", () => {
  it.each([0, 7_500, 10_000])("accepts integer share %i", (value) => {
    expect(validateHouseholdShare(value, "Share")).toBe(value);
  });

  it("defaults a missing share to 10000", () => {
    expect(defaultHouseholdShare(undefined, "Share")).toBe(10_000);
  });

  it.each([-1, 10_001, 5_000.5, NaN, Infinity, null, "", "5000"])(
    "rejects invalid share %s",
    (value) => {
      expect(() => validateHouseholdShare(value, "Share")).toThrow(/whole number from 0 to 10000/);
    }
  );

  it("validates ownership and responsibility updates without coupling their values", () => {
    expect(validatePropertyOwnershipShareUpdate({
      propertyId: "home", ownershipShareBasisPoints: 7_500,
    })).toEqual({ propertyId: "home", ownershipShareBasisPoints: 7_500 });
    expect(validateLoanResponsibilityShareUpdate({
      loanId: "mortgage", responsibilityShareBasisPoints: 5_000,
    })).toEqual({ loanId: "mortgage", responsibilityShareBasisPoints: 5_000 });
    expect(() => validatePropertyOwnershipShareUpdate({ propertyId: "home" })).toThrow();
    expect(() => validateLoanResponsibilityShareUpdate({ loanId: "", responsibilityShareBasisPoints: 5_000 })).toThrow();
  });
});
