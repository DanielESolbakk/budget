import React from "react";
import {
  HoldingRecordValidationError,
  validateHoldingCorrectionInput
} from "../../../domain/holdingRecordValidation.js";
import { minorUnitsToDecimal } from "../../../domain/money/minorUnits.js";
import type {
  HoldingWithValuations
} from "../../../domain/types.js";
import { parseCurrencyAmountMinor } from "../parseCurrencyAmountMinor.js";
import { errorMessage } from "../registryErrorMessage.js";
import { type HoldingDraft, type HoldingFormField, formatHoldingAmount, holdingFormField, holdingRecordedAtFormatter } from "./holdingFormState.js";
export function HoldingCorrectionControls({
  holding, disabled, setSaving, onSaved,
}: {
  holding: HoldingWithValuations;
  disabled: boolean;
  setSaving: (saving: boolean) => void;
  onSaved: (message: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState<HoldingDraft>(() => ({
    label: holding.label,
    quantity: String(holding.quantity),
    costBasis: minorUnitsToDecimal(holding.costBasisMinor),
    currencyCode: holding.currencyCode,
  }));
  const [error, setError] = React.useState<{ message: string; field?: HoldingFormField } | null>(null);
  React.useEffect(() => {
    setDraft({
      label: holding.label,
      quantity: String(holding.quantity),
      costBasis: minorUnitsToDecimal(holding.costBasisMinor),
      currencyCode: holding.currencyCode,
    });
  }, [holding.id, holding.label, holding.quantity, holding.costBasisMinor, holding.currencyCode]);

  function showError(message: string, field?: HoldingFormField): void {
    setError({ message, ...(field === undefined ? {} : { field }) });
    if (field !== undefined) {
      window.requestAnimationFrame(() =>
        document.getElementById(`holding-correction-${holding.id}-${field}`)?.focus());
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabled) return;
    setError(null);
    const costBasisMinor = parseCurrencyAmountMinor(draft.costBasis);
    if (costBasisMinor === null) {
      showError("Enter a non-negative cost basis with up to two decimal places.", "costBasisMinor");
      return;
    }
    let input;
    try {
      input = validateHoldingCorrectionInput({
        holdingId: holding.id,
        label: draft.label,
        quantity: Number(draft.quantity),
        costBasisMinor,
        currencyCode: draft.currencyCode,
      });
    } catch (validationError: unknown) {
      if (validationError instanceof HoldingRecordValidationError) {
        showError(validationError.message, holdingFormField(validationError.field));
      } else {
        showError(errorMessage(validationError, "Unable to validate the correction."));
      }
      return;
    }
    setSaving(true);
    try {
      await window.budgetApi.holdingRegistry.correctHolding(input);
      onSaved("Holding details corrected. Previous details remain in history.");
    } catch (saveError: unknown) {
      showError(errorMessage(saveError, "Unable to correct the holding."));
    } finally {
      setSaving(false);
    }
  }

  const errorId = `holding-correction-${holding.id}-error`;
  return (
    <>
      <details className="holding-correction">
        <summary>Correct holding details</summary>
        <p>Correct an entry mistake. Previous details remain in history.</p>
        <form className="holding-create-form" aria-label="Correct holding details" onSubmit={(event) => void save(event)}>
          {([
            ["label", "Holding label", "label"],
            ["quantity", "Quantity", "quantity"],
            ["costBasis", "Cost basis", "costBasisMinor"],
            ["currencyCode", "Currency code", "currencyCode"],
          ] as const).map(([field, label, validationField]) => (
            <label key={field}>
              {label}
              <input
                id={`holding-correction-${holding.id}-${validationField}`}
                type={field === "quantity" ? "number" : "text"}
                step={field === "quantity" ? "any" : undefined}
                inputMode={field === "quantity" || field === "costBasis" ? "decimal" : undefined}
                maxLength={field === "label" ? 100 : field === "currencyCode" ? 3 : undefined}
                disabled={disabled}
                aria-invalid={error?.field === validationField ? true : undefined}
                aria-describedby={error?.field === validationField ? errorId : undefined}
                value={draft[field]}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setError(null);
                  setDraft((current) => ({ ...current, [field]: value }));
                }}
              />
            </label>
          ))}
          <button type="submit" disabled={disabled}>Save holding correction</button>
        </form>
        {error !== null && <p id={errorId} className="holding-registry-message" role="alert">{error.message}</p>}
      </details>
      {(holding.revisions?.length ?? 0) > 0 && (
        <details className="holding-correction">
          <summary>Previous holding details</summary>
          <ul>
            {holding.revisions?.map((revision) => (
              <li key={revision.id}>
                {revision.label} | {revision.quantity} | {formatHoldingAmount(revision.costBasisMinor, revision.currencyCode)}
                {" | "}<time dateTime={revision.correctedAtIso}>
                  {holdingRecordedAtFormatter.format(new Date(revision.correctedAtIso))}
                </time>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
