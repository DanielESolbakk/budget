import type { LoanResponsibilityShareUpdateInput, PropertyOwnershipShareUpdateInput } from "./types.js";

export const DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS = 10_000;

export function isHouseholdShare(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000;
}

export function validateHouseholdShare(value: unknown, label: string): number {
  if (!isHouseholdShare(value)) {
    throw new Error(`${label} must be a whole number from 0 to 10000 basis points.`);
  }
  return value;
}

export function defaultHouseholdShare(value: unknown, label: string): number {
  return value === undefined
    ? DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS
    : validateHouseholdShare(value, label);
}

export function validatePropertyOwnershipShareUpdate(input: unknown): PropertyOwnershipShareUpdateInput {
  if (typeof input !== "object" || input === null || !("propertyId" in input) ||
      typeof input.propertyId !== "string" || input.propertyId.trim().length === 0) {
    throw new Error("Choose an existing property.");
  }
  return {
    propertyId: input.propertyId,
    ownershipShareBasisPoints: validateHouseholdShare(
      "ownershipShareBasisPoints" in input ? input.ownershipShareBasisPoints : undefined,
      "Property ownership share"
    ),
  };
}

export function validateLoanResponsibilityShareUpdate(input: unknown): LoanResponsibilityShareUpdateInput {
  if (typeof input !== "object" || input === null || !("loanId" in input) ||
      typeof input.loanId !== "string" || input.loanId.trim().length === 0) {
    throw new Error("Choose an existing loan.");
  }
  return {
    loanId: input.loanId,
    responsibilityShareBasisPoints: validateHouseholdShare(
      "responsibilityShareBasisPoints" in input ? input.responsibilityShareBasisPoints : undefined,
      "Loan responsibility share"
    ),
  };
}
