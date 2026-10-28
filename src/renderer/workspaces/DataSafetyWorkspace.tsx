import React from "react";
import { BackupSection } from "../backup/BackupSection.js";
import { ExportSection } from "../backup/ExportSection.js";
import { RestoreSnapshotSection } from "../dashboard/RestoreSnapshotSection.js";
import { validatePropertyValuationInput } from "../../domain/propertyRecordValidation.js";
import type { PropertyValuationInput, PropertyWithValuations } from "../../domain/types.js";

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
        <p>Back up the local ledger, export a portable copy, or restore a snapshot.</p>
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

const EMPTY_VALUATION_DRAFT: PropertyValuationDraft = {
  effectiveDateIso: "",
  amount: "",
  currencyCode: "NOK",
};

const propertyAmountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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

function PropertyRegistrySection({
  isActive,
  refreshRevision,
}: PropertyRegistrySectionProps): React.JSX.Element {
  const [properties, setProperties] = React.useState<PropertyWithValuations[]>([]);
  const [propertyLabel, setPropertyLabel] = React.useState("");
  const [valuationDrafts, setValuationDrafts] = React.useState<Record<string, PropertyValuationDraft>>({});
  const [revision, setRevision] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isActive) return;
    let active = true;
    setIsLoading(true);
    setError(null);
    window.budgetApi.propertyRegistry.list()
      .then((loadedProperties) => {
        if (active) setProperties(loadedProperties);
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError, "Unable to load properties."));
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
    setError(null);
    setStatusMessage(null);
    if (propertyLabel.trim().length === 0) {
      setError("Enter a property label.");
      return;
    }

    setIsSaving(true);
    try {
      await window.budgetApi.propertyRegistry.create({ label: propertyLabel.trim() });
      setPropertyLabel("");
      setStatusMessage("Property added.");
      setRevision((current) => current + 1);
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, "Unable to add the property."));
    } finally {
      setIsSaving(false);
    }
  }

  function updateValuationDraft(
    propertyId: string,
    field: keyof PropertyValuationDraft,
    value: string
  ): void {
    setValuationDrafts((current) => ({
      ...current,
      [propertyId]: {
        ...(current[propertyId] ?? EMPTY_VALUATION_DRAFT),
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
    setError(null);
    setStatusMessage(null);
    const draft = valuationDrafts[property.id] ?? EMPTY_VALUATION_DRAFT;
    const amountMinor = parseAmountMinor(draft.amount);
    if (amountMinor === null) {
      setError("Enter a non-negative amount with up to two decimal places.");
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
      setError(valuationErrorMessage(validationError));
      return;
    }

    setIsSaving(true);
    try {
      await window.budgetApi.propertyRegistry.appendValuation(input);
      setStatusMessage(`Valuation added for ${property.label}.`);
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
      setError(valuationErrorMessage(saveError));
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
      <form className="property-create-form" onSubmit={addProperty}>
        <label>
          Property label
          <input
            autoComplete="off"
            maxLength={100}
            onChange={(event) => setPropertyLabel(event.currentTarget.value)}
            value={propertyLabel}
          />
        </label>
        <button disabled={isSaving} type="submit">Add property</button>
      </form>
      <p className="property-registry-local-note">
        Valuations are entered manually and stay on this device. Nothing is fetched online.
      </p>
      {error !== null && <p className="property-registry-message" role="alert">{error}</p>}
      {statusMessage !== null && <p className="property-registry-message" role="status">{statusMessage}</p>}
      {isLoading ? (
        <p className="property-registry-empty" role="status">Loading property records...</p>
      ) : properties.length === 0 ? (
        error === null && <p className="property-registry-empty">No properties have been recorded.</p>
      ) : (
        <div className="property-record-list">
          {properties.map((property) => {
            const draft = valuationDrafts[property.id] ?? EMPTY_VALUATION_DRAFT;
            return (
              <section
                className="property-record"
                aria-label={`Property ${property.label}`}
                key={property.id}
              >
                <h4>{property.label}</h4>
                <form
                  className="property-valuation-form"
                  aria-label={`Add valuation for ${property.label}`}
                  onSubmit={(event) => void addValuation(event, property)}
                >
                  <label>
                    Effective date
                    <input
                      autoComplete="off"
                      inputMode="numeric"
                      onChange={(event) => updateValuationDraft(
                        property.id,
                        "effectiveDateIso",
                        event.currentTarget.value
                      )}
                      placeholder="YYYY-MM-DD"
                      value={draft.effectiveDateIso}
                    />
                  </label>
                  <label>
                    Amount
                    <input
                      inputMode="decimal"
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
                {property.valuations.length === 0 && (
                  <p className="property-registry-empty">No valuations have been recorded.</p>
                )}
                <div className="property-history-table-wrap">
                  <table aria-label="Valuation history">
                    <thead>
                      <tr>
                        <th scope="col">Effective date</th>
                        <th scope="col">Recorded at</th>
                        <th scope="col">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {property.valuations.map((valuation) => (
                        <tr key={valuation.id}>
                          <td><time dateTime={valuation.effectiveDateIso}>{valuation.effectiveDateIso}</time></td>
                          <td><time dateTime={valuation.recordedAtIso}>{valuation.recordedAtIso}</time></td>
                          <td>
                            <span className="property-valuation-currency">{valuation.currencyCode}</span>
                            {" "}
                            <span className="property-valuation-amount">
                              {propertyAmountFormatter.format(valuation.amountMinor / 100)}
                            </span>
                          </td>
                        </tr>
                      ))}
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