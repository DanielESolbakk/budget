import React from "react";
import { BackupSection } from "../backup/BackupSection.js";
import { ExportSection } from "../backup/ExportSection.js";
import { RestoreSnapshotSection } from "../dashboard/RestoreSnapshotSection.js";
import {
  validatePropertyValuationCorrectionInput,
  validatePropertyValuationInput,
} from "../../domain/propertyRecordValidation.js";
import type {
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
    <section className="destination-workspace" aria-label="Data safety workspace" hidden={!isActive}>
      <div className="destination-heading">
        <h2>Data safety</h2>
        <p>Record property values, or back up, export, and restore your local ledger.</p>
      </div>
      <PropertyRegistrySection isActive={isActive} refreshRevision={catalogRevision} />
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

interface PropertyRegistrySectionProps {
  isActive: boolean;
  refreshRevision: number;
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

function parseAmountMinor(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amountMinor = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(amountMinor) ? amountMinor : null;
}

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

function PropertyRegistrySection({
  isActive,
  refreshRevision,
}: PropertyRegistrySectionProps): React.JSX.Element {
  const [properties, setProperties] = React.useState<PropertyWithValuations[]>([]);
  const [propertyLabel, setPropertyLabel] = React.useState("");
  const [propertyLabelDrafts, setPropertyLabelDrafts] = React.useState<Record<string, string>>({});
  const [valuationDrafts, setValuationDrafts] = React.useState<Record<string, PropertyValuationDraft>>({});
  const [correctionDrafts, setCorrectionDrafts] = React.useState<Record<string, PropertyValuationDraft>>({});
  const [formErrors, setFormErrors] = React.useState<Record<string, PropertyFormError>>({});
  const [formStatuses, setFormStatuses] = React.useState<Record<string, string>>({});
  const [revision, setRevision] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [propertyCreateError, setPropertyCreateError] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

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
        if (active) setProperties(loadedProperties);
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
      await window.budgetApi.propertyRegistry.create({ label: propertyLabel.trim() });
      setPropertyLabel("");
      setStatusMessage("Property added.");
      setRevision((current) => current + 1);
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
    const amountMinor = parseAmountMinor(draft.amount);
    if (amountMinor === null) {
      setFormError(feedbackKey, {
        message: "Enter a non-negative amount with up to two decimal places.",
        field: "amount",
      });
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
      setFormError(feedbackKey, propertyValuationFormError(validationError));
      return;
    }

    setIsSaving(true);
    try {
      await window.budgetApi.propertyRegistry.appendValuation(input);
      setFormStatus(feedbackKey, `Valuation added for ${property.label}.`);
      setValuationDrafts((current) => ({
        ...current,
        [property.id]: {
          ...(current[property.id] ?? EMPTY_VALUATION_DRAFT),
          effectiveDateIso: "",
          amount: "",
        },
      }));
      setRevision((current) => current + 1);
    } catch (saveError: unknown) {
      setFormError(feedbackKey, propertyValuationFormError(saveError));
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
    const amountMinor = parseAmountMinor(draft.amount);
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

  return (
    <section className="property-registry-section" aria-label="Property registry">
      <header className="property-registry-heading">
        <h3>Property registry</h3>
        <p>Record a property label and add dated values in the currency you enter.</p>
      </header>
      <form className="property-create-form" aria-label="Add property" onSubmit={addProperty}>
        <label>
          Property label
          <input
            autoComplete="off"
            aria-invalid={propertyCreateError === "Enter a property label." ? true : undefined}
            aria-describedby={propertyCreateError === "Enter a property label."
              ? "property-label-create-error"
              : undefined}
            maxLength={100}
            onChange={(event) => setPropertyLabel(event.currentTarget.value)}
            value={propertyLabel}
          />
        </label>
        <button disabled={isSaving} type="submit">Add property</button>
      </form>
      {propertyCreateError !== null && (
        <p
          id="property-label-create-error"
          className="property-registry-message"
          role="alert"
        >
          {propertyCreateError}
        </p>
      )}
      <p className="property-registry-local-note">
        Property labels and valuations stay on this device and are included in local backup snapshots.
        Nothing is fetched online.
      </p>
      {statusMessage !== null && <p className="property-registry-message" role="status">{statusMessage}</p>}
      {loadError !== null && <p className="property-registry-message" role="alert">{loadError}</p>}
      {isLoading ? (
        <p className="property-registry-empty" role="status">Loading property records...</p>
      ) : properties.length === 0 ? (
        loadError === null && <p className="property-registry-empty">No properties have been recorded.</p>
      ) : (
        <div className="property-record-list">
          {properties.map((property) => {
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
                aria-label={`Property ${property.label}`}
                key={property.id}
              >
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
                      value={draft.currencyCode}
                    />
                  </label>
                  <button disabled={isSaving} type="submit">Add valuation</button>
                </form>
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
      )}
    </section>
  );
}