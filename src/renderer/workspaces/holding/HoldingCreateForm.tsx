import React from "react";
import { type HoldingDraft, type HoldingFormField } from "./holdingFormState.js";

interface HoldingCreateFormProps {
  addHolding: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  holdingErrors: Partial<Record<HoldingFormField, string>>;
  updateHoldingDraft: (field: keyof HoldingDraft, value: string) => void;
  holdingFieldRefs: React.MutableRefObject<Partial<Record<HoldingFormField, HTMLInputElement | null>>>;
  holdingDraft: HoldingDraft;
  isSaving: boolean;
  isLoading: boolean;
  loadError: string | null;
}

export function HoldingCreateForm({
  addHolding, holdingErrors, updateHoldingDraft, holdingFieldRefs, holdingDraft,
  isSaving, isLoading, loadError,
}: HoldingCreateFormProps): React.JSX.Element {
  return (<form
    className="holding-create-form"
    aria-label="Add investment holding"
    onSubmit={(event) => void addHolding(event)}
  >
    <label>
      Holding label
      <input
        autoComplete="off"
        aria-invalid={holdingErrors.label === undefined ? undefined : true}
        aria-describedby={holdingErrors.label === undefined ? undefined : "holding-error-label"}
        maxLength={100}
        onChange={(event) => updateHoldingDraft("label", event.currentTarget.value)}
        ref={(element) => { holdingFieldRefs.current.label = element; }}
        value={holdingDraft.label}
      />
    </label>
    <label>
      Quantity
      <input
        type="number"
        inputMode="decimal"
        step="any"
        aria-invalid={holdingErrors.quantity === undefined ? undefined : true}
        aria-describedby={holdingErrors.quantity === undefined ? undefined : "holding-error-quantity"}
        onChange={(event) => updateHoldingDraft("quantity", event.currentTarget.value)}
        ref={(element) => { holdingFieldRefs.current.quantity = element; }}
        value={holdingDraft.quantity}
      />
    </label>
    <label>
      Cost basis
      <input
        inputMode="decimal"
        aria-invalid={holdingErrors.costBasisMinor === undefined ? undefined : true}
        aria-describedby={holdingErrors.costBasisMinor === undefined
          ? undefined
          : "holding-error-costBasisMinor"}
        onChange={(event) => updateHoldingDraft("costBasis", event.currentTarget.value)}
        ref={(element) => { holdingFieldRefs.current.costBasisMinor = element; }}
        value={holdingDraft.costBasis}
      />
    </label>
    <label>
      Currency code
      <input
        autoCapitalize="characters"
        maxLength={3}
        aria-invalid={holdingErrors.currencyCode === undefined ? undefined : true}
        aria-describedby={holdingErrors.currencyCode === undefined
          ? undefined
          : "holding-error-currencyCode"}
        onChange={(event) => updateHoldingDraft("currencyCode", event.currentTarget.value)}
        ref={(element) => { holdingFieldRefs.current.currencyCode = element; }}
        value={holdingDraft.currencyCode}
      />
    </label>
    <button disabled={isSaving || isLoading || loadError !== null} type="submit">
      {isSaving ? "Saving holding..." : "Save holding"}
    </button>
  </form>);
}
