import { errorMessage } from "../registryErrorMessage.js";

export interface PropertyRegistrySectionProps {
  isActive: boolean;
  refreshRevision: number;
  onPropertyRegistryChange: () => void;
  requestedPropertyId: string | null;
}

export interface PropertyValuationDraft {
  effectiveDateIso: string;
  amount: string;
  currencyCode: string;
}

export type PropertyValuationDraftField = keyof PropertyValuationDraft;

export interface PropertyFormError {
  message: string;
  field?: PropertyValuationDraftField | "label";
}

export const EMPTY_VALUATION_DRAFT: PropertyValuationDraft = {
  effectiveDateIso: "",
  amount: "",
  currencyCode: "NOK",
};

export const propertyAmountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const propertyRecordedAtFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "short",
  timeStyle: "short",
});

function valuationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes("effectiveDateIso")) {
    return "Enter a valid effective date.";
  }
  if (error instanceof Error && error.message.includes("currencyCode")) {
    return "Enter a three-letter uppercase currency code.";
  }
  return errorMessage(error, "Unable to save the property valuation.");
}

export function valuationErrorField(error: unknown): PropertyValuationDraftField | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message.includes("effectiveDateIso")) return "effectiveDateIso";
  if (error.message.includes("currencyCode")) return "currencyCode";
  if (error.message.includes("amountMinor")) return "amount";
  return undefined;
}

export function propertyValuationFormError(error: unknown): PropertyFormError {
  const field = valuationErrorField(error);
  return {
    message: valuationErrorMessage(error),
    ...(field === undefined ? {} : { field }),
  };
}

export function correctionErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    (error.message.includes("Active property valuation not found") ||
      error.message.includes("has already been corrected"))
  ) {
    return "This valuation has changed. Refresh the history and choose a current entry.";
  }
  return valuationErrorMessage(error);
}
