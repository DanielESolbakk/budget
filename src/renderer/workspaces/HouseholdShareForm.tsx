import React from "react";
import { DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS } from "../../domain/householdShareValidation.js";
import { parseCurrencyAmountMinor } from "./parseCurrencyAmountMinor.js";

interface HouseholdShareFormState {
  draft: string;
  lastValue: number;
  error: string | null;
  saved: boolean;
  saving: boolean;
}

export function useHouseholdShareFormStates() {
  return React.useState<Record<string, HouseholdShareFormState>>({});
}

interface HouseholdShareFormProps {
  recordId: string;
  label: string;
  buttonLabel: string;
  successMessage: string;
  value: number;
  onSave: (value: number) => Promise<void>;
  formStates: Record<string, HouseholdShareFormState>;
  setFormStates: React.Dispatch<React.SetStateAction<Record<string, HouseholdShareFormState>>>;
}

export function HouseholdShareForm({
  recordId,
  label,
  buttonLabel,
  successMessage,
  value,
  onSave,
  formStates,
  setFormStates,
}: HouseholdShareFormProps): React.JSX.Element {
  const { draft, error, saved, saving } = formStates[recordId] ?? {
    draft: String(value / 100), lastValue: value, error: null, saved: false, saving: false,
  };
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const errorId = React.useId();
  const hintId = `${errorId}-hint`;

  React.useEffect(() => {
    setFormStates((current) => {
      const state = current[recordId];
      if (state === undefined || state.saving || state.lastValue === value) return current;
      return {
        ...current,
        [recordId]: { ...state, draft: String(value / 100), lastValue: value, error: null, saved: false },
      };
    });
  }, [recordId, setFormStates, value]);

  function updateFormState(update: (state: HouseholdShareFormState) => HouseholdShareFormState): void {
    setFormStates((current) => ({
      ...current,
      [recordId]: update(current[recordId] ?? {
        draft: String(value / 100), lastValue: value, error: null, saved: false, saving: false,
      }),
    }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    updateFormState((state) => ({ ...state, saved: false, error: null }));
    try {
      // Percentage points and currency amounts use the same two-decimal scale.
      const share = parseCurrencyAmountMinor(draft);
      if (share === null || share > DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS) {
        throw new Error("Enter a percentage from 0 to 100 with up to two decimal places.");
      }
      updateFormState((state) => ({ ...state, saving: true }));
      await onSave(share);
      updateFormState((state) => ({ ...state, draft: String(share / 100), lastValue: share, saved: true }));
    } catch (caught: unknown) {
      updateFormState((state) => ({
        ...state, error: caught instanceof Error ? caught.message : "Unable to save the share.",
      }));
      inputRef.current?.focus();
    } finally {
      updateFormState((state) => ({ ...state, saving: false }));
    }
  }

  return (
    <form className="household-share-form" aria-label={`Edit ${label}`} aria-busy={saving} onSubmit={(event) => void submit(event)} noValidate>
      <label>
        {label}
        <input
          ref={inputRef}
          inputMode="decimal"
          readOnly={saving}
          value={draft}
          onChange={(event) => {
            const nextDraft = event.currentTarget.value;
            updateFormState((state) => ({ ...state, draft: nextDraft, error: null, saved: false }));
          }}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={error !== null ? `${hintId} ${errorId}` : hintId}
        />
      </label>
      <button type="submit" disabled={saving}>{saving ? "Saving..." : buttonLabel}</button>
      <p className="household-share-hint" id={hintId}>
        Enter 0 to 100%, with up to two decimal places. This does not determine legal ownership or liability.
      </p>
      {error !== null && <p id={errorId} className="property-registry-message" role="alert">{error}</p>}
      {saved && <p className="property-registry-message" role="status">{successMessage}</p>}
    </form>
  );
}
