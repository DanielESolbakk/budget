import { describe, expect, it } from "vitest";
import {
  LoanRecordValidationError,
  validateLoanBalanceInput,
  validateLoanRecordInput,
} from "../../src/domain/loanRecordValidation.js";

const MORTGAGE = {
  label: "Home mortgage",
  principalMinor: 300_000_000,
  annualInterestRateBasisPoints: 500,
  termMonths: 300,
  paymentAmountMinor: 1_750_000,
  paymentFrequency: "monthly",
  currencyCode: "NOK",
  propertyId: "property-home",
};

function fieldErrorFor(action: () => unknown): LoanRecordValidationError {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof LoanRecordValidationError) return error;
    throw error;
  }
  throw new Error("Expected a loan field validation error.");
}

describe("loan record validation", () => {
  it("retains every entered term for a property-linked mortgage", () => {
    expect(validateLoanRecordInput(MORTGAGE, ["property-home"])).toEqual(MORTGAGE);
  });

  it("accepts an unsecured foreign-currency loan without a property", () => {
    const loan = {
      label: "Personal loan",
      principalMinor: 1_000_000,
      annualInterestRateBasisPoints: 400,
      termMonths: 36,
      paymentAmountMinor: 30_000,
      paymentFrequency: "monthly",
      currencyCode: "EUR",
    };

    expect(validateLoanRecordInput(loan, [])).toEqual(loan);
  });

  it.each([
    ["label", { ...MORTGAGE, label: " " }, ["property-home"]],
    ["principalMinor", { ...MORTGAGE, principalMinor: -1 }, ["property-home"]],
    ["annualInterestRateBasisPoints", { ...MORTGAGE, annualInterestRateBasisPoints: 10_001 }, ["property-home"]],
    ["termMonths", { ...MORTGAGE, termMonths: 0 }, ["property-home"]],
    ["paymentAmountMinor", { ...MORTGAGE, paymentAmountMinor: -1 }, ["property-home"]],
    ["paymentFrequency", { ...MORTGAGE, paymentFrequency: "daily" }, ["property-home"]],
    ["currencyCode", { ...MORTGAGE, currencyCode: "NOKK" }, ["property-home"]],
    ["propertyId", { ...MORTGAGE, propertyId: "property-missing" }, ["property-home"]],
  ])("rejects invalid %s with a field-specific error", (field, input, propertyIds) => {
    expect(fieldErrorFor(() => validateLoanRecordInput(input, propertyIds)).field).toBe(field);
  });
});

describe("loan balance validation", () => {
  it("retains the effective date and entered balance", () => {
    const input = {
      loanId: "loan-home",
      effectiveDateIso: "2026-10-01",
      amountMinor: 300_000_000,
    };

    expect(validateLoanBalanceInput(input)).toEqual(input);
  });

  it.each([
    ["loanId", { loanId: " ", effectiveDateIso: "2026-10-01", amountMinor: 1 }],
    ["effectiveDateIso", { loanId: "loan-home", effectiveDateIso: "2026-02-30", amountMinor: 1 }],
    ["amountMinor", { loanId: "loan-home", effectiveDateIso: "2026-10-01", amountMinor: -1 }],
  ])("rejects invalid dated balance %s with a field-specific error", (field, input) => {
    expect(fieldErrorFor(() => validateLoanBalanceInput(input)).field).toBe(field);
  });
});
