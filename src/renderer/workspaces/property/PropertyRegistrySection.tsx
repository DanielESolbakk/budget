import React from "react";
import { DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS } from "../../../domain/householdShareValidation.js";
import { formatMinorUnits, minorUnitsToDecimal } from "../../../domain/money/minorUnits.js";
import {
  validatePropertyValuationCorrectionInput,
  validatePropertyValuationInput,
} from "../../../domain/propertyRecordValidation.js";
import type {
  PropertyValuationCorrectionInput,
  PropertyValuationInput,
  PropertyValuationSnapshot,
  PropertyWithValuations
} from "../../../domain/types.js";
import { HouseholdShareForm, useHouseholdShareFormStates } from "../HouseholdShareForm.js";
import { parseCurrencyAmountMinor } from "../parseCurrencyAmountMinor.js";
import { errorMessage } from "../registryErrorMessage.js";
import { PropertyCreateForm } from "./PropertyCreateForm.js";
import { type PropertyFormError, type PropertyRegistrySectionProps, type PropertyValuationDraft, type PropertyValuationDraftField, correctionErrorMessage, EMPTY_VALUATION_DRAFT, propertyAmountFormatter, propertyValuationFormError, valuationErrorField } from "./propertyFormState.js";
import { PropertyHistory } from "./PropertyHistory.js";

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
      amount: minorUnitsToDecimal(valuation.amountMinor),
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
      `${formatMinorUnits(target.amountMinor, propertyAmountFormatter)} valuation as void? ` +
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
        <PropertyCreateForm
          addProperty={addProperty}
          propertyCreateError={propertyCreateError}
          setPropertyLabel={setPropertyLabel}
          propertyLabel={propertyLabel}
          isSaving={isSaving}
          cancelPropertyCreateForm={cancelPropertyCreateForm}
        />
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
                    : `${property.valuations.length} ${property.valuations.length === 1 ? "valuation" : "valuations"
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
                  <PropertyHistory
                    property={property}
                    correctionsByTarget={correctionsByTarget}
                    formErrors={formErrors}
                    formStatuses={formStatuses}
                    correctionDraft={correctionDraft}
                    supersedeValuation={supersedeValuation}
                    updateCorrectionDraft={updateCorrectionDraft}
                    isSaving={isSaving}
                    voidValuation={voidValuation}
                  />
                </section>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
