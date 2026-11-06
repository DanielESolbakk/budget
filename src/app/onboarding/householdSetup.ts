import { isCurrencyCode } from "../../domain/types.js";

export interface HouseholdSetupInput {
  householdName: string;
  accountName: string;
  currencyCode: string;
}

function parseNonEmptyName(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  const name = value.trim();
  if (name.length > 100) {
    throw new Error("Household and account names must be 100 characters or fewer.");
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
    throw new Error("currencyCode must be a three-letter currency code.");
  }
  return { householdName, accountName, currencyCode };
}
