import React from "react";
import {
  HoldingRecordValidationError,
  validateHoldingRecordInput,
  validateHoldingValuationInput
} from "../../../domain/holdingRecordValidation.js";
import type {
  HoldingRecordInput,
  HoldingValuationInput,
  HoldingWithValuations
} from "../../../domain/types.js";
import { parseCurrencyAmountMinor } from "../parseCurrencyAmountMinor.js";
import { errorMessage } from "../registryErrorMessage.js";
import { HoldingCorrectionControls } from "./HoldingCorrectionControls.js";
import { HoldingCreateForm } from "./HoldingCreateForm.js";
import { type HoldingDraft, type HoldingFormField, type HoldingValuationDraft, type HoldingValuationFormField, EMPTY_HOLDING_DRAFT, formatHoldingAmount, holdingFormField, holdingValuationFormField } from "./holdingFormState.js";
import { HoldingHistory } from "./HoldingHistory.js";
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
      <HoldingCreateForm
        addHolding={addHolding}
        holdingErrors={holdingErrors}
        updateHoldingDraft={updateHoldingDraft}
        holdingFieldRefs={holdingFieldRefs}
        holdingDraft={holdingDraft}
        isSaving={isSaving}
        isLoading={isLoading}
        loadError={loadError}
      />
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
