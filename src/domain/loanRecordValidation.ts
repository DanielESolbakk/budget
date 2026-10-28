import { isCurrencyCode } from "./types.js";
import type {
  LoanBalanceInput,
  LoanPaymentFrequency,
  LoanRecordInput,
} from "./types.js";

const PAYMENT_FREQUENCIES: readonly LoanPaymentFrequency[] = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
];

export type LoanRecordValidationField = keyof LoanRecordInput;
export type LoanBalanceValidationField = keyof LoanBalanceInput;

export class LoanRecordValidationError extends Error {
  constructor(
    readonly field: LoanRecordValidationField | LoanBalanceValidationField,
    message: string
  ) {
    super(message);
    this.name = "LoanRecordValidationError";
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

function isPaymentFrequency(value: unknown): value is LoanPaymentFrequency {
  return PAYMENT_FREQUENCIES.some((frequency) => frequency === value);
}

export function validateLoanRecordInput(
  input: unknown,
  existingPropertyIds: readonly string[] = []
): LoanRecordInput {
  if (!isRecord(input)) {
    throw new LoanRecordValidationError("label", "Enter a loan label.");
  }

  const label = input["label"];
  if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > 100) {
    throw new LoanRecordValidationError("label", "Enter a loan label up to 100 characters.");
  }

  const principalMinor = input["principalMinor"];
  if (!Number.isSafeInteger(principalMinor) || typeof principalMinor !== "number" || principalMinor <= 0) {
    throw new LoanRecordValidationError("principalMinor", "Enter a positive principal amount.");
  }

  const annualInterestRateBasisPoints = input["annualInterestRateBasisPoints"];
  if (
    !Number.isSafeInteger(annualInterestRateBasisPoints) ||
    typeof annualInterestRateBasisPoints !== "number" ||
    annualInterestRateBasisPoints < 0 ||
    annualInterestRateBasisPoints > 10_000
  ) {
    throw new LoanRecordValidationError("annualInterestRateBasisPoints", "Enter an annual rate from 0 to 100 percent.");
  }

  const termMonths = input["termMonths"];
  if (!Number.isSafeInteger(termMonths) || typeof termMonths !== "number" || termMonths <= 0) {
    throw new LoanRecordValidationError("termMonths", "Enter a positive loan term.");
  }

  const paymentAmountMinor = input["paymentAmountMinor"];
  if (!Number.isSafeInteger(paymentAmountMinor) || typeof paymentAmountMinor !== "number" || paymentAmountMinor <= 0) {
    throw new LoanRecordValidationError("paymentAmountMinor", "Enter a positive payment amount.");
  }

  const paymentFrequency = input["paymentFrequency"];
  if (!isPaymentFrequency(paymentFrequency)) {
    throw new LoanRecordValidationError("paymentFrequency", "Choose a supported payment frequency.");
  }

  const currencyCode = input["currencyCode"];
  if (!isCurrencyCode(currencyCode)) {
    throw new LoanRecordValidationError("currencyCode", "Enter a three-letter uppercase currency code.");
  }

  const propertyId = input["propertyId"];
  if (
    propertyId !== undefined &&
    (typeof propertyId !== "string" ||
      propertyId.trim().length === 0 ||
      !existingPropertyIds.includes(propertyId))
  ) {
    throw new LoanRecordValidationError("propertyId", "Choose an existing property or leave the property unlinked.");
  }

  return {
    label: label.trim(),
    principalMinor,
    annualInterestRateBasisPoints,
    termMonths,
    paymentAmountMinor,
    paymentFrequency,
    currencyCode,
    ...(propertyId === undefined ? {} : { propertyId }),
  };
}

export function validateLoanBalanceInput(input: unknown): LoanBalanceInput {
  if (!isRecord(input)) {
    throw new LoanRecordValidationError("loanId", "Choose an existing loan.");
  }

  const loanId = input["loanId"];
  if (typeof loanId !== "string" || loanId.trim().length === 0) {
    throw new LoanRecordValidationError("loanId", "Choose an existing loan.");
  }

  const effectiveDateIso = input["effectiveDateIso"];
  if (!isIsoCalendarDate(effectiveDateIso)) {
    throw new LoanRecordValidationError("effectiveDateIso", "Enter a valid effective date.");
  }

  const amountMinor = input["amountMinor"];
  if (!Number.isSafeInteger(amountMinor) || typeof amountMinor !== "number" || amountMinor < 0) {
    throw new LoanRecordValidationError("amountMinor", "Enter a non-negative balance amount.");
  }

  return { loanId, effectiveDateIso, amountMinor };
}
