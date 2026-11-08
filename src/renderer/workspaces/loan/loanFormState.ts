import type {
  LoanBalanceValidationField,
  LoanRecordValidationField,
} from "../../../domain/loanRecordValidation.js";
import {
  LoanRecordValidationError
} from "../../../domain/loanRecordValidation.js";
import { formatMinorUnits } from "../../../domain/money/minorUnits.js";
import type {
  LoanPaymentFrequency
} from "../../../domain/types.js";
import { errorMessage } from "../registryErrorMessage.js";

export interface LoanRegistrySectionProps {
  isActive: boolean;
  refreshRevision: number;
  onViewProperty: (propertyId: string) => void;
}

export interface LoanDraft {
  label: string;
  principal: string;
  annualInterestRate: string;
  termYears: string;
  paymentAmount: string;
  paymentFrequency: LoanPaymentFrequency;
  currencyCode: string;
  propertyId: string;
}

export interface BalanceDraft {
  effectiveDateIso: string;
  amount: string;
}

interface FormError {
  message: string;
  field?: LoanRecordValidationField | LoanBalanceValidationField;
}

export type LoanFieldErrors = Partial<Record<LoanRecordValidationField, string>>;

export type BalanceFieldErrors = Partial<Record<LoanBalanceValidationField, string>>;

export type FocusableField = HTMLInputElement | HTMLSelectElement;

export type FocusableFieldRefs<Field extends string> = Partial<Record<Field, FocusableField | null>>;

export const EMPTY_LOAN_DRAFT: LoanDraft = {
  label: "",
  principal: "",
  annualInterestRate: "",
  termYears: "",
  paymentAmount: "",
  paymentFrequency: "monthly",
  currencyCode: "NOK",
  propertyId: "",
};

export const EMPTY_BALANCE_DRAFT: BalanceDraft = {
  effectiveDateIso: "",
  amount: "",
};

export const PAYMENT_FREQUENCY_LABELS: Record<LoanPaymentFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export const LOAN_FIELD_ORDER: readonly LoanRecordValidationField[] = [
  "label",
  "principalMinor",
  "annualInterestRateBasisPoints",
  "termMonths",
  "paymentAmountMinor",
  "paymentFrequency",
  "currencyCode",
  "propertyId",
];

export const BALANCE_FIELD_ORDER: readonly LoanBalanceValidationField[] = [
  "effectiveDateIso",
  "amountMinor",
];

export const LOAN_DRAFT_VALIDATION_FIELDS: Record<keyof LoanDraft, LoanRecordValidationField> = {
  label: "label",
  principal: "principalMinor",
  annualInterestRate: "annualInterestRateBasisPoints",
  termYears: "termMonths",
  paymentAmount: "paymentAmountMinor",
  paymentFrequency: "paymentFrequency",
  currencyCode: "currencyCode",
  propertyId: "propertyId",
};

export const amountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const timestampFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "short",
  timeStyle: "short",
});

export function parseTermMonths(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const years = Number(normalized);
  const termMonths = years * 12;
  return Number.isSafeInteger(termMonths) && termMonths > 0 ? termMonths : null;
}

export function formatAmount(amountMinor: number, currencyCode: string): string {
  return `${currencyCode} ${formatMinorUnits(amountMinor, amountFormatter)}`;
}

export function formatTerm(termMonths: number): string {
  const years = Math.floor(termMonths / 12);
  const months = termMonths % 12;
  if (months === 0) return `${years} ${years === 1 ? "year" : "years"}`;
  if (years === 0) return `${months} ${months === 1 ? "month" : "months"}`;
  return `${years} ${years === 1 ? "year" : "years"}, ${months} ${months === 1 ? "month" : "months"}`;
}

export function formatRecordedAt(recordedAtIso: string): string {
  return timestampFormatter.format(new Date(recordedAtIso));
}

export function validationError(error: unknown, fallback: string): FormError {
  if (error instanceof LoanRecordValidationError) {
    return { field: error.field, message: error.message };
  }
  return { message: errorMessage(error, fallback) };
}

export function describedBy(...ids: Array<string | undefined>): string {
  return ids.filter((id): id is string => id !== undefined).join(" ");
}
