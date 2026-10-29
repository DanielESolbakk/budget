import { isCurrencyCode } from "./types.js";
import type {
  HoldingCorrectionInput,
  HoldingRecordInput,
  HoldingRecordRevision,
  HoldingValuationCorrectionInput,
  HoldingValuationInput,
} from "./types.js";

export type HoldingRecordValidationField =
  | keyof HoldingRecordInput
  | keyof HoldingValuationInput
  | "targetValuationId";

export class HoldingRecordValidationError extends Error {
  constructor(
    readonly field: HoldingRecordValidationField,
    message: string,
    readonly fieldErrors?: Partial<Record<keyof HoldingRecordInput, string>>
  ) {
    super(message);
    this.name = "HoldingRecordValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateHoldingRecordInput(input: unknown): HoldingRecordInput {
  if (!isRecord(input)) {
    throw new HoldingRecordValidationError(
      "label",
      "Enter a holding label.",
      { label: "Enter a holding label." }
    );
  }

  const label = input["label"];
  const quantity = input["quantity"];
  const costBasisMinor = input["costBasisMinor"];
  const currencyCode = input["currencyCode"];
  const normalizedLabel = typeof label === "string" ? label.trim() : undefined;
  const normalizedQuantity = typeof quantity === "number" ? quantity : undefined;
  const normalizedCostBasisMinor = typeof costBasisMinor === "number"
    ? costBasisMinor
    : undefined;
  const normalizedCurrencyCode = isCurrencyCode(currencyCode) ? currencyCode : undefined;
  const fieldErrors: Partial<Record<keyof HoldingRecordInput, string>> = {};
  if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > 100) {
    fieldErrors.label = "Enter a holding label.";
  }
  if (
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    fieldErrors.quantity = "Enter a positive quantity.";
  }
  if (
    typeof costBasisMinor !== "number" ||
    !Number.isSafeInteger(costBasisMinor) ||
    costBasisMinor < 0
  ) {
    fieldErrors.costBasisMinor = "Enter a non-negative cost basis.";
  }
  if (!isCurrencyCode(currencyCode)) {
    fieldErrors.currencyCode = "Enter a three-letter uppercase currency code.";
  }

  for (const field of ["label", "quantity", "costBasisMinor", "currencyCode"] as const) {
    const message = fieldErrors[field];
    if (message !== undefined) {
      throw new HoldingRecordValidationError(field, message, fieldErrors);
    }
  }
  if (
    normalizedLabel === undefined ||
    normalizedQuantity === undefined ||
    normalizedCostBasisMinor === undefined ||
    normalizedCurrencyCode === undefined
  ) {
    throw new Error("Holding input validation did not produce a complete record.");
  }

  return {
    label: normalizedLabel,
    quantity: normalizedQuantity,
    costBasisMinor: normalizedCostBasisMinor,
    currencyCode: normalizedCurrencyCode,
  };
}

export function validateHoldingValuationInput(input: unknown): HoldingValuationInput {
  if (!isRecord(input)) {
    throw new HoldingRecordValidationError("holdingId", "Choose an existing investment holding.");
  }

  const holdingId = input["holdingId"];
  if (typeof holdingId !== "string" || holdingId.trim().length === 0) {
    throw new HoldingRecordValidationError("holdingId", "Choose an existing investment holding.");
  }

  const effectiveDateIso = input["effectiveDateIso"];
  if (!isIsoCalendarDate(effectiveDateIso)) {
    throw new HoldingRecordValidationError("effectiveDateIso", "Enter a valid effective date.");
  }

  const amountMinor = input["amountMinor"];
  if (
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0
  ) {
    throw new HoldingRecordValidationError("amountMinor", "Enter a non-negative value.");
  }

  const currencyCode = input["currencyCode"];
  if (!isCurrencyCode(currencyCode)) {
    throw new HoldingRecordValidationError("currencyCode", "Enter a three-letter uppercase currency code.");
  }

  return { holdingId, effectiveDateIso, amountMinor, currencyCode };
}

export function validateHoldingCorrectionInput(input: unknown): HoldingCorrectionInput {
  if (!isRecord(input) || typeof input.holdingId !== "string" || input.holdingId.trim() === "") {
    throw new HoldingRecordValidationError("holdingId", "Choose an existing investment holding.");
  }
  return { ...validateHoldingRecordInput(input), holdingId: input.holdingId };
}

export function validateHoldingValuationCorrectionInput(
  input: unknown
): HoldingValuationCorrectionInput {
  const valuation = validateHoldingValuationInput(input);
  if (!isRecord(input) || typeof input.targetValuationId !== "string" ||
      input.targetValuationId.trim() === "") {
    throw new HoldingRecordValidationError("targetValuationId", "Choose a value to correct.");
  }
  return { ...valuation, targetValuationId: input.targetValuationId };
}

export function validateHoldingRevision(input: unknown): HoldingRecordRevision {
  if (!isRecord(input) || typeof input.id !== "string" || input.id.trim() === "" ||
      typeof input.correctedAtIso !== "string" || !input.correctedAtIso.includes("T") ||
      Number.isNaN(Date.parse(input.correctedAtIso))) {
    throw new Error("Investment holding revision identity or timestamp is invalid.");
  }
  return { ...validateHoldingRecordInput(input), id: input.id, correctedAtIso: input.correctedAtIso };
}

export function validateHoldingValuationCorrectionMetadata(
  input: unknown
): { targetValuationId: string } {
  if (!isRecord(input) || typeof input.targetValuationId !== "string" ||
      input.targetValuationId.trim() === "") {
    throw new Error("Investment holding valuation correction is invalid.");
  }
  return { targetValuationId: input.targetValuationId };
}
