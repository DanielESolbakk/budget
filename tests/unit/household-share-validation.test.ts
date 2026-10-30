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

  it.each([0, 7_500, 10_000])("retains supplied share %i instead of defaulting it", (value) => {
    expect(defaultHouseholdShare(value, "Share")).toBe(value);
  });

  it.each([-1, 10_001, 5_000.5, NaN, Infinity, null, "", "5000"])(
    "rejects invalid share %s",
    (value) => {
      expect(() => validateHouseholdShare(value, "Share")).toThrow(/whole number from 0 to 10000/);
      expect(() => defaultHouseholdShare(value, "Share")).toThrow(/whole number from 0 to 10000/);
    }
  );

  it.each([null, "home", {}, { propertyId: 7 }, { propertyId: "   " }])(
    "rejects an invalid property identifier with a useful error: %s",
    (input) => {
      expect(() => validatePropertyOwnershipShareUpdate(input)).toThrow(/Choose an existing property/);
    }
  );

  it.each([null, "mortgage", {}, { loanId: 7 }, { loanId: "   " }])(
    "rejects an invalid loan identifier with a useful error: %s",
    (input) => {
      expect(() => validateLoanResponsibilityShareUpdate(input)).toThrow(/Choose an existing loan/);
    }
  );

  it("reports which share is invalid", () => {
    expect(() => validatePropertyOwnershipShareUpdate({
      propertyId: "home", ownershipShareBasisPoints: 10_001,
    })).toThrow(/Property ownership share/);
    expect(() => validateLoanResponsibilityShareUpdate({
      loanId: "mortgage", responsibilityShareBasisPoints: 10_001,
    })).toThrow(/Loan responsibility share/);
  });

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

  it.each([-1, 10_001, 5_000.5])(
    "rejects %s without changing either supplied share",
    (invalid) => {
      const property = { propertyId: "home", ownershipShareBasisPoints: 7_500 };
      const loan = { loanId: "mortgage", responsibilityShareBasisPoints: 5_000 };
      expect(() => validatePropertyOwnershipShareUpdate({ ...property, ownershipShareBasisPoints: invalid })).toThrow();
      expect(validateLoanResponsibilityShareUpdate(loan)).toEqual({
        loanId: "mortgage", responsibilityShareBasisPoints: 5_000,
      });
      expect(() => validateLoanResponsibilityShareUpdate({ ...loan, responsibilityShareBasisPoints: invalid })).toThrow();
      expect(validatePropertyOwnershipShareUpdate(property)).toEqual({
        propertyId: "home", ownershipShareBasisPoints: 7_500,
      });
    }
  );
});
