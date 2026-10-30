import React from "react";
import { validateHouseholdShare } from "../../domain/householdShareValidation.js";

interface HouseholdShareFormProps {
  label: string;
  buttonLabel: string;
  successMessage: string;
  value: number;
  onSave: (value: number) => Promise<void>;
}

export function HouseholdShareForm({
  label,
  buttonLabel,
  successMessage,
  value,
  onSave,
}: HouseholdShareFormProps): React.JSX.Element {
  const [draft, setDraft] = React.useState(String(value));
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const errorId = React.useId();
  const hintId = `${errorId}-hint`;

  React.useEffect(() => setDraft(String(value)), [value]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaved(false);
    setError(null);
    try {
      const parsed = /^\d+$/.test(draft.trim()) ? Number(draft.trim()) : NaN;
      const share = validateHouseholdShare(parsed, label);
      setSaving(true);
      await onSave(share);
      setDraft(String(share));
      setSaved(true);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to save the share.");
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="household-share-form" aria-label={`Edit ${label}`} onSubmit={(event) => void submit(event)} noValidate>
      <label>
        {label}
        <input
          ref={inputRef}
          inputMode="numeric"
          value={draft}
          onChange={(event) => { setDraft(event.currentTarget.value); setError(null); setSaved(false); }}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={error !== null ? `${hintId} ${errorId}` : hintId}
        />
      </label>
      <button type="submit" disabled={saving}>{buttonLabel}</button>
      <p className="household-share-hint" id={hintId}>
        0 is 0%; 10000 is 100%. This does not determine legal ownership or liability.
      </p>
      {error !== null && <p id={errorId} className="property-registry-message" role="alert">{error}</p>}
      {saved && <p className="property-registry-message" role="status">{successMessage}</p>}
    </form>
  );
}
