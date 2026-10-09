import React from "react";
import type {
  PdfImportPreviewSuccess,
  PdfImportResponse,
} from "../../app/import/importPdf.js";
import type { DuplicateImportDecision } from "../../domain/import/filterPreviouslyImportedTransactions.js";
import { ImportStageProgress, type ImportWorkflowStage } from "./ImportStageProgress.js";

type ImportState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "cancelled" }
  | { status: "success"; importJobId: string; transactionCount: number; duplicateCount: number; adapterId: string }
  | { status: "error"; message: string }
  | { status: "validation"; errors: PdfImportResponse & { ok: false }; source: "preview" | "import" };

const PREVIEW_PAGE_SIZE = 100;

const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAmount(amountMinor: number): string {
  return nokCurrencyFormatter.format(amountMinor / 100);
}

interface PdfImportSectionProps {
  onImportSuccess: () => void;
  onOpenLedger: () => void;
  onReviewUncategorized: () => void;
}

export function PdfImportSection({ onImportSuccess, onOpenLedger, onReviewUncategorized }: PdfImportSectionProps): React.JSX.Element {
  const [filePath, setFilePath] = React.useState("");
  const [importState, setImportState] = React.useState<ImportState>({ status: "idle" });
  const [activePreflightRequestId, setActivePreflightRequestId] = React.useState<string | undefined>();
  const [preflightProgress, setPreflightProgress] = React.useState<{
    requestId: string;
    phase: string;
    completedRows: number;
    totalRows: number;
  } | null>(null);
  const [stage, setStage] = React.useState<ImportWorkflowStage>("select-file");
  const [preview, setPreview] = React.useState<PdfImportPreviewSuccess | null>(null);
  const [previewPage, setPreviewPage] = React.useState(0);
  const [validationReportPage, setValidationReportPage] = React.useState(0);
  const [duplicateDecisions, setDuplicateDecisions] = React.useState<Record<number, DuplicateImportDecision["action"]>>({});
  const duplicateCandidates = preview?.duplicateCandidates ?? [];
  const unresolvedDuplicateCandidates = duplicateCandidates.filter((candidate) =>
    duplicateDecisions[candidate.rowIndex] === undefined
  );
  const previewPageCount = Math.max(1, Math.ceil((preview?.transactions.length ?? 0) / PREVIEW_PAGE_SIZE));
  const visibleTransactions = preview?.transactions.slice(
    previewPage * PREVIEW_PAGE_SIZE,
    (previewPage + 1) * PREVIEW_PAGE_SIZE
  ) ?? [];
  const validationErrors = importState.status === "validation" ? importState.errors.errors : [];
  const validationReportPageCount = Math.max(1, Math.ceil(validationErrors.length / PREVIEW_PAGE_SIZE));
  const visibleValidationErrors = validationErrors.slice(
    validationReportPage * PREVIEW_PAGE_SIZE,
    (validationReportPage + 1) * PREVIEW_PAGE_SIZE
  );

  React.useEffect(() => window.budgetApi.import.onPreflightProgress((progress) => {
    if (progress.format !== "pdf") return;
    setPreflightProgress((current) => current?.requestId === progress.requestId
      ? { ...current, phase: progress.phase, completedRows: progress.completedRows, totalRows: progress.totalRows }
      : current);
  }), []);

  async function handlePreview(): Promise<void> {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) return;

    const requestId = crypto.randomUUID();
    setActivePreflightRequestId(requestId);
    setPreflightProgress({ requestId, phase: "Reading statement", completedRows: 0, totalRows: 0 });
    setImportState({ status: "pending" });
    setStage("map-and-validate");
    setDuplicateDecisions({});
    setValidationReportPage(0);
    let wasCancelled = false;

    try {
      const response = await window.budgetApi.import.previewPdf({ filePath: trimmedPath, requestId });
      if (response.ok) {
        setPreview(response);
        setPreviewPage(0);
        setDuplicateDecisions({});
        setImportState({ status: "idle" });
        setStage("review");
      } else if (response.errors.some((error) => error.code === "PREVIEW_CANCELLED")) {
        wasCancelled = true;
        setPreview(null);
        setImportState({ status: "cancelled" });
        setPreflightProgress({ requestId, phase: "Preview cancelled", completedRows: 0, totalRows: 0 });
        setStage("select-file");
      } else {
        setPreview(null);
        setImportState({ status: "validation", errors: response, source: "preview" });
        setStage("map-and-validate");
      }
    } catch (error: unknown) {
      setPreview(null);
      setImportState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown preview error.",
      });
      setStage("map-and-validate");
    } finally {
      setActivePreflightRequestId((current) => current === requestId ? undefined : current);
      setPreflightProgress((current) => current?.requestId !== requestId
        ? current
        : wasCancelled ? { ...current, phase: "Preview cancelled" } : null);
    }
  }

  function cancelPreview(): void {
    if (activePreflightRequestId !== undefined) {
      void window.budgetApi.import.cancelPreview(activePreflightRequestId);
    }
  }

  function updateFilePath(nextFilePath: string): void {
    setFilePath(nextFilePath);
    setPreview(null);
    setPreviewPage(0);
    setValidationReportPage(0);
    setDuplicateDecisions({});
    setImportState({ status: "idle" });
    setStage("select-file");
  }

  async function handleChooseFile(): Promise<void> {
    try {
      const selectedPath = await window.budgetApi.dialogs.choosePdfImportPath();
      if (selectedPath !== null) updateFilePath(selectedPath);
    } catch (error: unknown) {
      setImportState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown file selection error.",
      });
    }
  }

  function handleImport(): void {
    const trimmedPath = filePath.trim();
    if (!trimmedPath || preview === null || unresolvedDuplicateCandidates.length > 0) return;

    setImportState({ status: "pending" });
    setStage("confirm");
    window.budgetApi.import
      .importPdf({
        filePath: trimmedPath,
        previewId: preview.previewId,
        duplicateDecisions: Object.entries(duplicateDecisions).map(([rowIndex, action]) => ({
          rowIndex: Number(rowIndex),
          action,
        })),
      })
      .then((response) => {
        if (response.ok) {
          setImportState({
            status: "success",
            importJobId: response.importJobId,
            transactionCount: response.transactionCount,
            duplicateCount: response.duplicateCount,
            adapterId: response.adapterId,
          });
          setStage("complete");
          setFilePath("");
          setPreview(null);
          setPreviewPage(0);
          setValidationReportPage(0);
          setDuplicateDecisions({});
          setTimeout(() => onImportSuccess(), 0);
        } else {
          setPreview(null);
          setPreviewPage(0);
          setValidationReportPage(0);
          setDuplicateDecisions({});
          setImportState({ status: "validation", errors: response, source: "import" });
          setStage("map-and-validate");
        }
      })
      .catch((error: unknown) => {
        setImportState({
          status: "error",
          message: error instanceof Error ? error.message : "Unknown import error.",
        });
      });
  }

  return (
    <section aria-label="PDF Import">
      <h2>Import PDF Statement</h2>
      <p className="section-intro">Use this for a digital bank statement ending in <strong>.pdf</strong>. Scanned image statements are not supported yet.</p>
      <ImportStageProgress format="PDF" stage={stage} />
      <div className="import-file-source">
        <button id="pdf-file-picker-button" type="button" className="import-file-choice-primary" onClick={() => void handleChooseFile()} disabled={importState.status === "pending"}>
          Choose PDF file
        </button>
        <p aria-live="polite" className="import-selected-file">
          {filePath ? <><strong>Selected:</strong> <code>{filePath}</code></> : "No PDF statement selected."}
        </p>
      </div>
      <details className="import-path-entry">
        <summary>Advanced: enter a file path</summary>
        <label htmlFor="pdf-file-path">PDF statement path</label>
        <input
          id="pdf-file-path"
          type="text"
          value={filePath}
          onChange={(event) => updateFilePath(event.target.value)}
          placeholder="C:\\path\\to\\statement.pdf"
          disabled={importState.status === "pending"}
        />
      </details>
      <button
        id="pdf-preview-button"
        type="button"
        onClick={() => void handlePreview()}
        disabled={importState.status === "pending" || !filePath.trim()}
      >
        Preview PDF
      </button>
      {((importState.status === "pending" && activePreflightRequestId !== undefined) || importState.status === "cancelled") && (
        <div className="import-preflight-status">
          <p role="status" aria-label="Import preflight progress">
            {importState.status === "cancelled"
              ? "Preview cancelled. No transactions were saved."
              : preflightProgress === null || preflightProgress.totalRows === 0
                ? preflightProgress?.phase ?? "Preparing statement..."
                : `${preflightProgress.phase}: ${preflightProgress.completedRows.toLocaleString("nb-NO")} of ${preflightProgress.totalRows.toLocaleString("nb-NO")} rows`}
          </p>
          {importState.status === "pending" && (
            <button type="button" className="import-secondary-action" onClick={cancelPreview}>Cancel preview</button>
          )}
        </div>
      )}
      <button
        id="pdf-confirm-button"
        type="button"
        onClick={handleImport}
        aria-describedby="pdf-confirm-help"
        disabled={importState.status === "pending" || preview === null || unresolvedDuplicateCandidates.length > 0}
      >
        Confirm PDF import
      </button>
      <p id="pdf-confirm-help" className="import-action-help">
        {importState.status === "pending"
          ? "Wait for the current import operation to finish."
          : preview !== null
            ? unresolvedDuplicateCandidates[0] !== undefined
              ? <>Choose whether to skip or import duplicate <a href={`#pdf-preview-row-${unresolvedDuplicateCandidates[0].rowIndex}`}>row {unresolvedDuplicateCandidates[0].rowIndex + 1}</a> before confirming.</>
              : "Review the statement rows before confirming the import."
            : filePath && importState.status === "validation" && importState.source === "preview"
              ? <>This file did not match a supported digital statement format. <a href="#pdf-file-picker-button">Select another file</a>.</>
              : filePath && importState.status === "validation"
                ? <>The import could not be confirmed. Review the validation message, then <a href="#pdf-preview-button">preview the statement again</a>.</>
                : filePath
                  ? <>This statement has not passed validation. <a href="#pdf-preview-button">Preview PDF</a>.</>
                  : <>Choose a digital PDF statement before previewing it. <a href="#pdf-file-picker-button">Select its file</a>.</>}
      </p>
      {importState.status === "pending" && <p role="status">Checking the file...</p>}
      {importState.status === "success" && (
        <div className="import-success">
          <div className="import-result-summary" role="region" aria-label="Import result summary">
            <p role="status" aria-label="Transactions imported">
              Added {importState.transactionCount} transaction{importState.transactionCount === 1 ? "" : "s"} to your ledger.
            </p>
            <p className="import-duplicate-summary">
              {importState.duplicateCount} duplicate row{importState.duplicateCount === 1 ? "" : "s"} skipped.
            </p>
          </div>
          <div className="import-success-actions" aria-label="Next import actions">
            <button type="button" onClick={onReviewUncategorized}>Review uncategorized transactions</button>
            <button type="button" className="import-secondary-action" onClick={onOpenLedger}>Return to ledger</button>
          </div>
        </div>
      )}
      {importState.status === "cancelled" && <p role="status">Preview cancelled. No transactions were saved.</p>}
      {importState.status === "error" && <p role="alert">Import failed: {importState.message}</p>}
      {importState.status === "validation" && (
        <div role="alert">
          <p>Import validation failed:</p>
          <details className="import-validation-report">
            <summary>PDF validation report ({importState.errors.errors.length} issues)</summary>
            <ul>
              {visibleValidationErrors.map((error, index) => (
                <li key={`${error.code}-${error.lineNumber ?? "statement"}-${index}`}>
                  {error.lineNumber === undefined ? "Statement" : `Line ${error.lineNumber}`}
                  {error.field === undefined ? "" : ` · ${error.field}`}: {error.code}: {error.message}
                </li>
              ))}
            </ul>
            {validationReportPageCount > 1 && (
              <div className="import-preview-pagination" aria-label="PDF validation report pages">
                <button type="button" disabled={validationReportPage === 0} onClick={() => setValidationReportPage((page) => Math.max(0, page - 1))}>Previous report page</button>
                <span>Page {validationReportPage + 1} of {validationReportPageCount}</span>
                <button type="button" disabled={validationReportPage + 1 >= validationReportPageCount} onClick={() => setValidationReportPage((page) => Math.min(validationReportPageCount - 1, page + 1))}>Next report page</button>
              </div>
            )}
          </details>
        </div>
      )}
      {preview !== null && (
        <section aria-label="PDF import preview">
          <h3>PDF import preview</h3>
          <p className="preview-summary" aria-live="polite">
            <strong>{preview.transactions.length} transaction{preview.transactions.length === 1 ? "" : "s"} in this statement.</strong>{" "}
            {duplicateCandidates.length} possible duplicate{duplicateCandidates.length === 1 ? "" : "s"} require a decision.
          </p>
          <p>Statement format recognized: {preview.adapterId === "rogaland-sparebank-text-v1" ? "Rogaland Sparebank digital statement" : "supported bank statement"}.</p>
          <div className="preview-table-wrap">
            <table className="import-preview-table">
              <caption>PDF statement preview rows and duplicate decisions</caption>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Merchant</th><th scope="col">Amount</th><th scope="col">Currency</th><th scope="col">Status and duplicate decision</th></tr>
              </thead>
              <tbody>
                {visibleTransactions.map((transaction, pageRowIndex) => {
                  const rowIndex = previewPage * PREVIEW_PAGE_SIZE + pageRowIndex;
                  const duplicateCandidate = duplicateCandidates.find((candidate) => candidate.rowIndex === rowIndex);
                  return (
                    <tr key={transaction.id} id={`pdf-preview-row-${rowIndex}`} data-state={duplicateCandidate === undefined ? "ready" : "duplicate"}>
                      <td data-label="Date">{transaction.bookedAtIso.slice(0, 10)}</td>
                      <td data-label="Merchant">{transaction.merchantRaw}</td>
                      <td data-label="Amount">{formatAmount(transaction.amountMinor)}</td>
                      <td data-label="Currency">{transaction.currencyCode ?? "NOK"}</td>
                      <td data-label="Status and duplicate decision">
                        {duplicateCandidate === undefined
                          ? "Ready"
                          : (
                            <div className="import-duplicate-decision">
                              <strong>Duplicate candidate</strong>
                              <small>Matched by {duplicateCandidate.duplicateMatch.matchBasis === "source-reference" ? "source reference" : "transaction fingerprint"}.</small>
                              <span className="import-duplicate-match">
                                Existing: {duplicateCandidate.duplicateMatch.matchingTransaction.bookedAtIso.slice(0, 10)} · {duplicateCandidate.duplicateMatch.matchingTransaction.merchantRaw} · {formatAmount(duplicateCandidate.duplicateMatch.matchingTransaction.amountMinor)}
                              </span>
                              <fieldset aria-label={`Duplicate decision for row ${rowIndex + 1}`}>
                                <label><input type="radio" name={`pdf-duplicate-${rowIndex}`} value="skip" checked={duplicateDecisions[rowIndex] === "skip"} onChange={() => setDuplicateDecisions((current) => ({ ...current, [rowIndex]: "skip" }))} />Skip duplicate</label>
                                <label><input type="radio" name={`pdf-duplicate-${rowIndex}`} value="import" checked={duplicateDecisions[rowIndex] === "import"} onChange={() => setDuplicateDecisions((current) => ({ ...current, [rowIndex]: "import" }))} />Import duplicate</label>
                              </fieldset>
                            </div>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.transactions.length > PREVIEW_PAGE_SIZE && (
            <div className="import-preview-pagination" aria-label="PDF preview pages">
              <button type="button" disabled={previewPage === 0} onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}>Previous rows</button>
              <span aria-live="polite">
                Rows {previewPage * PREVIEW_PAGE_SIZE + 1}-{Math.min((previewPage + 1) * PREVIEW_PAGE_SIZE, preview.transactions.length)} of {preview.transactions.length.toLocaleString("nb-NO")} · Page {previewPage + 1} of {previewPageCount}
              </span>
              <button type="button" disabled={previewPage + 1 >= previewPageCount} onClick={() => setPreviewPage((page) => Math.min(previewPageCount - 1, page + 1))}>Next rows</button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}