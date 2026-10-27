import { isCurrencyCode } from "./types.js";
import type { PropertyRecordInput, PropertyValuationInput } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPropertyRecordInput(
  value: Record<string, unknown>
): value is Record<string, unknown> & PropertyRecordInput {
  return typeof value.label === "string";
}

function isPropertyValuationInput(
  value: Record<string, unknown>
): value is Record<string, unknown> & PropertyValuationInput {
  return (
    typeof value.propertyId === "string" &&
    typeof value.effectiveDateIso === "string" &&
    typeof value.amountMinor === "number" &&
    typeof value.currencyCode === "string"
  );
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validatePropertyRecordInput(input: unknown): PropertyRecordInput {
  if (
    !isRecord(input) ||
    !isPropertyRecordInput(input) ||
    input.label.trim().length === 0
  ) {
    throw new Error("Property label must be a non-empty string.");
  }
  return input;
}

export function validatePropertyValuationInput(input: unknown): PropertyValuationInput {
  if (!isRecord(input) || !isPropertyValuationInput(input)) {
    throw new Error("Property valuation input must be an object.");
  }
  if (input.propertyId.trim().length === 0) {
    throw new Error("Property valuation propertyId must be a non-empty string.");
  }
  if (!isIsoCalendarDate(input.effectiveDateIso)) {
    throw new Error("Property valuation effectiveDateIso must be a valid ISO calendar date.");
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) {
    throw new Error("Property valuation amountMinor must be a non-negative safe integer.");
  }
  if (!isCurrencyCode(input.currencyCode)) {
    throw new Error("Property valuation currencyCode must be a three-letter uppercase currency code.");
  }
  return input;
}
