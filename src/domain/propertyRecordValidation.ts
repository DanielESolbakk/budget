import { isCurrencyCode } from "./types.js";
import type {
  PropertyLabelUpdateInput,
  PropertyRecordInput,
  PropertyValuationCorrection,
  PropertyValuationCorrectionInput,
  PropertyValuationInput,
} from "./types.js";

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

export function validatePropertyLabelUpdateInput(input: unknown): PropertyLabelUpdateInput {
  if (!isRecord(input) || typeof input.propertyId !== "string" || input.propertyId.trim().length === 0) {
    throw new Error("Property label update must identify a property.");
  }
  const property = validatePropertyRecordInput({ label: input.label });
  return { propertyId: input.propertyId, label: property.label.trim() };
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

export function validatePropertyValuationCorrectionMetadata(
  input: unknown
): PropertyValuationCorrection {
  if (!isPropertyValuationCorrectionMetadata(input)) {
    throw new Error("Property valuation correction metadata is invalid.");
  }
  return {
    action: input.action,
    targetValuationId: input.targetValuationId,
  };
}

export function isPropertyValuationCorrectionMetadata(
  input: unknown
): input is PropertyValuationCorrection {
  return (
    isRecord(input) &&
    (input.action === "supersede" || input.action === "void") &&
    typeof input.targetValuationId === "string" &&
    input.targetValuationId.trim().length > 0
  );
}

export function validatePropertyValuationCorrectionInput(
  input: unknown
): PropertyValuationCorrectionInput {
  if (!isRecord(input) || typeof input.propertyId !== "string" || input.propertyId.trim().length === 0) {
    throw new Error("Property valuation correction must identify a property.");
  }

  const correction = validatePropertyValuationCorrectionMetadata({
    action: input.action,
    targetValuationId: input.targetValuationId,
  });
  if (correction.action === "void") {
    return {
      action: "void",
      propertyId: input.propertyId,
      targetValuationId: correction.targetValuationId,
    };
  }

  const valuation = validatePropertyValuationInput({
    propertyId: input.propertyId,
    effectiveDateIso: input.effectiveDateIso,
    amountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
  });
  return {
    action: "supersede",
    ...valuation,
    targetValuationId: correction.targetValuationId,
  };
}
