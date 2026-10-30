import React from "react";
import { BackupSection } from "../backup/BackupSection.js";
import { ExportSection } from "../backup/ExportSection.js";
import { RestoreSnapshotSection } from "../dashboard/RestoreSnapshotSection.js";
import { parseCurrencyAmountMinor } from "./parseCurrencyAmountMinor.js";
import { HouseholdShareForm, useHouseholdShareFormStates } from "./HouseholdShareForm.js";
import { DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS } from "../../domain/householdShareValidation.js";
import {
  HoldingRecordValidationError,
  validateHoldingCorrectionInput,
  validateHoldingRecordInput,
  validateHoldingValuationCorrectionInput,
  validateHoldingValuationInput,
} from "../../domain/holdingRecordValidation.js";
import {
  validatePropertyValuationCorrectionInput,
  validatePropertyValuationInput,
} from "../../domain/propertyRecordValidation.js";
import type {
  HoldingRecordValidationField,
} from "../../domain/holdingRecordValidation.js";
import type {
  HoldingRecordInput,
  HoldingValuationInput,
  HoldingValuationSnapshot,
  HoldingWithValuations,
  PropertyValuationCorrectionInput,
  PropertyValuationInput,
  PropertyValuationSnapshot,
  PropertyWithValuations,
} from "../../domain/types.js";

interface DataSafetyWorkspaceProps {
  isActive: boolean;
  onRestoreSuccess: () => void;
}

export function DataSafetyWorkspace({ isActive, onRestoreSuccess }: DataSafetyWorkspaceProps): React.JSX.Element {
  const [catalogRevision, setCatalogRevision] = React.useState(0);

  function refreshSnapshotCatalog(): void {
    setCatalogRevision((revision) => revision + 1);
  }

  return (
    <section
      className="destination-workspace household-workspace"
      aria-label="Data safety workspace"
      hidden={!isActive}
    >
      <div className="destination-heading">
        <h2>Data safety</h2>
        <p>Create a local backup, export ledger data, or restore a saved snapshot.</p>
      </div>
      <div className="workflow-recovery-grid">
        <BackupSection onBackupSuccess={refreshSnapshotCatalog} />
        <ExportSection />
        <RestoreSnapshotSection
          catalogRevision={catalogRevision}
          onRestoreSuccess={() => {
            onRestoreSuccess();
            refreshSnapshotCatalog();
          }}
        />
      </div>
    </section>
  );
}

interface HoldingDraft {
  label: string;
  quantity: string;
  costBasis: string;
  currencyCode: string;
}

interface HoldingValuationDraft {
  effectiveDateIso: string;
  amount: string;
  currencyCode: string;
}

type HoldingFormField = "label" | "quantity" | "costBasisMinor" | "currencyCode";
type HoldingValuationFormField = "effectiveDateIso" | "amountMinor" | "currencyCode";

const EMPTY_HOLDING_DRAFT: HoldingDraft = {
  label: "",
  quantity: "",
  costBasis: "",
  currencyCode: "NOK",
};

const holdingAmountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const holdingRecordedAtFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatHoldingAmount(amountMinor: number, currencyCode: string): string {
  return `${currencyCode} ${holdingAmountFormatter.format(amountMinor / 100)}`;
}

function holdingFormField(field: HoldingRecordValidationField): HoldingFormField | undefined {
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

function holdingValuationFormField(
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

function holdingAmountInput(amountMinor: number): string {
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

function HoldingCorrectionControls({
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
    costBasis: holdingAmountInput(holding.costBasisMinor),
    currencyCode: holding.currencyCode,
  }));
  const [error, setError] = React.useState<{ message: string; field?: HoldingFormField } | null>(null);
  React.useEffect(() => {
    setDraft({
      label: holding.label,
      quantity: String(holding.quantity),
      costBasis: holdingAmountInput(holding.costBasisMinor),
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

function HoldingHistory({
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
                          amount: holdingAmountInput(valuation.amountMinor),
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

export function HoldingRegistrySection({
  isActive,
  refreshRevision,
}: {
  isActive: boolean;
  refreshRevision: number;
}): React.JSX.Element {
  const [holdings, setHoldings] = React.useState<HoldingWithValuations[]>([]);
  const [selectedHoldingId, setSelectedHoldingId] = React.useState<string | null>(null);
  const [holdingDraft, setHoldingDraft] = React.useState(EMPTY_HOLDING_DRAFT);
  const [valuationDrafts, setValuationDrafts] = React.useState<
    Record<string, HoldingValuationDraft>
  >({});
  const [holdingErrors, setHoldingErrors] = React.useState<Partial<Record<HoldingFormField, string>>>({});
  const [holdingFormError, setHoldingFormError] = React.useState<string | null>(null);
  const [holdingStatus, setHoldingStatus] = React.useState<string | null>(null);
  const [valuationErrors, setValuationErrors] = React.useState<
    Record<string, Partial<Record<HoldingValuationFormField, string>>>
  >({});
  const [valuationFormErrors, setValuationFormErrors] = React.useState<Record<string, string>>({});
  const [valuationStatuses, setValuationStatuses] = React.useState<Record<string, string>>({});
  const [revision, setRevision] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const holdingFieldRefs = React.useRef<Partial<Record<HoldingFormField, HTMLInputElement | null>>>({});
  const valuationFieldRefs = React.useRef<
    Record<string, Partial<Record<"effectiveDateIso" | "amount" | "currencyCode", HTMLInputElement | null>>>
  >({});

  React.useEffect(() => {
    if (!isActive) return;
    let active = true;
    setIsLoading(true);
    setLoadError(null);
    window.budgetApi.holdingRegistry.list()
      .then((loadedHoldings) => {
        if (!active) return;
        setHoldings(loadedHoldings);
        setSelectedHoldingId((selectedId) => (
          selectedId !== null && loadedHoldings.some((holding) => holding.id === selectedId)
            ? selectedId
            : loadedHoldings[0]?.id ?? null
        ));
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error, "Unable to load investment holdings."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isActive, refreshRevision, revision]);

  function focusHoldingField(field: HoldingFormField): void {
    window.requestAnimationFrame(() => holdingFieldRefs.current[field]?.focus());
  }

  function focusValuationField(
    holdingId: string,
    field: "effectiveDateIso" | "amount" | "currencyCode"
  ): void {
    window.requestAnimationFrame(() => valuationFieldRefs.current[holdingId]?.[field]?.focus());
  }

  function updateHoldingDraft(field: keyof HoldingDraft, value: string): void {
    const validationField = field === "costBasis" ? "costBasisMinor" : field;
    setHoldingErrors((current) => {
      const next = { ...current };
      delete next[validationField];
      return next;
    });
    setHoldingFormError(null);
    setHoldingStatus(null);
    setHoldingDraft((current) => ({ ...current, [field]: value }));
  }

  async function addHolding(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSaving || isLoading || loadError !== null) return;
    setHoldingErrors({});
    setHoldingFormError(null);
    setHoldingStatus(null);

    const costBasisMinor = parseCurrencyAmountMinor(holdingDraft.costBasis);
    if (costBasisMinor === null) {
      setHoldingErrors({
        costBasisMinor: "Enter a non-negative cost basis with up to two decimal places.",
      });
      focusHoldingField("costBasisMinor");
      return;
    }

    let validated: HoldingRecordInput;
    try {
      validated = validateHoldingRecordInput({
        label: holdingDraft.label,
        quantity: Number(holdingDraft.quantity),
        costBasisMinor,
        currencyCode: holdingDraft.currencyCode,
      });
    } catch (validationError: unknown) {
      if (validationError instanceof HoldingRecordValidationError) {
        const allFieldErrors: Partial<Record<HoldingFormField, string>> = {};
        for (const field of ["label", "quantity", "costBasisMinor", "currencyCode"] as const) {
          const message = validationError.fieldErrors?.[field];
          if (message !== undefined) allFieldErrors[field] = message;
        }
        if (Object.keys(allFieldErrors).length > 0) {
          setHoldingErrors(allFieldErrors);
          const firstField = (["label", "quantity", "costBasisMinor", "currencyCode"] as const)
            .find((field) => allFieldErrors[field] !== undefined);
          if (firstField !== undefined) focusHoldingField(firstField);
          return;
        }
        const field = holdingFormField(validationError.field);
        if (field !== undefined) {
          setHoldingErrors({ [field]: validationError.message });
          focusHoldingField(field);
        } else {
          setHoldingFormError(validationError.message);
        }
      } else {
        setHoldingFormError(errorMessage(validationError, "Unable to validate the investment holding."));
      }
      return;
    }

    setIsSaving(true);
    try {
      const created = await window.budgetApi.holdingRegistry.create(validated);
      setSelectedHoldingId(created.id);
      setHoldingDraft(EMPTY_HOLDING_DRAFT);
      setHoldingStatus("Investment holding added.");
      setRevision((current) => current + 1);
    } catch (saveError: unknown) {
      setHoldingFormError(errorMessage(saveError, "Unable to add the investment holding."));
    } finally {
      setIsSaving(false);
    }
  }

  function initialValuationDraft(holding: HoldingWithValuations): HoldingValuationDraft {
    return {
      effectiveDateIso: "",
      amount: "",
      currencyCode: holding.currencyCode,
    };
  }

  function valuationDraft(holding: HoldingWithValuations): HoldingValuationDraft {
    return valuationDrafts[holding.id] ?? initialValuationDraft(holding);
  }

  function updateValuationDraft(
    holdingId: string,
    field: keyof HoldingValuationDraft,
    value: string,
    defaultCurrencyCode: string
  ): void {
    setValuationErrors((current) => {
      const next = { ...current };
      const holdingErrors = { ...(next[holdingId] ?? {}) };
      const validationField = field === "amount" ? "amountMinor" : field;
      delete holdingErrors[validationField];
      if (Object.keys(holdingErrors).length === 0) {
        delete next[holdingId];
      } else {
        next[holdingId] = holdingErrors;
      }
      return next;
    });
    setValuationFormErrors((current) => {
      const next = { ...current };
      delete next[holdingId];
      return next;
    });
    setValuationStatuses((current) => {
      const next = { ...current };
      delete next[holdingId];
      return next;
    });
    setValuationDrafts((current) => ({
      ...current,
      [holdingId]: {
        ...(current[holdingId] ?? {
          effectiveDateIso: "",
          amount: "",
          currencyCode: defaultCurrencyCode,
        }),
        [field]: value,
      },
    }));
  }

  async function addValuation(
    event: React.FormEvent<HTMLFormElement>,
    holding: HoldingWithValuations
  ): Promise<void> {
    event.preventDefault();
    if (isSaving || isLoading || loadError !== null) return;
    setValuationErrors((current) => {
      const next = { ...current };
      delete next[holding.id];
      return next;
    });
    setValuationFormErrors((current) => {
      const next = { ...current };
      delete next[holding.id];
      return next;
    });
    setValuationStatuses((current) => {
      const next = { ...current };
      delete next[holding.id];
      return next;
    });

    const draft = valuationDraft(holding);
    const amountMinor = parseCurrencyAmountMinor(draft.amount);
    if (amountMinor === null) {
      setValuationErrors((current) => ({
        ...current,
        [holding.id]: {
          amountMinor: "Enter a non-negative value with up to two decimal places.",
        },
      }));
      focusValuationField(holding.id, "amount");
      return;
    }

    let validated: HoldingValuationInput;
    try {
      validated = validateHoldingValuationInput({
        holdingId: holding.id,
        effectiveDateIso: draft.effectiveDateIso,
        amountMinor,
        currencyCode: draft.currencyCode,
      });
    } catch (validationError: unknown) {
      if (validationError instanceof HoldingRecordValidationError) {
        const field = holdingValuationFormField(validationError.field);
        if (field !== undefined) {
          setValuationErrors((current) => ({
            ...current,
            [holding.id]: { [field]: validationError.message },
          }));
          focusValuationField(
            holding.id,
            field === "amountMinor" ? "amount" : field
          );
        } else {
          setValuationFormErrors((current) => ({
            ...current,
            [holding.id]: validationError.message,
          }));
        }
      } else {
        setValuationFormErrors((current) => ({
          ...current,
          [holding.id]: errorMessage(validationError, "Unable to validate the value."),
        }));
      }
      return;
    }

    setIsSaving(true);
    try {
      await window.budgetApi.holdingRegistry.appendValuation(validated);
      setValuationDrafts((current) => ({
        ...current,
        [holding.id]: {
          ...(current[holding.id] ?? initialValuationDraft(holding)),
          effectiveDateIso: "",
          amount: "",
        },
      }));
      setValuationStatuses((current) => ({
        ...current,
        [holding.id]: `Value added for ${holding.label}.`,
      }));
      setRevision((current) => current + 1);
    } catch (saveError: unknown) {
      setValuationFormErrors((current) => ({
        ...current,
        [holding.id]: errorMessage(saveError, "Unable to add the holding value."),
      }));
    } finally {
      setIsSaving(false);
    }
  }

  const isRegistryEmpty = !isLoading && loadError === null && holdings.length === 0;

  return (
    <section className={`holding-registry-section${isRegistryEmpty ? " registry-empty-state" : ""}`} aria-label="Investment holdings registry">
      {isRegistryEmpty && (
        <p className="holding-registry-empty">No investment holdings have been recorded.</p>
      )}
      <p className="holding-local-note">
        Cost basis is the total acquisition cost. Each valuation is the total value of the holding.
      </p>
      <form
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
      </form>
      {Object.entries(holdingErrors).map(([field, message]) => (
        <p
          key={field}
          id={`holding-error-${field}`}
          className="holding-registry-message"
          role="alert"
        >
          {message}
        </p>
      ))}
      {holdingFormError !== null && (
        <p className="holding-registry-message" role="alert">{holdingFormError}</p>
      )}
      {holdingStatus !== null && (
        <p className="holding-registry-message" role="status">{holdingStatus}</p>
      )}
      {loadError !== null && (
        <p className="holding-registry-message" role="alert">{loadError}</p>
      )}
      {isLoading && (
        <p className="holding-registry-empty" role="status">Loading investment holdings...</p>
      )}
      {holdings.length === 0 ? null : (
        <div className="holding-workspace-grid">
          <nav className="holding-record-navigation" aria-label="Investment holdings">
            {holdings.map((holding) => (
              <button
                key={holding.id}
                type="button"
                aria-current={holding.id === selectedHoldingId ? "page" : undefined}
                onClick={() => setSelectedHoldingId(holding.id)}
              >
                {holding.label}
              </button>
            ))}
          </nav>
          {holdings.map((holding) => {
            const draft = valuationDraft(holding);
            const fields = valuationErrors[holding.id] ?? {};
            const generalError = valuationFormErrors[holding.id];
            const status = valuationStatuses[holding.id];
            const errorId = `holding-valuation-error-${holding.id}`;
            return (
              <section
                className="holding-record"
                key={holding.id}
                aria-label={`Holding ${holding.label}`}
                hidden={holding.id !== selectedHoldingId}
              >
                <h3>{holding.label}</h3>
                <dl className="holding-summary">
                  <div>
                    <dt>Quantity</dt>
                    <dd>{holding.quantity}</dd>
                  </div>
                  <div>
                    <dt>Cost basis</dt>
                    <dd>{formatHoldingAmount(holding.costBasisMinor, holding.currencyCode)}</dd>
                  </div>
                </dl>
                <HoldingCorrectionControls
                  holding={holding}
                  disabled={isSaving || isLoading || loadError !== null}
                  setSaving={setIsSaving}
                  onSaved={(message) => {
                    setHoldingStatus(message);
                    setRevision((current) => current + 1);
                  }}
                />
                <form
                  className="holding-valuation-form"
                  aria-label={`Add valuation for ${holding.label}`}
                  onSubmit={(event) => void addValuation(event, holding)}
                >
                  <label>
                    Effective date
                    <input
                      type="date"
                      aria-invalid={fields.effectiveDateIso === undefined ? undefined : true}
                      aria-describedby={fields.effectiveDateIso === undefined ? undefined : errorId}
                      onChange={(event) =>
                        updateValuationDraft(
                          holding.id,
                          "effectiveDateIso",
                          event.currentTarget.value,
                          holding.currencyCode
                        )}
                      ref={(element) => {
                        const refs = valuationFieldRefs.current[holding.id] ?? {};
                        refs.effectiveDateIso = element;
                        valuationFieldRefs.current[holding.id] = refs;
                      }}
                      value={draft.effectiveDateIso}
                    />
                  </label>
                  <label>
                    Amount
                    <input
                      inputMode="decimal"
                      aria-invalid={fields.amountMinor === undefined ? undefined : true}
                      aria-describedby={fields.amountMinor === undefined ? undefined : errorId}
                      onChange={(event) =>
                        updateValuationDraft(
                          holding.id,
                          "amount",
                          event.currentTarget.value,
                          holding.currencyCode
                        )}
                      ref={(element) => {
                        const refs = valuationFieldRefs.current[holding.id] ?? {};
                        refs.amount = element;
                        valuationFieldRefs.current[holding.id] = refs;
                      }}
                      value={draft.amount}
                    />
                  </label>
                  <label>
                    Currency code
                    <input
                      autoCapitalize="characters"
                      maxLength={3}
                      aria-invalid={fields.currencyCode === undefined ? undefined : true}
                      aria-describedby={fields.currencyCode === undefined ? undefined : errorId}
                      onChange={(event) =>
                        updateValuationDraft(
                          holding.id,
                          "currencyCode",
                          event.currentTarget.value,
                          holding.currencyCode
                        )}
                      ref={(element) => {
                        const refs = valuationFieldRefs.current[holding.id] ?? {};
                        refs.currencyCode = element;
                        valuationFieldRefs.current[holding.id] = refs;
                      }}
                      value={draft.currencyCode}
                    />
                  </label>
                  <button disabled={isSaving || isLoading || loadError !== null} type="submit">
                    {isSaving ? "Saving value..." : "Save value"}
                  </button>
                </form>
                {Object.keys(fields).length > 0 && (
                  <p id={errorId} className="holding-registry-message" role="alert">
                    {Object.values(fields).join(" ")}
                  </p>
                )}
                {generalError !== undefined && (
                  <p className="holding-registry-message" role="alert">{generalError}</p>
                )}
                {status !== undefined && (
                  <p className="holding-registry-message" role="status">{status}</p>
                )}
                <HoldingHistory
                  holding={holding}
                  disabled={isSaving || isLoading || loadError !== null}
                  setSaving={setIsSaving}
                  onSaved={(message) => {
                    setValuationStatuses((current) => ({ ...current, [holding.id]: message }));
                    setRevision((current) => current + 1);
                  }}
                />
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface PropertyRegistrySectionProps {
  isActive: boolean;
  refreshRevision: number;
  onPropertyRegistryChange: () => void;
  requestedPropertyId: string | null;
}

interface PropertyValuationDraft {
  effectiveDateIso: string;
  amount: string;
  currencyCode: string;
}

type PropertyValuationDraftField = keyof PropertyValuationDraft;

interface PropertyFormError {
  message: string;
  field?: PropertyValuationDraftField | "label";
}

const EMPTY_VALUATION_DRAFT: PropertyValuationDraft = {
  effectiveDateIso: "",
  amount: "",
  currencyCode: "NOK",
};

const propertyAmountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const propertyRecordedAtFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "short",
  timeStyle: "short",
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function valuationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes("effectiveDateIso")) {
    return "Enter a valid effective date.";
  }
  if (error instanceof Error && error.message.includes("currencyCode")) {
    return "Enter a three-letter uppercase currency code.";
  }
  return errorMessage(error, "Unable to save the property valuation.");
}

function valuationErrorField(error: unknown): PropertyValuationDraftField | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message.includes("effectiveDateIso")) return "effectiveDateIso";
  if (error.message.includes("currencyCode")) return "currencyCode";
  if (error.message.includes("amountMinor")) return "amount";
  return undefined;
}

function propertyValuationFormError(error: unknown): PropertyFormError {
  const field = valuationErrorField(error);
  return {
    message: valuationErrorMessage(error),
    ...(field === undefined ? {} : { field }),
  };
}

function correctionErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    (error.message.includes("Active property valuation not found") ||
      error.message.includes("has already been corrected"))
  ) {
    return "This valuation has changed. Refresh the history and choose a current entry.";
  }
  return valuationErrorMessage(error);
}

export function PropertyRegistrySection({
  isActive,
  refreshRevision,
  onPropertyRegistryChange,
  requestedPropertyId,
}: PropertyRegistrySectionProps): React.JSX.Element {
  const [properties, setProperties] = React.useState<PropertyWithValuations[]>([]);
  const [propertyLabel, setPropertyLabel] = React.useState("");
  const [selectedPropertyId, setSelectedPropertyId] = React.useState<string | null>(null);
  const [isCompactPropertyDetailOpen, setIsCompactPropertyDetailOpen] = React.useState(false);
  const [propertyLabelDrafts, setPropertyLabelDrafts] = React.useState<Record<string, string>>({});
  const [shareFormStates, setShareFormStates] = useHouseholdShareFormStates();
  const [valuationDrafts, setValuationDrafts] = React.useState<Record<string, PropertyValuationDraft>>({});
  const [correctionDrafts, setCorrectionDrafts] = React.useState<Record<string, PropertyValuationDraft>>({});
  const [isPropertyCreateFormOpen, setIsPropertyCreateFormOpen] = React.useState(false);
  const [activeValuationPropertyId, setActiveValuationPropertyId] = React.useState<string | null>(null);
  const [formErrors, setFormErrors] = React.useState<Record<string, PropertyFormError>>({});
  const [formStatuses, setFormStatuses] = React.useState<Record<string, string>>({});
  const [revision, setRevision] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [propertyCreateError, setPropertyCreateError] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const addPropertyButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const propertyNavigationButtonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const propertyRecordRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const recordValueButtonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const valuationFieldRefs = React.useRef<
    Record<string, Partial<Record<PropertyValuationDraftField, HTMLInputElement | null>>>
  >({});
  const restorePropertyFormFocusRef = React.useRef(false);
  const restoreValuationFocusPropertyIdRef = React.useRef<string | null>(null);
  const restorePropertyNavigationFocusIdRef = React.useRef<string | null>(null);
  const focusSelectedPropertyIdRef = React.useRef<string | null>(null);

  function focusPropertyRecord(propertyId: string): void {
    const propertyRecord = propertyRecordRefs.current[propertyId] ??
      document.getElementById(`property-record-${propertyId}`);
    propertyRecord?.scrollIntoView({ block: "start" });
    propertyRecord?.focus();
  }

  React.useLayoutEffect(() => {
    if (isPropertyCreateFormOpen || !restorePropertyFormFocusRef.current) return;
    restorePropertyFormFocusRef.current = false;
    addPropertyButtonRef.current?.focus();
  }, [isPropertyCreateFormOpen]);

  React.useLayoutEffect(() => {
    if (activeValuationPropertyId !== null) return;
    const propertyId = restoreValuationFocusPropertyIdRef.current;
    if (propertyId === null) return;
    restoreValuationFocusPropertyIdRef.current = null;
    const recordValueButton = recordValueButtonRefs.current[propertyId];
    recordValueButton?.scrollIntoView({ block: "start" });
    recordValueButton?.focus();
  }, [activeValuationPropertyId]);

  React.useLayoutEffect(() => {
    const propertyId = focusSelectedPropertyIdRef.current;
    if (propertyId === null || isLoading || activeValuationPropertyId !== null || isPropertyCreateFormOpen) {
      return;
    }
    const propertyRecord = propertyRecordRefs.current[propertyId];
    if (propertyRecord === null || propertyRecord === undefined) return;
    focusSelectedPropertyIdRef.current = null;
    focusPropertyRecord(propertyId);
  }, [activeValuationPropertyId, isLoading, isPropertyCreateFormOpen, properties, selectedPropertyId]);

  React.useLayoutEffect(() => {
    if (isCompactPropertyDetailOpen) return;
    const propertyId = restorePropertyNavigationFocusIdRef.current;
    if (propertyId === null) return;
    restorePropertyNavigationFocusIdRef.current = null;
    propertyNavigationButtonRefs.current[propertyId]?.focus();
  }, [isCompactPropertyDetailOpen]);

  function setFormError(key: string, value: PropertyFormError | null): void {
    setFormErrors((current) => {
      const next = { ...current };
      if (value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  function setFormStatus(key: string, value: string | null): void {
    setFormStatuses((current) => {
      const next = { ...current };
      if (value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  React.useEffect(() => {
    if (!isActive) return;
    let active = true;
    setIsLoading(true);
    setLoadError(null);
    window.budgetApi.propertyRegistry.list()
      .then((loadedProperties) => {
        if (!active) return;
        setProperties(loadedProperties);
        setSelectedPropertyId((selectedId) => (
          selectedId !== null && loadedProperties.some((property) => property.id === selectedId)
            ? selectedId
            : loadedProperties[0]?.id ?? null
        ));
      })
      .catch((loadError: unknown) => {
        if (active) setLoadError(errorMessage(loadError, "Unable to load properties."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isActive, refreshRevision, revision]);

  React.useEffect(() => {
    if (
      !isActive ||
      requestedPropertyId === null ||
      !properties.some((property) => property.id === requestedPropertyId)
    ) {
      return;
    }
    selectProperty(requestedPropertyId);
  }, [isActive, properties, requestedPropertyId]);

  function openPropertyCreateForm(): void {
    setPropertyCreateError(null);
    setStatusMessage(null);
    setIsPropertyCreateFormOpen(true);
  }

  function selectProperty(propertyId: string): void {
    focusSelectedPropertyIdRef.current = propertyId;
    setSelectedPropertyId(propertyId);
    setIsCompactPropertyDetailOpen(true);
  }

  function showPropertyList(propertyId: string): void {
    restorePropertyNavigationFocusIdRef.current = propertyId;
    setIsCompactPropertyDetailOpen(false);
  }

  function cancelPropertyCreateForm(): void {
    if (isSaving) return;
    if (
      propertyLabel.trim().length > 0 &&
      !window.confirm("Discard the unsaved property label?")
    ) {
      return;
    }

    setPropertyLabel("");
    setPropertyCreateError(null);
    restorePropertyFormFocusRef.current = true;
    setIsPropertyCreateFormOpen(false);
  }

  async function addProperty(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSaving) return;
    setPropertyCreateError(null);
    setStatusMessage(null);
    if (propertyLabel.trim().length === 0) {
      setPropertyCreateError("Enter a property label.");
      return;
    }

    setIsSaving(true);
    try {
      const property = await window.budgetApi.propertyRegistry.create({ label: propertyLabel.trim() });
      setPropertyLabel("");
      setStatusMessage("Property added.");
      focusSelectedPropertyIdRef.current = property.id;
      selectProperty(property.id);
      onPropertyRegistryChange();
      setRevision((current) => current + 1);
      setIsPropertyCreateFormOpen(false);
    } catch (saveError: unknown) {
      setPropertyCreateError(errorMessage(saveError, "Unable to add the property."));
    } finally {
      setIsSaving(false);
    }
  }

  function updateValuationDraft(
    propertyId: string,
    field: keyof PropertyValuationDraft,
    value: string
  ): void {
    setFormError(`valuation:${propertyId}`, null);
    setFormStatus(`valuation:${propertyId}`, null);
    setValuationDrafts((current) => ({
      ...current,
      [propertyId]: {
        ...(current[propertyId] ?? EMPTY_VALUATION_DRAFT),
        [field]: value,
      },
    }));
  }

  function openValuationForm(propertyId: string): void {
    setFormError(`valuation:${propertyId}`, null);
    setFormStatus(`valuation:${propertyId}`, null);
    setActiveValuationPropertyId(propertyId);
  }

  function setValuationFieldRef(
    propertyId: string,
    field: PropertyValuationDraftField,
    element: HTMLInputElement | null
  ): void {
    const fieldRefs = valuationFieldRefs.current[propertyId] ?? {};
    fieldRefs[field] = element;
    valuationFieldRefs.current[propertyId] = fieldRefs;
  }

  function focusValuationError(
    propertyId: string,
    field: PropertyFormError["field"] | undefined
  ): void {
    window.requestAnimationFrame(() => {
      const valuationField = field === "label" ? undefined : field;
      if (valuationField !== undefined) {
        valuationFieldRefs.current[propertyId]?.[valuationField]?.focus();
      }
      document.getElementById(`valuation-error-${propertyId}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function cancelValuationForm(propertyId: string): void {
    if (isSaving) return;
    const draft = valuationDrafts[propertyId] ?? EMPTY_VALUATION_DRAFT;
    const isDirty =
      draft.effectiveDateIso.length > 0 ||
      draft.amount.length > 0 ||
      draft.currencyCode !== EMPTY_VALUATION_DRAFT.currencyCode;
    if (isDirty && !window.confirm("Discard the unsaved property value?")) return;

    setValuationDrafts((current) => ({
      ...current,
      [propertyId]: EMPTY_VALUATION_DRAFT,
    }));
    setFormError(`valuation:${propertyId}`, null);
    setFormStatus(`valuation:${propertyId}`, null);
    restoreValuationFocusPropertyIdRef.current = propertyId;
    setActiveValuationPropertyId(null);
  }

  function updatePropertyLabelDraft(propertyId: string, value: string): void {
    setFormError(`label:${propertyId}`, null);
    setFormStatus(`label:${propertyId}`, null);
    setPropertyLabelDrafts((current) => ({ ...current, [propertyId]: value }));
  }

  function initialCorrectionDraft(valuation: PropertyValuationSnapshot): PropertyValuationDraft {
    return {
      effectiveDateIso: valuation.effectiveDateIso,
      amount: (valuation.amountMinor / 100).toFixed(2),
      currencyCode: valuation.currencyCode,
    };
  }

  function correctionDraft(valuation: PropertyValuationSnapshot): PropertyValuationDraft {
    return correctionDrafts[valuation.id] ?? initialCorrectionDraft(valuation);
  }

  function updateCorrectionDraft(
    valuation: PropertyValuationSnapshot,
    field: PropertyValuationDraftField,
    value: string
  ): void {
    setFormError(`correction:${valuation.id}`, null);
    setFormStatus(`correction:${valuation.id}`, null);
    setCorrectionDrafts((current) => ({
      ...current,
      [valuation.id]: {
        ...(current[valuation.id] ?? initialCorrectionDraft(valuation)),
        [field]: value,
      },
    }));
  }

  async function addValuation(
    event: React.FormEvent<HTMLFormElement>,
    property: PropertyWithValuations
  ): Promise<void> {
    event.preventDefault();
    if (isSaving) return;
    const feedbackKey = `valuation:${property.id}`;
    setFormError(feedbackKey, null);
    setFormStatus(feedbackKey, null);
    const draft = valuationDrafts[property.id] ?? EMPTY_VALUATION_DRAFT;
    const amountMinor = parseCurrencyAmountMinor(draft.amount);
    if (amountMinor === null) {
      setFormError(feedbackKey, {
        message: "Enter a non-negative amount with up to two decimal places.",
        field: "amount",
      });
      focusValuationError(property.id, "amount");
      return;
    }

    let input: PropertyValuationInput;
    try {
      input = validatePropertyValuationInput({
        propertyId: property.id,
        effectiveDateIso: draft.effectiveDateIso,
        amountMinor,
        currencyCode: draft.currencyCode,
      });
    } catch (validationError: unknown) {
      const error = propertyValuationFormError(validationError);
      setFormError(feedbackKey, error);
      focusValuationError(property.id, error.field);
      return;
    }

    setIsSaving(true);
    try {
      await window.budgetApi.propertyRegistry.appendValuation(input);
      const propertyRecord = propertyRecordRefs.current[property.id];
      propertyRecord?.scrollIntoView({ block: "start" });
      propertyRecord?.focus();
      setFormStatus(feedbackKey, `Valuation added for ${property.label}.`);
      setValuationDrafts((current) => ({
        ...current,
        [property.id]: {
          ...(current[property.id] ?? EMPTY_VALUATION_DRAFT),
          effectiveDateIso: "",
          amount: "",
        },
      }));
      setIsLoading(true);
      setRevision((current) => current + 1);
      focusSelectedPropertyIdRef.current = property.id;
      setActiveValuationPropertyId(null);
      window.requestAnimationFrame(() => focusPropertyRecord(property.id));
    } catch (saveError: unknown) {
      const error = propertyValuationFormError(saveError);
      setFormError(feedbackKey, error);
      focusValuationError(property.id, error.field);
    } finally {
      setIsSaving(false);
    }
  }

  async function renameProperty(
    event: React.FormEvent<HTMLFormElement>,
    property: PropertyWithValuations
  ): Promise<void> {
    event.preventDefault();
    if (isSaving) return;
    const feedbackKey = `label:${property.id}`;
    setFormError(feedbackKey, null);
    setFormStatus(feedbackKey, null);
    const label = (propertyLabelDrafts[property.id] ?? property.label).trim();
    if (label.length === 0) {
      setFormError(feedbackKey, { message: "Enter a property label.", field: "label" });
      return;
    }

    setIsSaving(true);
    try {
      await window.budgetApi.propertyRegistry.renameProperty({ propertyId: property.id, label });
      setPropertyLabelDrafts((current) => ({ ...current, [property.id]: label }));
      setFormStatus(feedbackKey, "Property label updated.");
      onPropertyRegistryChange();
      setRevision((current) => current + 1);
    } catch (saveError: unknown) {
      setFormError(feedbackKey, {
        message: errorMessage(saveError, "Unable to update the property label."),
        field: "label",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function supersedeValuation(
    event: React.FormEvent<HTMLFormElement>,
    property: PropertyWithValuations,
    target: PropertyValuationSnapshot
  ): Promise<void> {
    event.preventDefault();
    if (isSaving) return;
    const feedbackKey = `correction:${target.id}`;
    setFormError(feedbackKey, null);
    setFormStatus(feedbackKey, null);
    const draft = correctionDraft(target);
    const amountMinor = parseCurrencyAmountMinor(draft.amount);
    if (amountMinor === null) {
      setFormError(feedbackKey, {
        message: "Enter a non-negative amount with up to two decimal places.",
        field: "amount",
      });
      return;
    }

    let input: PropertyValuationCorrectionInput;
    try {
      input = validatePropertyValuationCorrectionInput({
        action: "supersede",
        propertyId: property.id,
        targetValuationId: target.id,
        effectiveDateIso: draft.effectiveDateIso,
        amountMinor,
        currencyCode: draft.currencyCode,
      });
    } catch (validationError: unknown) {
      setFormError(feedbackKey, propertyValuationFormError(validationError));
      return;
    }

    setIsSaving(true);
    try {
      await window.budgetApi.propertyRegistry.appendCorrection(input);
      setFormStatus(feedbackKey, "Correction added. Earlier valuation history is preserved.");
      setRevision((current) => current + 1);
    } catch (saveError: unknown) {
      const field = valuationErrorField(saveError);
      setFormError(feedbackKey, {
        message: correctionErrorMessage(saveError),
        ...(field === undefined ? {} : { field }),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function voidValuation(
    property: PropertyWithValuations,
    target: PropertyValuationSnapshot
  ): Promise<void> {
    if (isSaving) return;
    const confirmationMessage =
      `Mark ${property.label}'s ${target.effectiveDateIso} ${target.currencyCode} ` +
      `${propertyAmountFormatter.format(target.amountMinor / 100)} valuation as void? ` +
      "The entry stays in history but will no longer count as current.";
    if (!window.confirm(confirmationMessage)) return;

    const feedbackKey = `correction:${target.id}`;
    setFormError(feedbackKey, null);
    setFormStatus(feedbackKey, null);
    setIsSaving(true);
    try {
      await window.budgetApi.propertyRegistry.appendCorrection({
        action: "void",
        propertyId: property.id,
        targetValuationId: target.id,
      });
      setFormStatus(feedbackKey, "Void record added. The original valuation remains in history.");
      setRevision((current) => current + 1);
    } catch (saveError: unknown) {
      setFormError(feedbackKey, {
        message: correctionErrorMessage(saveError),
      });
    } finally {
      setIsSaving(false);
    }
  }

  const activePropertyId = selectedPropertyId ?? properties[0]?.id ?? null;
  const isRegistryEmpty = !isLoading && loadError === null && properties.length === 0 && !isPropertyCreateFormOpen;

  return (
    <section className={`property-registry-section${isRegistryEmpty ? " registry-empty-state" : ""}`} aria-label="Property registry">
      {isRegistryEmpty && <p className="property-registry-empty">No properties have been recorded.</p>}
      {!isPropertyCreateFormOpen && (
        <button
          ref={addPropertyButtonRef}
          disabled={isSaving || isLoading || loadError !== null}
          onClick={openPropertyCreateForm}
          type="button"
        >
          Add property
        </button>
      )}
      {isPropertyCreateFormOpen && (
        <form className="property-create-form" aria-label="Add property" onSubmit={addProperty}>
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
        </form>
      )}
      {propertyCreateError !== null && (
        <p
          id="property-label-create-error"
          className="property-registry-message"
          role="alert"
        >
          {propertyCreateError}
        </p>
      )}
      {statusMessage !== null && <p className="property-registry-message" role="status">{statusMessage}</p>}
      {loadError !== null && <p className="property-registry-message" role="alert">{loadError}</p>}
      {isLoading ? (
        <p className="property-registry-empty" role="status">Loading property records...</p>
      ) : properties.length === 0 ? null : (
        <div className={`property-workspace-grid${isCompactPropertyDetailOpen
          ? " is-compact-detail-open"
          : ""}`}>
          <nav className="property-record-navigation" aria-label="Property records">
            {properties.map((property) => (
              <button
                key={property.id}
                ref={(element) => { propertyNavigationButtonRefs.current[property.id] = element; }}
                type="button"
                aria-label={`Select property ${property.label}`}
                aria-current={property.id === activePropertyId ? "page" : undefined}
                onClick={() => selectProperty(property.id)}
              >
                <span>{property.label}</span>
                <small>
                  {property.valuations.length === 0
                    ? "No values recorded"
                    : `${property.valuations.length} ${
                      property.valuations.length === 1 ? "valuation" : "valuations"
                    }`}
                </small>
              </button>
            ))}
          </nav>
          <div className="property-record-detail">
          {properties.filter((property) => property.id === activePropertyId).map((property) => {
            const draft = valuationDrafts[property.id] ?? EMPTY_VALUATION_DRAFT;
            const labelDraft = propertyLabelDrafts[property.id] ?? property.label;
            const labelFeedbackKey = `label:${property.id}`;
            const labelError = formErrors[labelFeedbackKey];
            const labelStatus = formStatuses[labelFeedbackKey];
            const valuationFeedbackKey = `valuation:${property.id}`;
            const valuationError = formErrors[valuationFeedbackKey];
            const valuationStatus = formStatuses[valuationFeedbackKey];
            const valuationErrorId = `valuation-error-${property.id}`;
            const correctionsByTarget = new Map<string, string>();
            for (const valuation of property.valuations) {
              if (valuation.correction !== undefined) {
                correctionsByTarget.set(
                  valuation.correction.targetValuationId,
                  valuation.correction.action
                );
              }
            }
            return (
              <section
                className="property-record"
                id={`property-record-${property.id}`}
                aria-label={`Property ${property.label}`}
                key={property.id}
                ref={(element) => { propertyRecordRefs.current[property.id] = element; }}
                tabIndex={-1}
              >
                {isCompactPropertyDetailOpen && (
                  <button
                    className="property-detail-back"
                    onClick={() => showPropertyList(property.id)}
                    type="button"
                  >
                    Back to properties
                  </button>
                )}
                <div className="property-record-heading">
                  <h4>{property.label}</h4>
                  <details className="property-label-editor">
                    <summary>Change property label</summary>
                    <form
                      aria-label="Change property label"
                      onSubmit={(event) => void renameProperty(event, property)}
                    >
                      <label>
                        New property label
                        <input
                          autoComplete="off"
                          aria-invalid={labelError?.field === "label" ? true : undefined}
                          aria-describedby={labelError?.field === "label"
                            ? `property-label-error-${property.id}`
                            : undefined}
                          maxLength={100}
                          onChange={(event) => updatePropertyLabelDraft(
                            property.id,
                            event.currentTarget.value
                          )}
                          value={labelDraft}
                        />
                      </label>
                      <button disabled={isSaving} type="submit">Save property label</button>
                      {labelError !== undefined && (
                        <p
                          id={`property-label-error-${property.id}`}
                          className="property-registry-message"
                          role="alert"
                        >
                          {labelError.message}
                        </p>
                      )}
                      {labelStatus !== undefined && (
                        <p className="property-registry-message" role="status">{labelStatus}</p>
                      )}
                    </form>
                  </details>
                </div>
                <HouseholdShareForm
                  recordId={property.id}
                  formStates={shareFormStates}
                  setFormStates={setShareFormStates}
                  label="Household ownership share (%)"
                  buttonLabel="Save ownership share"
                  successMessage="Ownership share saved."
                  value={property.ownershipShareBasisPoints ?? DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS}
                  onSave={async (ownershipShareBasisPoints) => {
                    await window.budgetApi.propertyRegistry.updateOwnershipShare({
                      propertyId: property.id, ownershipShareBasisPoints,
                    });
                    setProperties((current) => current.map((record) => record.id === property.id
                      ? { ...record, ownershipShareBasisPoints }
                      : record));
                  }}
                />
                {activeValuationPropertyId === property.id ? (
                  <form
                    className="property-valuation-form"
                    aria-label={`Add valuation for ${property.label}`}
                    onSubmit={(event) => void addValuation(event, property)}
                  >
                  <label>
                    Effective date
                    <input
                      type="date"
                      aria-invalid={valuationError?.field === "effectiveDateIso" ? true : undefined}
                      aria-describedby={valuationError?.field === "effectiveDateIso"
                        ? valuationErrorId
                        : undefined}
                      onChange={(event) => updateValuationDraft(
                        property.id,
                        "effectiveDateIso",
                        event.currentTarget.value
                      )}
                      ref={(element) => setValuationFieldRef(
                        property.id,
                        "effectiveDateIso",
                        element
                      )}
                      value={draft.effectiveDateIso}
                    />
                  </label>
                  <label>
                    Amount
                    <input
                      inputMode="decimal"
                      aria-invalid={valuationError?.field === "amount" ? true : undefined}
                      aria-describedby={valuationError?.field === "amount" ? valuationErrorId : undefined}
                      onChange={(event) => updateValuationDraft(
                        property.id,
                        "amount",
                        event.currentTarget.value
                      )}
                      ref={(element) => setValuationFieldRef(property.id, "amount", element)}
                      value={draft.amount}
                    />
                  </label>
                  <label>
                    Currency code
                    <input
                      autoCapitalize="characters"
                      aria-invalid={valuationError?.field === "currencyCode" ? true : undefined}
                      aria-describedby={valuationError?.field === "currencyCode"
                        ? valuationErrorId
                        : undefined}
                      maxLength={3}
                      onChange={(event) => updateValuationDraft(
                        property.id,
                        "currencyCode",
                        event.currentTarget.value
                      )}
                      ref={(element) => setValuationFieldRef(
                        property.id,
                        "currencyCode",
                        element
                      )}
                      value={draft.currencyCode}
                    />
                  </label>
                    <button disabled={isSaving} type="submit">
                      {isSaving ? "Saving value..." : "Save value"}
                    </button>
                    <button
                      disabled={isSaving}
                      onClick={() => cancelValuationForm(property.id)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    ref={(element) => { recordValueButtonRefs.current[property.id] = element; }}
                    onClick={() => openValuationForm(property.id)}
                    type="button"
                  >
                    Record value
                  </button>
                )}
                {valuationError !== undefined && (
                  <p
                    id={valuationErrorId}
                    className="property-registry-message"
                    role="alert"
                  >
                    {valuationError.message}
                  </p>
                )}
                {valuationStatus !== undefined && (
                  <p className="property-registry-message" role="status">{valuationStatus}</p>
                )}
                {property.valuations.length === 0 && (
                  <p className="property-registry-empty">No valuations have been recorded.</p>
                )}
                <div className="property-history-table-wrap">
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
                                {propertyAmountFormatter.format(valuation.amountMinor / 100)}
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
                </div>
              </section>
            );
          })}
          </div>
        </div>
      )}
    </section>
  );
}