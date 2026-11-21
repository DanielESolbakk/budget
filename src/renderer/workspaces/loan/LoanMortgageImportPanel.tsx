import React from "react";
import type { PropertyRecord } from "../../../domain/types.js";
import { isCurrencyCode } from "../../../domain/types.js";
import type {
  MortgageBankImportPreview,
  MortgageEvidenceAcceptanceSummary,
  MortgageDocumentPairingResult,
  MortgageImportTarget,
  MortgageSchedulePreviewDocument,
  MortgageTermComparison,
} from "../../../shared/mortgageBankEvidence.js";
import { errorMessage } from "../registryErrorMessage.js";
import { formatAmount } from "./loanFormState.js";

interface LoanMortgageImportPanelProps {
  readonly loanId?: string;
  readonly loanLabel?: string;
  readonly properties: readonly PropertyRecord[];
  readonly onAccepted: (
    summary: MortgageEvidenceAcceptanceSummary,
    createdSourceOnly: boolean
  ) => void;
}

function reviewStateMessage(reviewState: MortgageBankImportPreview["reviewState"]): string {
  switch (reviewState) {
    case "schedule-checks-passed":
      return "Schedule checks passed.";
    case "details-checks-passed":
      return "Loan details were parsed.";
    case "paired-schedule-checks-passed":
      return "Paired evidence checks passed.";
    case "review-required":
      return "Some evidence is partial. Review the available source details before accepting.";
    case "source-date-conflict":
      return "Source dates conflict. Review the conflicting dates before accepting evidence.";
    case "attachment-confirmation-required":
      return "Attachment confirmation required.";
    case "identity-conflict":
      return "The document identity or currency conflicts with the selected loan.";
    case "invalid":
      return "The repayment schedule failed consistency checks and cannot be accepted.";
    case "unsupported":
      return "The selected HTML does not contain a supported mortgage document.";
  }
}

function sourceDateMessage(preview: MortgageBankImportPreview): string {
  if (preview.reviewState === "source-date-conflict") {
    const sourceValues = [...new Set(preview.documents.flatMap((document) =>
      document.parsedDocument.sourceDateEvidence.sourceValues
    ))];
    return sourceValues.length === 0
      ? "Source dates conflict; no single source date was accepted."
      : `Source dates conflict (${sourceValues.join(", ")}); no single source date was accepted.`;
  }
  return preview.sourceAsOfDateIso === null
    ? "Source date not identified."
    : `Source date: ${preview.sourceAsOfDateIso}.`;
}

function attachmentMessage(
  attachment: MortgageDocumentPairingResult | null,
  target: MortgageImportTarget
): string | null {
  if (attachment === null) return null;
  if (attachment.status === "verified") {
    return "Loan attachment verified using matching identifiers.";
  }
  if (attachment.status === "confirmed") {
    return target.kind === "new-source-only"
      ? "You confirmed these documents belong to one new incomplete loan."
      : "You confirmed this evidence belongs to the selected loan.";
  }
  if (attachment.status === "confirmation-required") {
    return "Loan attachment has not been confirmed.";
  }
  return "Loan attachment cannot be verified because the identifiers conflict.";
}

function formatEvidenceAmount(amountMinor: number | null, currencyCode: string | null): string {
  if (amountMinor === null) return "Not supplied by the source";
  if (currencyCode === null || !isCurrencyCode(currencyCode)) {
    return "Currency not identified";
  }
  return formatAmount(amountMinor, currencyCode);
}

function formatTermComparison(comparison: MortgageTermComparison): string {
  if ("sourceValueMinor" in comparison) {
    const savedDate = "savedEffectiveDateIso" in comparison
      ? ` on ${comparison.savedEffectiveDateIso}`
      : "";
    return `${comparison.sourceLabel}: source ${
      formatEvidenceAmount(comparison.sourceValueMinor, comparison.currencyCode)
    }; saved ${
      formatEvidenceAmount(comparison.savedValueMinor, comparison.currencyCode)
    }${savedDate}. ${
      comparison.status === "differs" ? "Different from saved value." : "Matches saved value."
    }`;
  }
  const percent = new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${comparison.sourceLabel}: source ${
    percent.format(comparison.sourceValueBasisPoints / 100)
 }%; saved ${
    percent.format(comparison.savedValueBasisPoints / 100)
 }%. ${
    comparison.status === "differs" ? "Different from saved value." : "Matches saved value."
  }`;
}

function checkpointForMonth(
  document: MortgageSchedulePreviewDocument,
  year: number,
  month: number
): MortgageSchedulePreviewDocument["scheduleRows"][number] | undefined {
  return document.scheduleRows.find((row) => (
    row.period.granularity === "monthly" &&
    row.period.year === year &&
    row.period.month === month
  ));
}

function firstYearEndCheckpoint(
  document: MortgageSchedulePreviewDocument,
  currentYear: number
): MortgageSchedulePreviewDocument["scheduleRows"][number] | undefined {
  return document.scheduleRows.find((row) => (
    row.period.granularity === "annual"
      ? row.period.year >= currentYear
      : row.period.granularity === "monthly" &&
        row.period.year >= currentYear &&
        row.period.month === 12
  ));
}

function MortgageDocumentPreview({
  document,
}: {
  readonly document: MortgageSchedulePreviewDocument;
}): React.JSX.Element {
  const isDetails = document.role === "details";
  const sourceRows = document.scheduleRows;
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const nextMonthYear = currentMonth === 12 ? now.getFullYear() + 1 : now.getFullYear();
  const currentMonthRow = checkpointForMonth(document, now.getFullYear(), currentMonth);
  const nextMonthRow = checkpointForMonth(document, nextMonthYear, nextMonth);
  const yearEndRow = firstYearEndCheckpoint(document, now.getFullYear());
  const finalRow = sourceRows.at(-1);
  const currencyCode = document.identityDisplay.currencyCode;

  return (
    <div
      role="group"
      className="loan-mortgage-import-document"
      aria-label={isDetails ? "Loan details evidence" : "Repayment schedule evidence"}
    >
      <h5>{isDetails ? "Loan details" : "Repayment schedule"}</h5>
      <dl className="loan-terms">
        <div>
          <dt>Loan reference</dt>
          <dd>{document.identityDisplay.maskedLoanReference ?? "Not present in the source"}</dd>
        </div>
        <div>
          <dt>Currency</dt>
          <dd>{currencyCode ?? "Not identified"}</dd>
        </div>
        {isDetails ? document.detailsFields.map((field, index) => (
          <div key={`${field.field}-${index}`}>
            <dt>{field.sourceLabel}</dt>
            <dd>{field.sourceValue}</dd>
          </div>
        )) : (
          <>
            <div>
              <dt>Schedule coverage</dt>
              <dd>
                {sourceRows[0]?.periodLabel ?? "Not identified"}
                {" - "}
                {finalRow?.periodLabel ?? "Not identified"}
              </dd>
            </div>
            <div>
              <dt>Schedule rows</dt>
              <dd>{sourceRows.length}</dd>
            </div>
            <div>
              <dt>Current-month projected closing balance</dt>
              <dd>
                {currentMonthRow === undefined
                  ? "Not covered by this source"
                  : formatEvidenceAmount(currentMonthRow.projectedClosingBalanceMinor, currencyCode)}
              </dd>
            </div>
            <div>
              <dt>Next-month projected closing balance</dt>
              <dd>
                {nextMonthRow === undefined
                  ? "Not covered by this source"
                  : formatEvidenceAmount(nextMonthRow.projectedClosingBalanceMinor, currencyCode)}
              </dd>
            </div>
            <div>
              <dt>First year-end projected closing balance</dt>
              <dd>
                {yearEndRow === undefined
                  ? "Not supplied by this source"
                  : formatEvidenceAmount(yearEndRow.projectedClosingBalanceMinor, currencyCode)}
              </dd>
            </div>
            <div>
              <dt>Final available projected closing balance</dt>
              <dd>
                {finalRow === undefined
                  ? "Not supplied by this source"
                  : formatEvidenceAmount(finalRow.projectedClosingBalanceMinor, currencyCode)}
              </dd>
            </div>
          </>
        )}
      </dl>
      {!isDetails && (
        <p className="loan-mortgage-import-note">
          Repayment-plan balances are projections, not actual loan balances.
        </p>
      )}
    </div>
  );
}

export function LoanMortgageImportPanel({
  loanId,
  loanLabel,
  properties,
  onAccepted,
}: LoanMortgageImportPanelProps): React.JSX.Element {
  const isNewSourceOnlyTarget = loanId === undefined;
  const [isOpen, setIsOpen] = React.useState(false);
  const [sourceOnlyLabel, setSourceOnlyLabel] = React.useState("");
  const [propertyId, setPropertyId] = React.useState("");
  const [preview, setPreview] = React.useState<MortgageBankImportPreview | null>(null);
  const [acceptPartial, setAcceptPartial] = React.useState(false);
  const [acknowledgeTermDifferences, setAcknowledgeTermDifferences] = React.useState(false);
  const [isWorking, setIsWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  function currentTarget(): MortgageImportTarget | null {
    if (loanId !== undefined) return { kind: "existing", loanId };
    const label = sourceOnlyLabel.trim();
    if (label.length === 0 || label.length > 100) return null;
    return {
      kind: "new-source-only",
      label,
      ...(propertyId.length === 0 ? {} : { propertyId }),
    };
  }

  async function loadPreview(target: MortgageImportTarget): Promise<void> {
    setIsWorking(true);
    setError(null);
    setStatus(null);
    try {
      const result = await window.budgetApi.mortgageImport.previewFiles({ target });
      if (result === null) {
        setPreview(null);
        setStatus("Import canceled. No loan data was changed.");
        return;
      }
      setPreview(result);
      setAcceptPartial(false);
      setAcknowledgeTermDifferences(false);
    } catch (failure: unknown) {
      setError(errorMessage(failure, "Unable to preview mortgage evidence."));
    } finally {
      setIsWorking(false);
    }
  }

  async function chooseFiles(): Promise<void> {
    const target = currentTarget();
    if (target === null) {
      setError("Enter a loan label before importing evidence for an incomplete loan.");
      return;
    }
    await loadPreview(target);
  }

  async function confirmAttachment(): Promise<void> {
    if (preview === null) return;
    setIsWorking(true);
    setError(null);
    try {
      const confirmed = await window.budgetApi.mortgageImport.confirmAttachment(
        preview.previewId
      );
      setPreview(confirmed);
      setAcceptPartial(false);
      setAcknowledgeTermDifferences(false);
    } catch (failure: unknown) {
      setError(errorMessage(failure, "Unable to confirm the mortgage evidence attachment."));
    } finally {
      setIsWorking(false);
    }
  }

  async function acceptEvidence(): Promise<void> {
    if (preview === null) return;
    setIsWorking(true);
    setError(null);
    try {
      const accepted = await window.budgetApi.mortgageImport.acceptPreview(
        preview.previewId,
        acceptPartial,
        acknowledgeTermDifferences
      );
      onAccepted(accepted, isNewSourceOnlyTarget);
      if (isNewSourceOnlyTarget) {
        setIsOpen(false);
        setSourceOnlyLabel("");
        setPropertyId("");
        setStatus(null);
      } else {
        setStatus(`Evidence version ${accepted.versionNumber} saved. No actual balance was inferred.`);
      }
      setPreview(null);
      setAcceptPartial(false);
      setAcknowledgeTermDifferences(false);
    } catch (failure: unknown) {
      setError(errorMessage(failure, "Unable to accept mortgage evidence."));
    } finally {
      setIsWorking(false);
    }
  }

  async function cancelImport(): Promise<void> {
    setIsWorking(true);
    setError(null);
    try {
      if (preview !== null) {
        await window.budgetApi.mortgageImport.cancelPreview(preview.previewId);
      }
      setPreview(null);
      setAcceptPartial(false);
      setAcknowledgeTermDifferences(false);
      setStatus("Import canceled. No loan data was changed.");
    } catch (failure: unknown) {
      setError(errorMessage(failure, "Unable to cancel the mortgage import."));
    } finally {
      setIsWorking(false);
    }
  }

  async function closePanel(): Promise<void> {
    setIsWorking(true);
    setError(null);
    try {
      if (preview !== null) {
        await window.budgetApi.mortgageImport.cancelPreview(preview.previewId);
      }
      setPreview(null);
      setAcceptPartial(false);
      setAcknowledgeTermDifferences(false);
      setIsOpen(false);
    } catch (failure: unknown) {
      setError(errorMessage(failure, "Unable to close the mortgage import."));
    } finally {
      setIsWorking(false);
    }
  }

  const hasTermDifferences = preview?.termComparisons.some((comparison) =>
    comparison.status === "differs"
  ) ?? false;
  const canAccept = preview !== null && (
    [
      "schedule-checks-passed",
      "details-checks-passed",
      "paired-schedule-checks-passed",
    ].includes(preview.reviewState) ||
    (preview.reviewState === "review-required" && acceptPartial)
  ) && (!hasTermDifferences || acknowledgeTermDifferences);
  const targetName = isNewSourceOnlyTarget ? "an incomplete loan" : loanLabel ?? "this loan";

  return (
    <div className="loan-mortgage-import">
      {!isOpen ? (
        <button
          type="button"
          disabled={isWorking}
          onClick={() => {
            setIsOpen(true);
            if (!isNewSourceOnlyTarget) void chooseFiles();
          }}
        >
          {isNewSourceOnlyTarget ? "Import as incomplete loan" : "Import mortgage evidence"}
        </button>
      ) : (
        <div
          className="loan-mortgage-import-panel"
          role="region"
          aria-label={`Mortgage evidence import for ${targetName}`}
        >
          <h5>{isNewSourceOnlyTarget ? "Import as incomplete loan" : "Import mortgage evidence"}</h5>
          {isNewSourceOnlyTarget && preview === null && (
            <fieldset className="loan-create-group">
              <legend>Incomplete loan identity</legend>
              <div className="loan-create-fields">
                <div className="loan-field">
                  <label htmlFor="mortgage-import-source-only-label">Loan label</label>
                  <input
                    id="mortgage-import-source-only-label"
                    maxLength={100}
                    onChange={(event) => setSourceOnlyLabel(event.currentTarget.value)}
                    value={sourceOnlyLabel}
                  />
                </div>
                <div className="loan-field">
                  <label htmlFor="mortgage-import-source-only-property">Property (optional)</label>
                  <select
                    id="mortgage-import-source-only-property"
                    onChange={(event) => setPropertyId(event.currentTarget.value)}
                    value={propertyId}
                  >
                    <option value="">No property linked</option>
                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>{property.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="loan-required-note">
                The imported evidence creates this record; no principal, rate, term, payment, or
                actual balance is entered.
              </p>
            </fieldset>
          )}
          {preview === null ? (
            <button disabled={isWorking} onClick={() => void chooseFiles()} type="button">
              {isWorking ? "Reading mortgage evidence..." : "Choose mortgage HTML files"}
            </button>
          ) : (
            <div
              role="region"
              className="loan-mortgage-import-preview"
              aria-label={`Mortgage evidence preview for ${loanLabel ?? sourceOnlyLabel}`}
            >
              <h6>Mortgage evidence preview</h6>
              <p
                className="loan-mortgage-import-status"
                role={preview.reviewState === "invalid" ||
                  preview.reviewState === "identity-conflict"
                  ? "alert"
                  : "status"}
              >
                {reviewStateMessage(preview.reviewState)}
              </p>
              <p className="loan-mortgage-import-note">
                {sourceDateMessage(preview)} Imported figures remain evidence; they do not replace
                manually recorded terms or actual balances.
              </p>
              {attachmentMessage(preview.attachment, preview.target) !== null && (
                <p className="loan-mortgage-import-note" role="status">
                  {attachmentMessage(preview.attachment, preview.target)}
                </p>
              )}
              {preview.documents.map((document, index) => (
                <MortgageDocumentPreview
                  document={document.parsedDocument}
                  key={`${document.role}-${index}`}
                />
              ))}
              {preview.validation !== null && (
                <p className="loan-mortgage-import-note" role="status">
                  Schedule consistency: {preview.validation.status}.
                  {preview.validation.issues.length > 0 &&
                    ` ${preview.validation.issues.length} source rows need review.`}
                </p>
              )}
              {preview.termComparisons.length > 0 && (
                <section
                  className="loan-mortgage-import-comparisons"
                  aria-label="Source comparison with saved loan terms"
                >
                  <h6>Source comparison with saved loan terms</h6>
                  <ul className="loan-mortgage-import-comparison-list">
                    {preview.termComparisons.map((comparison, index) => (
                      <li key={`${comparison.field}-${index}`}>
                        {formatTermComparison(comparison)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {preview.reviewState === "attachment-confirmation-required" && (
                <button
                  disabled={isWorking}
                  onClick={() => void confirmAttachment()}
                  type="button"
                >
                  Confirm attachment to {targetName}
                </button>
              )}
              {preview.reviewState === "review-required" && (
                <label className="loan-mortgage-import-partial">
                  <input
                    checked={acceptPartial}
                    onChange={(event) => setAcceptPartial(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  Accept this partial evidence version; unsupported values remain unknown.
                </label>
              )}
              {hasTermDifferences && (
                <label className="loan-mortgage-import-acknowledgement">
                  <input
                    checked={acknowledgeTermDifferences}
                    onChange={(event) => setAcknowledgeTermDifferences(
                      event.currentTarget.checked
                    )}
                    type="checkbox"
                  />
                  I reviewed the source differences. Saved loan terms and actual balances remain
                  unchanged.
                </label>
              )}
              <div className="loan-mortgage-import-actions">
                <button
                  disabled={isWorking || !canAccept}
                  onClick={() => void acceptEvidence()}
                  type="button"
                >
                  {isWorking ? "Saving evidence..." : "Accept mortgage evidence"}
                </button>
                <button
                  className="action-secondary"
                  disabled={isWorking}
                  onClick={() => void cancelImport()}
                  type="button"
                >
                  Cancel import
                </button>
              </div>
            </div>
          )}
          {error !== null && <p className="loan-form-errors" role="alert">{error}</p>}
          {status !== null && <p className="property-registry-message" role="status">{status}</p>}
          <button
            className="action-secondary"
            disabled={isWorking}
            onClick={() => void closePanel()}
            type="button"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
