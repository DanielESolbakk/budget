import React from "react";
import type {
  PdfImportPreviewSuccess,
  PdfImportResponse,
} from "../../app/import/importPdf.js";
import type { Account } from "../../domain/types.js";
import type { DuplicateImportDecision } from "../../domain/import/filterPreviouslyImportedTransactions.js";
import { getImportPendingMessage, ImportStageProgress, type ImportWorkflowStage } from "./ImportStageProgress.js";
import { ImportAccountSelect } from "./ImportAccountSelect.js";
import { DuplicateBulkActions } from "./DuplicateBulkActions.js";

type ImportState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "cancelled" }
  | { status: "success"; importJobId: string; sourceName: string; accountName: string; transactionCount: number; duplicateCount: number; excludedRowCount: number; unresolvedRowCount: number; adapterId: string }
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

function fileNameFromPath(filePath: string): string {
  const normalizedPath = filePath.trim();
  return normalizedPath.split(/[\\/]/).at(-1) || normalizedPath;
}

interface PdfImportSectionProps {
  initialFilePath: string;
  fileSelectionId: number;
  onChooseFile: () => void;
  onCancelImport: () => void;
  onImportSuccess: () => void;
  onOpenLedger: () => void;
  onReviewUncategorized: () => void;
  onReviewImportItems: () => void;
}

export function PdfImportSection({
  initialFilePath,
  fileSelectionId,
  onChooseFile,
  onCancelImport,
  onImportSuccess,
  onOpenLedger,
  onReviewUncategorized,
  onReviewImportItems,
}: PdfImportSectionProps): React.JSX.Element {
  const [filePath, setFilePath] = React.useState(initialFilePath);
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
  const [isPreviewExpanded, setIsPreviewExpanded] = React.useState(true);
  const previewRegionRef = React.useRef<HTMLElement | null>(null);
  const importPathEntryRef = React.useRef<HTMLDetailsElement | null>(null);
  const [previewPage, setPreviewPage] = React.useState(0);
  const [duplicateRowToFocus, setDuplicateRowToFocus] = React.useState<number | null>(null);
  const [validationReportPage, setValidationReportPage] = React.useState(0);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [accountId, setAccountId] = React.useState("");
  const [accountLoadState, setAccountLoadState] = React.useState<"loading" | "ready" | "error">("loading");
  const [accountRefreshKey, setAccountRefreshKey] = React.useState(0);
  const [acknowledgeExcludedRows, setAcknowledgeExcludedRows] = React.useState(false);
  const [duplicateDecisions, setDuplicateDecisions] = React.useState<Record<number, DuplicateImportDecision["action"]>>({});
  const duplicateCandidates = preview?.duplicateCandidates ?? [];
  const unresolvedRows = preview?.unresolvedRows ?? [];
  const unresolvedRowCount = unresolvedRows.length;
  const unresolvedDuplicateCandidates = duplicateCandidates.filter((candidate) =>
    duplicateDecisions[candidate.rowIndex] === undefined
  );
  const selectedDuplicateDecisionCount = duplicateCandidates.length - unresolvedDuplicateCandidates.length;
  const excludedRowsAcknowledgementRequired = preview !== null &&
    preview.excludedRowCount > 0 && !acknowledgeExcludedRows;
  const previewPageCount = Math.max(1, Math.ceil((preview?.transactions.length ?? 0) / PREVIEW_PAGE_SIZE));
  const visibleTransactions = preview?.transactions.slice(
    previewPage * PREVIEW_PAGE_SIZE,
    (previewPage + 1) * PREVIEW_PAGE_SIZE
  ) ?? [];
  const validationErrors = importState.status === "validation" ? importState.errors.errors : [];
  const unresolvedInput = importState.status === "validation" ? importState.errors.unresolvedInput : undefined;
  const validationReportPageCount = Math.max(1, Math.ceil(validationErrors.length / PREVIEW_PAGE_SIZE));
  const visibleValidationErrors = validationErrors.slice(
    validationReportPage * PREVIEW_PAGE_SIZE,
    (validationReportPage + 1) * PREVIEW_PAGE_SIZE
  );

  React.useEffect(() => {
    setFilePath(initialFilePath);
    setPreview(null);
    setIsPreviewExpanded(true);
    setPreviewPage(0);
    setValidationReportPage(0);
    setDuplicateDecisions({});
    setAcknowledgeExcludedRows(false);
    setImportState({ status: "idle" });
    setStage(initialFilePath ? "map-and-validate" : "select-file");
  }, [fileSelectionId, initialFilePath]);

  React.useEffect(() => {
    let active = true;
    setAccountLoadState("loading");
    window.budgetApi.accounts.getCurrent().then((current) => {
      if (!active) return;
      const availableAccounts = current?.accounts ?? [];
      setAccounts(availableAccounts);
      setAccountId((selectedAccountId) => selectedAccountId || availableAccounts[0]?.id || "");
      setAccountLoadState(availableAccounts.length > 0 ? "ready" : "error");
    }).catch(() => {
      if (active) setAccountLoadState("error");
    });
    return () => {
      active = false;
    };
  }, [accountRefreshKey]);

  React.useEffect(() => window.budgetApi.import.onPreflightProgress((progress) => {
    if (progress.format !== "pdf") return;
    setPreflightProgress((current) => current?.requestId === progress.requestId
      ? { ...current, phase: progress.phase, completedRows: progress.completedRows, totalRows: progress.totalRows }
      : current);
  }), []);

  React.useEffect(() => {
    if (duplicateRowToFocus === null) return;
    const row = document.getElementById(`pdf-preview-row-${duplicateRowToFocus}`);
    if (row === null) return;
    row.scrollIntoView({ block: "center" });
    row.focus();
    setDuplicateRowToFocus(null);
  }, [duplicateRowToFocus, previewPage]);

  React.useEffect(() => {
    if (preview === null || !isPreviewExpanded || previewRegionRef.current === null) return;
    document.getElementById("pdf-preview-actions")?.scrollIntoView({ block: "start" });
    previewRegionRef.current.focus({ preventScroll: true });
  }, [preview, isPreviewExpanded]);

  async function handlePreview(): Promise<void> {
    const trimmedPath = filePath.trim();
    if (!trimmedPath || !accountId || accountLoadState !== "ready") return;

    const requestId = crypto.randomUUID();
    setActivePreflightRequestId(requestId);
    setPreflightProgress({ requestId, phase: "Reading statement", completedRows: 0, totalRows: 0 });
    setImportState({ status: "pending" });
    setIsPreviewExpanded(true);
    setStage("map-and-validate");
    setDuplicateDecisions({});
    setAcknowledgeExcludedRows(false);
    setValidationReportPage(0);
    let wasCancelled = false;

    try {
      const response = await window.budgetApi.import.previewPdf({ filePath: trimmedPath, requestId, accountId });
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

  function handlePreviewButtonClick(): void {
    if (preview === null) {
      void handlePreview();
      return;
    }
    if (!isPreviewExpanded) {
      setIsPreviewExpanded(true);
      return;
    }

    setIsPreviewExpanded(false);
    window.requestAnimationFrame(() => {
      const previewButton = document.getElementById("pdf-preview-button");
      previewButton?.scrollIntoView({ block: "start" });
      previewButton?.focus({ preventScroll: true });
    });
  }

  function cancelPreview(): void {
    if (activePreflightRequestId !== undefined) {
      void window.budgetApi.import.cancelPreview(activePreflightRequestId);
    }
  }

  function updateFilePath(nextFilePath: string): void {
    setFilePath(nextFilePath);
    setPreview(null);
    setIsPreviewExpanded(true);
    setPreviewPage(0);
    setValidationReportPage(0);
    setDuplicateDecisions({});
    setAcknowledgeExcludedRows(false);
    setImportState({ status: "idle" });
    setStage("select-file");
  }

  function updateAccountId(nextAccountId: string): void {
    setAccountId(nextAccountId);
    setPreview(null);
    setIsPreviewExpanded(true);
    setPreviewPage(0);
    setValidationReportPage(0);
    setDuplicateDecisions({});
    setAcknowledgeExcludedRows(false);
    setImportState({ status: "idle" });
    setStage(filePath.trim() ? "map-and-validate" : "select-file");
  }

  function handleImport(): void {
    const trimmedPath = filePath.trim();
    if (!trimmedPath || !accountId || preview === null || unresolvedDuplicateCandidates.length > 0 || excludedRowsAcknowledgementRequired) return;

    setImportState({ status: "pending" });
    setStage("confirm");
    window.budgetApi.import
      .importPdf({
        filePath: trimmedPath,
        previewId: preview.previewId,
        accountId,
        acknowledgeExcludedRows,
        duplicateDecisions: Object.entries(duplicateDecisions).map(([rowIndex, action]) => ({
          rowIndex: Number(rowIndex),
          action,
        })),
      })
      .then((response) => {
        if (response.ok) {
          if (importPathEntryRef.current !== null) importPathEntryRef.current.open = false;
          setImportState({
            status: "success",
            importJobId: response.importJobId,
            sourceName: fileNameFromPath(trimmedPath),
            accountName: accounts.find((account) => account.id === accountId)?.name ?? "Unavailable",
            transactionCount: response.transactionCount,
            duplicateCount: response.duplicateCount,
            excludedRowCount: response.excludedRowCount,
            unresolvedRowCount: response.unresolvedRowCount ?? 0,
            adapterId: response.adapterId,
          });
          setStage("complete");
          setFilePath("");
          setPreview(null);
          setPreviewPage(0);
          setValidationReportPage(0);
          setAcknowledgeExcludedRows(false);
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
    <section aria-label="Digital statement import">
      {importState.status !== "success" && (
        <>
          <h2>Import digital statement</h2>
          <p className="section-intro">Use a standalone <strong>.txt</strong> statement or digital bank statement ending in <strong>.pdf</strong>. Scanned image statements are not supported.</p>
        </>
      )}
      {importState.status !== "success" && accountLoadState === "loading" && <p role="status">Loading accounts...</p>}
      {importState.status !== "success" && accountLoadState === "error" && (
        <div role="alert">
          <p>Available accounts could not be loaded.</p>
          <button type="button" onClick={() => setAccountRefreshKey((key) => key + 1)}>Retry account loading</button>
        </div>
      )}
      {importState.status !== "success" && accountLoadState === "ready" && (
        <ImportAccountSelect
          id="pdf-import-account"
          label="Import into account"
          accounts={accounts}
          value={accountId}
          onChange={updateAccountId}
          disabled={importState.status === "pending"}
        />
      )}
      {importState.status !== "success" && <ImportStageProgress format="PDF" stage={stage} />}
      {importState.status !== "success" && (
        <div className="import-file-source">
          <p aria-live="polite" className="import-selected-file">
            {filePath ? <><strong>Selected file:</strong> <code>{fileNameFromPath(filePath)}</code></> : "No statement file selected."}
          </p>
          <button type="button" className="action-secondary import-secondary-action" onClick={() => void onChooseFile()}>
            {filePath ? "Change statement file" : "Choose statement file"}
          </button>
        </div>
      )}
      <details ref={importPathEntryRef} className="import-path-entry">
        <summary>
          {importState.status === "success" ? "Advanced: enter a new file path" : "Advanced: enter a file path"}
        </summary>
        <label htmlFor="pdf-file-path">Statement file path</label>
        <input
          id="pdf-file-path"
          type="text"
          value={filePath}
          onChange={(event) => updateFilePath(event.target.value)}
          placeholder="C:\\path\\to\\statement.pdf"
          disabled={importState.status === "pending"}
        />
      </details>
      {importState.status !== "success" && (
        <div id="pdf-preview-actions" className="import-preview-actions" role="group" aria-label="Statement import actions">
          <button
            id="pdf-preview-button"
            type="button"
            onClick={handlePreviewButtonClick}
            aria-expanded={preview !== null && isPreviewExpanded}
            aria-controls={preview === null ? undefined : "pdf-preview-panel"}
            disabled={importState.status === "pending" || !filePath.trim() || accountLoadState !== "ready" || !accountId}
          >
            {preview === null ? "Preview statement" : isPreviewExpanded ? "Hide preview" : "Show preview"}
          </button>
          {filePath.trim() !== "" && importState.status !== "pending" && (
            <button
              type="button"
              className="action-secondary import-secondary-action"
              onClick={onCancelImport}
            >
              Cancel import
            </button>
          )}
        </div>
      )}
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
      {importState.status === "pending" && (
        <p role="status">{getImportPendingMessage(stage)}</p>
      )}
      {importState.status === "success" && (
        <div className="import-success">
          <div className="import-result-summary" role="region" aria-label="Import result summary">
            <h3>Import complete</h3>
            <p className="import-success-source">
              <strong>{importState.sourceName}</strong> was imported into <strong>{importState.accountName}</strong>.
            </p>
            <p role="status" aria-label="Transactions imported">
              {importState.transactionCount === 0
                ? "No new transactions were added."
                : `Added ${importState.transactionCount} transaction${importState.transactionCount === 1 ? "" : "s"} to your ledger.`}
            </p>
            <p className="import-duplicate-summary">
              {importState.duplicateCount} duplicate row{importState.duplicateCount === 1 ? "" : "s"} skipped.
            </p>
            {importState.excludedRowCount > 0 && (
              <p className="import-excluded-summary">
                {importState.excludedRowCount} row{importState.excludedRowCount === 1 ? "" : "s"} not yet booked were left out.
              </p>
            )}
            {importState.unresolvedRowCount > 0 && (
              <p className="import-excluded-summary">
                {importState.unresolvedRowCount} row{importState.unresolvedRowCount === 1 ? "" : "s"} {importState.unresolvedRowCount === 1 ? "was" : "were"} sent to review during import.
              </p>
            )}
            <p className="import-original-file-note">
              The original statement file stays in its original folder. The import saves transaction rows and a history record, not a copy of the statement.
            </p>
          </div>
          <div className="import-success-actions" aria-label="Next import actions">
            {importState.unresolvedRowCount > 0 && (
              <button type="button" onClick={onReviewImportItems}>Review unresolved rows</button>
            )}
            <button
              type="button"
              className={importState.unresolvedRowCount > 0 ? "import-secondary-action" : undefined}
              onClick={onReviewUncategorized}
            >
              Review uncategorized transactions
            </button>
            <button type="button" className="import-secondary-action" onClick={onOpenLedger}>Return to ledger</button>
            <button type="button" className="import-secondary-action" onClick={() => void onChooseFile()}>
              Import another statement
            </button>
          </div>
        </div>
      )}
      {importState.status === "cancelled" && <p role="status">Preview cancelled. No transactions were saved.</p>}
      {importState.status === "error" && <p role="alert">Import failed: {importState.message}</p>}
      {importState.status === "validation" && (
        <div role="alert">
          <p>Import validation failed:</p>
          <p>{validationErrors.length} issue{validationErrors.length === 1 ? "" : "s"} found. No transactions were saved.</p>
          <p>Open the validation report, correct the source, then preview again.</p>
          <details className="import-validation-report">
            <summary>PDF validation report ({importState.errors.errors.length} issue{importState.errors.errors.length === 1 ? "" : "s"})</summary>
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
          {unresolvedInput !== undefined && (
            <details className="import-unresolved-source">
              <summary>Unresolved source evidence</summary>
              <p>Source: {fileNameFromPath(unresolvedInput.sourceName)}</p>
              {unresolvedInput.sourceDocument === undefined ? (
                <p>No page text was extracted. Review the diagnostic above and the selected file.</p>
              ) : unresolvedInput.sourceDocument.pages.map((page) => (
                <section className="import-source-page" aria-label={`Page ${page.pageNumber} source evidence`} key={page.pageNumber}>
                  <h4>Page {page.pageNumber}</h4>
                  <ol aria-label={`Page ${page.pageNumber} source lines`}>
                    {page.sourceLines.map((line) => (
                      <li key={`${page.pageNumber}-${line.lineNumber}-${line.startOffset}`}>
                        <span>
                          Line {line.lineNumber} · offsets {line.startOffset}-{line.endOffset}
                          {line.classification === undefined ? "" : ` · ${line.classification}`}
                        </span>
                        <pre>{line.rawText || "(blank line)"}</pre>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </details>
          )}
        </div>
      )}
      {preview !== null && importState.status !== "success" && (
        <div id="pdf-preview-panel" className="import-preview-panel" hidden={!isPreviewExpanded}>
          <section
            ref={previewRegionRef}
            aria-label="PDF import preview"
            className="import-preview-region"
            tabIndex={-1}
          >
          <h3>Review statement</h3>
          <p className="import-account-summary">
            Importing into account: <strong>{accounts.find((account) => account.id === accountId)?.name ?? "Unavailable"}</strong>.
          </p>
          <p className="preview-summary" aria-live="polite">
            <strong>{preview.transactions.length} booked transaction{preview.transactions.length === 1 ? "" : "s"} ready for import.</strong>{" "}
            {unresolvedRowCount > 0
              ? `${unresolvedRowCount} unresolved row${unresolvedRowCount === 1 ? "" : "s"} will be saved for review, not as transactions. `
              : ""}
            {duplicateCandidates.length === 0
              ? "No possible duplicates found."
              : `${selectedDuplicateDecisionCount} of ${duplicateCandidates.length} duplicate decisions selected.`}
          </p>
          {duplicateCandidates.length > 0 && (
            <DuplicateBulkActions
              candidateCount={duplicateCandidates.length}
              onChoose={(action) => {
                const decisions: Record<number, DuplicateImportDecision["action"]> = {};
                for (const candidate of duplicateCandidates) decisions[candidate.rowIndex] = action;
                setDuplicateDecisions(decisions);
              }}
            />
          )}
          {preview.excludedRowCount > 0 && (
            <>
              <p className="import-excluded-summary">
                {preview.excludedRowCount} row{preview.excludedRowCount === 1 ? "" : "s"} are not booked by the bank and will not be imported.
              </p>
              <details className="import-excluded-rows">
                <summary>Excluded rows ({preview.excludedRows.length})</summary>
                <ul aria-label="Excluded rows">
                  {preview.excludedRows.map((row, index) => (
                    <li key={`${row.lineNumber}-${row.status}-${index}`}>
                      Line {row.lineNumber} · {row.date} · {row.description} · {row.amount} {row.currencyCode} · {row.status}
                    </li>
                  ))}
                </ul>
              </details>
              <label className="import-excluded-acknowledgement">
                <input
                  type="checkbox"
                  checked={acknowledgeExcludedRows}
                  onChange={(event) => setAcknowledgeExcludedRows(event.target.checked)}
                />
                <span>
                  I understand that these {preview.excludedRowCount} row{preview.excludedRowCount === 1 ? "" : "s"} are not booked and will be left out.
                </span>
              </label>
            </>
          )}
          {unresolvedRowCount > 0 && (
            <details className="import-validation-report">
              <summary>Unresolved rows for review ({unresolvedRowCount})</summary>
              <ul aria-label="PDF unresolved rows">
                {unresolvedRows.map((row, index) => (
                  <li key={`${row.lineNumber}-${index}`}>
                    Line {row.lineNumber}: <pre>{row.rawRow}</pre>
                    <ul>
                      {row.errors.map((error, errorIndex) => (
                        <li key={`${error.code}-${errorIndex}`}>
                          {error.field === undefined ? "" : `${error.field}: `}{error.message}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="import-preview-confirmation">
            <button
              id="pdf-confirm-button"
              type="button"
              onClick={handleImport}
              aria-describedby="pdf-confirm-help"
              disabled={importState.status === "pending" || preview === null || unresolvedDuplicateCandidates.length > 0 || excludedRowsAcknowledgementRequired}
            >
              Confirm statement import
            </button>
            <p id="pdf-confirm-help" className="import-action-help">
              {importState.status === "pending"
                ? "Wait for the current import operation to finish."
                : excludedRowsAcknowledgementRequired
                  ? "Acknowledge the excluded rows before confirming this import."
                  : unresolvedRowCount > 0
                    ? `Confirm to import valid rows and retain ${unresolvedRowCount} unresolved row${unresolvedRowCount === 1 ? "" : "s"} for review.`
                    : unresolvedDuplicateCandidates[0] !== undefined
                      ? <>
                          Choose whether to skip or import duplicate row {unresolvedDuplicateCandidates[0].rowIndex + 1} before confirming.{" "}
                          <button
                            type="button"
                            className="import-secondary-action import-inline-action"
                            onClick={() => {
                              const rowIndex = unresolvedDuplicateCandidates[0]!.rowIndex;
                              setPreviewPage(Math.floor(rowIndex / PREVIEW_PAGE_SIZE));
                              setDuplicateRowToFocus(rowIndex);
                            }}
                          >
                            Go to unresolved duplicate
                          </button>
                        </>
                      : "Review the statement rows below, then confirm. Nothing is saved yet."}
            </p>
          </div>
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
                    <tr key={transaction.id} id={`pdf-preview-row-${rowIndex}`} tabIndex={-1} data-state={duplicateCandidate === undefined ? "ready" : "duplicate"}>
                      <td data-label="Date">{transaction.bookedAtIso.slice(0, 10)}</td>
                      <td data-label="Merchant">
                        <span className="import-preview-cell-value">{transaction.merchantRaw}</span>
                      </td>
                      <td data-label="Amount">{formatAmount(transaction.amountMinor)}</td>
                      <td data-label="Currency">{transaction.currencyCode ?? "NOK"}</td>
                      <td data-label="Status and duplicate decision">
                        {duplicateCandidate === undefined
                          ? "Booked · will import"
                          : (
                            <div className="import-duplicate-decision">
                              <strong>Duplicate candidate</strong>
                              <small>Matched by {duplicateCandidate.duplicateMatch.matchBasis === "source-reference" ? "source reference" : "transaction fingerprint"}.</small>
                              <details className="import-duplicate-match-details">
                                <summary>Compare existing transaction</summary>
                                <span className="import-duplicate-match">
                                  Existing: {duplicateCandidate.duplicateMatch.matchingTransaction.bookedAtIso.slice(0, 10)} · {duplicateCandidate.duplicateMatch.matchingTransaction.merchantRaw} · {formatAmount(duplicateCandidate.duplicateMatch.matchingTransaction.amountMinor)}
                                </span>
                              </details>
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
        </div>
      )}
    </section>
  );
}