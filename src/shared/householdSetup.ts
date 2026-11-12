import {
  AccountInputValidationError,
  normalizeAccountInput,
} from "./accountLifecycle.js";

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

function parseHouseholdName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HouseholdSetupValidationError("householdName", "Enter a household name.");
  }
  const name = value.trim();
  if (name.length > 100) {
    throw new HouseholdSetupValidationError(
      "householdName",
      "Use 100 characters or fewer for the household name."
    );
  }
  return name;
}

export function normalizeHouseholdSetupInput(input: unknown): HouseholdSetupInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Household setup must be an object.");
  }
  const record = input as Record<string, unknown>;
  const householdName = parseHouseholdName(record.householdName);
  try {
    return { householdName, ...normalizeAccountInput(record) };
  } catch (error: unknown) {
    if (error instanceof AccountInputValidationError) {
      throw new HouseholdSetupValidationError(error.field, error.message);
    }
    throw error;
  }
}
