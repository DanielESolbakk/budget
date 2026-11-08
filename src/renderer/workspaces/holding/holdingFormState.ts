import type {
  HoldingRecordValidationField,
} from "../../../domain/holdingRecordValidation.js";
import { formatMinorUnits } from "../../../domain/money/minorUnits.js";

export interface HoldingDraft {
  label: string;
  quantity: string;
  costBasis: string;
  currencyCode: string;
}

export interface HoldingValuationDraft {
  effectiveDateIso: string;
  amount: string;
  currencyCode: string;
}

export type HoldingFormField = "label" | "quantity" | "costBasisMinor" | "currencyCode";

export type HoldingValuationFormField = "effectiveDateIso" | "amountMinor" | "currencyCode";

export const EMPTY_HOLDING_DRAFT: HoldingDraft = {
  label: "",
  quantity: "",
  costBasis: "",
  currencyCode: "NOK",
};

const holdingAmountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const holdingRecordedAtFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "short",
  timeStyle: "short",
});

export function formatHoldingAmount(amountMinor: number, currencyCode: string): string {
  return `${currencyCode} ${formatMinorUnits(amountMinor, holdingAmountFormatter)}`;
}

export function holdingFormField(field: HoldingRecordValidationField): HoldingFormField | undefined {
  if (
    field === "label" ||
    field === "quantity" ||
    field === "costBasisMinor" ||
    field === "currencyCode"
  ) {
    return field;
  }
  return undefined;
}

export function holdingValuationFormField(
  field: HoldingRecordValidationField
): HoldingValuationFormField | undefined {
  if (
    field === "holdingId" ||
    field === "effectiveDateIso" ||
    field === "amountMinor" ||
    field === "currencyCode"
  ) {
    return field === "holdingId" ? undefined : field;
  }
  return undefined;
}
