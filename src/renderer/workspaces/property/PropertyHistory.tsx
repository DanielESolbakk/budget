import React from "react";
import { formatMinorUnits } from "../../../domain/money/minorUnits.js";
import type {
  PropertyValuationSnapshot,
  PropertyWithValuations
} from "../../../domain/types.js";
import {
  type PropertyFormError, type PropertyValuationDraft, type PropertyValuationDraftField,
  propertyAmountFormatter, propertyRecordedAtFormatter,
} from "./propertyFormState.js";

interface PropertyHistoryProps {
  property: PropertyWithValuations;
  correctionsByTarget: Map<string, string>;
  formErrors: Record<string, PropertyFormError>;
  formStatuses: Record<string, string>;
  correctionDraft: (valuation: PropertyValuationSnapshot) => PropertyValuationDraft;
  supersedeValuation: (event: React.FormEvent<HTMLFormElement>, property: PropertyWithValuations, target: PropertyValuationSnapshot) => Promise<void>;
  updateCorrectionDraft: (valuation: PropertyValuationSnapshot, field: PropertyValuationDraftField, value: string) => void;
  isSaving: boolean;
  voidValuation: (property: PropertyWithValuations, target: PropertyValuationSnapshot) => Promise<void>;
}

export function PropertyHistory({
  property, correctionsByTarget, formErrors, formStatuses, correctionDraft,
  supersedeValuation, updateCorrectionDraft, isSaving, voidValuation,
}: PropertyHistoryProps): React.JSX.Element {
  return (<div className="property-history-table-wrap">
    <table aria-label="Valuation history">
      <thead>
        <tr>
          <th scope="col">Effective date</th>
          <th scope="col">Value</th>
          <th scope="col">Recorded at (local time)</th>
        </tr>
      </thead>
      <tbody>
        {property.valuations.map((valuation) => {
          const correctionAction = correctionsByTarget.get(valuation.id);
          const canCorrect =
            correctionAction === undefined && valuation.correction?.action !== "void";
          const status =
            correctionAction === "void"
              ? "Voided"
              : correctionAction === "supersede"
                ? "Superseded"
                : valuation.correction?.action === "void"
                  ? "Void record"
                  : valuation.correction?.action === "supersede"
                    ? "Current corrected value"
                    : "Current";
          const correctionFeedbackKey = `correction:${valuation.id}`;
          const correctionError = formErrors[correctionFeedbackKey];
          const correctionStatus = formStatuses[correctionFeedbackKey];
          const correctionDraftValue = correctionDraft(valuation);
          const correctionErrorId = `correction-error-${valuation.id}`;

          return (
            <tr key={valuation.id}>
              <td>
                <time dateTime={valuation.effectiveDateIso}>
                  {valuation.effectiveDateIso}
                </time>
              </td>
              <td className="property-valuation-value">
                <span className="property-valuation-currency">{valuation.currencyCode}</span>
                {" "}
                <span className="property-valuation-amount">
                  {formatMinorUnits(valuation.amountMinor, propertyAmountFormatter)}
                </span>
                <span className="property-valuation-status">{status}</span>
                <details className="property-valuation-actions">
                  <summary>Correct or void</summary>
                  {canCorrect ? (
                    <>
                      <p className="property-correction-note">
                        Saving a correction adds a new history entry and keeps the original.
                      </p>
                      <form
                        className="property-correction-form"
                        aria-label="Supersede valuation"
                        onSubmit={(event) => void supersedeValuation(
                          event,
                          property,
                          valuation
                        )}
                      >
                        <label>
                          Effective date
                          <input
                            type="date"
                            aria-invalid={correctionError?.field === "effectiveDateIso"
                              ? true
                              : undefined}
                            aria-describedby={correctionError?.field === "effectiveDateIso"
                              ? correctionErrorId
                              : undefined}
                            onChange={(event) => updateCorrectionDraft(
                              valuation,
                              "effectiveDateIso",
                              event.currentTarget.value
                            )}
                            value={correctionDraftValue.effectiveDateIso}
                          />
                        </label>
                        <label>
                          Amount
                          <input
                            inputMode="decimal"
                            aria-invalid={correctionError?.field === "amount"
                              ? true
                              : undefined}
                            aria-describedby={correctionError?.field === "amount"
                              ? correctionErrorId
                              : undefined}
                            onChange={(event) => updateCorrectionDraft(
                              valuation,
                              "amount",
                              event.currentTarget.value
                            )}
                            value={correctionDraftValue.amount}
                          />
                        </label>
                        <label>
                          Currency code
                          <input
                            autoCapitalize="characters"
                            maxLength={3}
                            aria-invalid={correctionError?.field === "currencyCode"
                              ? true
                              : undefined}
                            aria-describedby={correctionError?.field === "currencyCode"
                              ? correctionErrorId
                              : undefined}
                            onChange={(event) => updateCorrectionDraft(
                              valuation,
                              "currencyCode",
                              event.currentTarget.value
                            )}
                            value={correctionDraftValue.currencyCode}
                          />
                        </label>
                        <button disabled={isSaving} type="submit">Save correction</button>
                        {correctionError !== undefined && (
                          <p
                            id={correctionErrorId}
                            className="property-registry-message"
                            role="alert"
                          >
                            {correctionError.message}
                          </p>
                        )}
                      </form>
                      <button
                        className="action-secondary"
                        disabled={isSaving}
                        onClick={() => void voidValuation(property, valuation)}
                        type="button"
                      >
                        Void valuation
                      </button>
                    </>
                  ) : (
                    <p className="property-registry-empty">
                      {correctionAction === "void" || valuation.correction?.action === "void"
                        ? "This valuation was voided and remains in history. Add a new valuation to record a current value."
                        : "This valuation was superseded and remains in history. Use the current entry to add another correction."}
                    </p>
                  )}
                  {correctionStatus !== undefined && (
                    <p className="property-registry-message" role="status">
                      {correctionStatus}
                    </p>
                  )}
                  {correctionError !== undefined && !canCorrect && (
                    <p className="property-registry-message" role="alert">
                      {correctionError.message}
                    </p>
                  )}
                </details>
              </td>
              <td>
                <time dateTime={valuation.recordedAtIso}>
                  {propertyRecordedAtFormatter.format(new Date(valuation.recordedAtIso))}
                </time>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>);
}
