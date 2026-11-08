import React from "react";
interface PropertyCreateFormProps {
  addProperty: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  propertyCreateError: string | null;
  setPropertyLabel: React.Dispatch<React.SetStateAction<string>>;
  propertyLabel: string;
  isSaving: boolean;
  cancelPropertyCreateForm: () => void;
}

export function PropertyCreateForm({ addProperty, propertyCreateError, setPropertyLabel, propertyLabel, isSaving, cancelPropertyCreateForm }: PropertyCreateFormProps): React.JSX.Element {
  return (<form className="property-create-form" aria-label="Add property" onSubmit={addProperty}>
    <label>
      Property label
      <input
        autoComplete="off"
        aria-invalid={propertyCreateError === "Enter a property label." ? true : undefined}
        aria-describedby={propertyCreateError === null
          ? undefined
          : "property-label-create-error"}
        aria-required="true"
        autoFocus
        maxLength={100}
        onChange={(event) => setPropertyLabel(event.currentTarget.value)}
        value={propertyLabel}
      />
    </label>
    <button disabled={isSaving} type="submit">
      {isSaving ? "Saving property..." : "Save property"}
    </button>
    <button disabled={isSaving} onClick={cancelPropertyCreateForm} type="button">
      Cancel
    </button>
  </form>);
}
