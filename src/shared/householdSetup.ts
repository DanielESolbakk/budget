import { isCurrencyCode } from "../domain/types.js";

export interface HouseholdSetupInput {
  householdName: string;
  accountName: string;
  currencyCode: string;
}

export class HouseholdSetupValidationError extends Error {
  constructor(readonly field: keyof HouseholdSetupInput, message: string) {
    super(message);
    this.name = "HouseholdSetupValidationError";
  }
}

function parseNonEmptyName(value: unknown, fieldName: "householdName" | "accountName"): string {
  const label = fieldName === "householdName" ? "household name" : "account name";
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HouseholdSetupValidationError(fieldName, `Enter ${fieldName === "householdName" ? "a" : "an"} ${label}.`);
  }
  const name = value.trim();
  if (name.length > 100) {
    throw new HouseholdSetupValidationError(fieldName, `Use 100 characters or fewer for the ${label}.`);
  }
  return name;
}

export function normalizeHouseholdSetupInput(input: unknown): HouseholdSetupInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Household setup must be an object.");
  }
  const record = input as Record<string, unknown>;
  const householdName = parseNonEmptyName(record.householdName, "householdName");
  const accountName = parseNonEmptyName(record.accountName, "accountName");
  const currencyCode =
    typeof record.currencyCode === "string" ? record.currencyCode.trim().toUpperCase() : "";
  if (!isCurrencyCode(currencyCode)) {
    throw new HouseholdSetupValidationError("currencyCode", "Enter a three-letter currency code, such as NOK.");
  }
  return { householdName, accountName, currencyCode };
}
