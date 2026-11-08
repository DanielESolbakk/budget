import React from "react";
import {
  HoldingRecordValidationError,
  validateHoldingValuationCorrectionInput
} from "../../../domain/holdingRecordValidation.js";
import { minorUnitsToDecimal } from "../../../domain/money/minorUnits.js";
import type {
  HoldingValuationSnapshot,
  HoldingWithValuations
} from "../../../domain/types.js";
import { parseCurrencyAmountMinor } from "../parseCurrencyAmountMinor.js";
import { errorMessage } from "../registryErrorMessage.js";
import { type HoldingValuationDraft, type HoldingValuationFormField, formatHoldingAmount, holdingRecordedAtFormatter, holdingValuationFormField } from "./holdingFormState.js";
export function HoldingHistory({
  holding, disabled, setSaving, onSaved,
}: {
  holding: HoldingWithValuations;
  disabled: boolean;
  setSaving: (saving: boolean) => void;
  onSaved: (message: string) => void;
}): React.JSX.Element {
  const [target, setTarget] = React.useState<HoldingValuationSnapshot | null>(null);
  const [draft, setDraft] = React.useState<HoldingValuationDraft>({
    effectiveDateIso: "", amount: "", currencyCode: holding.currencyCode,
  });
  const [error, setError] = React.useState<{ message: string; field?: HoldingValuationFormField } | null>(null);
  const historyRef = React.useRef<HTMLTableElement | null>(null);
  const targetButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const errorId = `holding-value-correction-${holding.id}-error`;
  const superseded = new Set(holding.valuations.map((value) => value.correction?.targetValuationId));

  function showError(message: string, field?: HoldingValuationFormField): void {
    setError({ message, ...(field === undefined ? {} : { field }) });
    if (field !== undefined) {
      window.requestAnimationFrame(() =>
        document.getElementById(`holding-value-correction-${holding.id}-${field}`)?.focus());
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabled || target === null) return;
    setError(null);
    const amountMinor = parseCurrencyAmountMinor(draft.amount);
    if (amountMinor === null) {
      showError("Enter a non-negative value with up to two decimal places.", "amountMinor");
      return;
    }
    let input;
    try {
      input = validateHoldingValuationCorrectionInput({
        holdingId: holding.id,
        targetValuationId: target.id,
        effectiveDateIso: draft.effectiveDateIso,
        amountMinor,
        currencyCode: draft.currencyCode,
      });
    } catch (validationError: unknown) {
      if (validationError instanceof HoldingRecordValidationError) {
        showError(validationError.message, holdingValuationFormField(validationError.field));
      } else {
        showError(errorMessage(validationError, "Unable to validate the correction."));
      }
      return;
    }
    setSaving(true);
    try {
      await window.budgetApi.holdingRegistry.correctValuation(input);
      setTarget(null);
      onSaved("Value corrected. The original remains in history.");
      window.requestAnimationFrame(() => {
        if (historyRef.current?.closest("[hidden]") === null) historyRef.current.focus();
      });
    } catch (saveError: unknown) {
      showError(errorMessage(saveError, "Unable to correct the value."));
    } finally {
      setSaving(false);
    }
  }

  if (holding.valuations.length === 0) {
    return <p className="holding-registry-empty">No values have been recorded.</p>;
  }
  return (
    <>
      <div className="holding-history-table-wrap">
        <table aria-label="Valuation history" tabIndex={-1} ref={historyRef}>
          <thead><tr>
            <th scope="col">Effective date</th><th scope="col">Value</th>
            <th scope="col">Recorded at (local time)</th><th scope="col">Status</th><th scope="col">Action</th>
          </tr></thead>
          <tbody>
            {holding.valuations.map((valuation, index) => {
              const originalIndex = holding.valuations.findIndex((value) =>
                value.id === valuation.correction?.targetValuationId);
              const original = holding.valuations[originalIndex];
              return (
                <tr key={valuation.id}>
                  <td><time dateTime={valuation.effectiveDateIso}>{valuation.effectiveDateIso}</time></td>
                  <td>{formatHoldingAmount(valuation.amountMinor, valuation.currencyCode)}</td>
                  <td><time dateTime={valuation.recordedAtIso}>
                    {holdingRecordedAtFormatter.format(new Date(valuation.recordedAtIso))}
                  </time></td>
                  <td>
                    {superseded.has(valuation.id) ? "Superseded" : valuation.correction ? "Correction" : "Recorded"}
                    {` (entry ${index + 1})`}
                    {valuation.correction && (original === undefined
                      ? "; Correction target unavailable"
                      : `; Corrects value from ${original.effectiveDateIso}, ${formatHoldingAmount(original.amountMinor, original.currencyCode)}, recorded ${holdingRecordedAtFormatter.format(new Date(original.recordedAtIso))} (entry ${originalIndex + 1})`)}
                  </td>
                  <td>{!superseded.has(valuation.id) && (
                    <button type="button" disabled={disabled}
                      aria-label={`Correct value for ${valuation.effectiveDateIso}, ${formatHoldingAmount(valuation.amountMinor, valuation.currencyCode)}, recorded ${holdingRecordedAtFormatter.format(new Date(valuation.recordedAtIso))}, entry ${index + 1}`}
                      onClick={(event) => {
                        targetButtonRef.current = event.currentTarget;
                        setTarget(valuation);
                        setError(null);
                        setDraft({
                          effectiveDateIso: valuation.effectiveDateIso,
                          amount: minorUnitsToDecimal(valuation.amountMinor),
                          currencyCode: valuation.currencyCode,
                        });
                      }}>Correct value for {valuation.effectiveDateIso}</button>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {target !== null && (
        <form className="holding-valuation-form" aria-label="Correct holding value" onSubmit={(event) => void save(event)}>
          {([
            ["effectiveDateIso", "Effective date", "effectiveDateIso"],
            ["amount", "Amount", "amountMinor"],
            ["currencyCode", "Currency code", "currencyCode"],
          ] as const).map(([field, label, validationField]) => (
            <label key={field}>
              {label}
              <input
                id={`holding-value-correction-${holding.id}-${validationField}`}
                type={field === "effectiveDateIso" ? "date" : "text"}
                inputMode={field === "amount" ? "decimal" : undefined}
                maxLength={field === "currencyCode" ? 3 : undefined}
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
          <button type="submit" disabled={disabled}>Save value correction</button>
          <button type="button" disabled={disabled} onClick={() => {
            setTarget(null);
            setError(null);
            window.requestAnimationFrame(() => targetButtonRef.current?.focus());
          }}>
            Cancel
          </button>
          {error !== null && <p id={errorId} className="holding-registry-message" role="alert">{error.message}</p>}
        </form>
      )}
    </>
  );
}
