import React from "react";
import type {
  CsvImportPreviewSuccess,
  CsvImportResponse,
} from "../../app/import/importCsv.js";
import type { CsvColumnKey, CsvColumnMapping } from "../../domain/import/csvRowMapper.js";
import type { CsvImportProfile } from "../../domain/import/csvImportProfile.js";
import type { DuplicateImportDecision } from "../../domain/import/filterPreviouslyImportedTransactions.js";
import type { Account } from "../../domain/types.js";
import { ImportStageProgress, type ImportWorkflowStage } from "./ImportStageProgress.js";

type ImportState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "cancelled" }
  | { status: "success"; importJobId: string; transactionCount: number; duplicateCount: number }
  | { status: "error"; message: string }
  | { status: "validation"; errors: CsvImportResponse & { ok: false } };

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

interface CsvImportSectionProps {
  onImportSuccess: () => void;
  onOpenLedger: () => void;
  onReviewUncategorized: () => void;
}

export function CsvImportSection({ onImportSuccess, onOpenLedger, onReviewUncategorized }: CsvImportSectionProps): React.JSX.Element {
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [profiles, setProfiles] = React.useState<CsvImportProfile[]>([]);
  const [profileName, setProfileName] = React.useState("");
  const [profileAccountId, setProfileAccountId] = React.useState("");
  const [editingProfileId, setEditingProfileId] = React.useState<string | null>(null);
  const [importAccountId, setImportAccountId] = React.useState<string | undefined>();
  const [profileError, setProfileError] = React.useState<string | null>(null);
  const [profileLoadState, setProfileLoadState] = React.useState<"loading" | "ready" | "error">("loading");
  const [profileRefreshKey, setProfileRefreshKey] = React.useState(0);
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
  const [preview, setPreview] = React.useState<CsvImportPreviewSuccess | null>(null);
  const [previewPage, setPreviewPage] = React.useState(0);
  const [validationReportPage, setValidationReportPage] = React.useState(0);
  const [duplicateDecisions, setDuplicateDecisions] = React.useState<Record<number, DuplicateImportDecision["action"]>>({});
  const [columnMapping, setColumnMapping] = React.useState<CsvColumnMapping>({});
  const [previewMapping, setPreviewMapping] = React.useState<CsvColumnMapping | null>(null);
  const validPreviewRowCount = preview?.rows.filter((row) => row.transaction !== undefined).length ?? 0;
  const invalidPreviewRowCount = preview?.rows.length === undefined
    ? 0
    : preview.rows.length - validPreviewRowCount;
  const invalidPreviewRows = preview?.rows.filter((row) => row.errors.length > 0) ?? [];
  const validationReportPageCount = Math.max(1, Math.ceil(invalidPreviewRows.length / PREVIEW_PAGE_SIZE));
  const visibleValidationRows = invalidPreviewRows.slice(
    validationReportPage * PREVIEW_PAGE_SIZE,
    (validationReportPage + 1) * PREVIEW_PAGE_SIZE
  );
  const previewPageCount = Math.max(1, Math.ceil((preview?.rows.length ?? 0) / PREVIEW_PAGE_SIZE));
  const visiblePreviewRows = preview?.rows.slice(
    previewPage * PREVIEW_PAGE_SIZE,
    (previewPage + 1) * PREVIEW_PAGE_SIZE
  ) ?? [];
  const unresolvedDuplicateRows = preview?.rows.filter((row) =>
    row.duplicateMatch !== undefined && duplicateDecisions[row.rowIndex] === undefined
  ) ?? [];
  const isMappingCurrent = preview !== null && previewMapping !== null &&
    JSON.stringify(previewMapping) === JSON.stringify(columnMapping);
  const firstInvalidRow = preview?.rows.find((row) => row.errors.length > 0);
  const confirmationDisabled = importState.status === "pending" || preview === null ||
    !isMappingCurrent || invalidPreviewRowCount > 0 || unresolvedDuplicateRows.length > 0;

  React.useEffect(() => {
    let active = true;
    setProfileLoadState("loading");
    Promise.all([
      window.budgetApi.accounts.list("sample-hh"),
      window.budgetApi.import.profiles.list(),
    ]).then(([loadedAccounts, loadedProfiles]) => {
      if (!active) return;
      setAccounts(loadedAccounts);
      setProfiles(loadedProfiles);
      setProfileLoadState("ready");
    }).catch(() => {
      if (active) setProfileLoadState("error");
    });

    return () => {
      active = false;
    };
  }, [profileRefreshKey]);

  React.useEffect(() => window.budgetApi.import.onPreflightProgress((progress) => {
    if (progress.format !== "csv") return;
    setPreflightProgress((current) => current?.requestId === progress.requestId
      ? { ...current, phase: progress.phase, completedRows: progress.completedRows, totalRows: progress.totalRows }
      : current);
  }), []);

  const mappingFields: Array<{ key: CsvColumnKey; label: string }> = [
    { key: "executionDate", label: "Execution date" },
    { key: "bookedDate", label: "Booked date" },
    { key: "description", label: "Description" },
    { key: "amountIn", label: "Amount in" },
    { key: "amountOut", label: "Amount out" },
    { key: "currency", label: "Currency" },
    { key: "reference", label: "Reference" },
  ];

  const mappingHelp: Record<CsvColumnKey, string> = {
    executionDate: "When the transaction happened, if your bank provides it.",
    bookedDate: "When the transaction posted to your account; preferred when available.",
    description: "The merchant or payment description.",
    amountIn: "Money received into the account.",
    amountOut: "Money spent from the account.",
    currency: "The currency code, such as NOK.",
    status: "The bank's transaction status, if available.",
    reference: "A payment reference, KID, or invoice number.",
  };

  async function handlePreview(): Promise<void> {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) return;

    const requestId = crypto.randomUUID();
    setActivePreflightRequestId(requestId);
    setPreflightProgress({ requestId, phase: "Reading statement", completedRows: 0, totalRows: 0 });
    setImportState({ status: "pending" });
    setStage("map-and-validate");
    setDuplicateDecisions({});
    let wasCancelled = false;
    try {
      const response = await window.budgetApi.import.previewCsv({
        filePath: trimmedPath,
        requestId,
        columnMapping,
        ...(importAccountId === undefined ? {} : { accountId: importAccountId }),
      });
      if (response.ok) {
        setPreview(response);
        setPreviewPage(0);
        setValidationReportPage(0);
        setPreviewMapping(columnMapping);
        setImportState({ status: "idle" });
        setStage(response.rows.some((row) => row.errors.length > 0) ? "map-and-validate" : "review");
      } else if (response.code === "PREVIEW_CANCELLED") {
        wasCancelled = true;
        setPreview(null);
        setPreviewMapping(null);
        setImportState({ status: "cancelled" });
        setPreflightProgress({ requestId, phase: "Preview cancelled", completedRows: 0, totalRows: 0 });
        setStage("select-file");
      } else {
        setPreview(null);
        setPreviewMapping(null);
        setImportState({ status: "error", message: response.message });
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

  function navigateToValidationRow(rowIndex: number): void {
    setPreviewPage(Math.floor(rowIndex / PREVIEW_PAGE_SIZE));
  }

  function navigateToValidationPage(page: number): void {
    setValidationReportPage(Math.max(0, Math.min(page, validationReportPageCount - 1)));
  }

  function updateFilePath(nextFilePath: string): void {
    setFilePath(nextFilePath);
    setPreview(null);
    setPreviewMapping(null);
    setColumnMapping({});
    setDuplicateDecisions({});
    setPreviewPage(0);
    setValidationReportPage(0);
    setImportState({ status: "idle" });
    setStage("select-file");
  }

  async function handleChooseFile(): Promise<void> {
    try {
      const selectedPath = await window.budgetApi.dialogs.chooseCsvImportPath();
      if (selectedPath !== null) updateFilePath(selectedPath);
    } catch (error: unknown) {
      setImportState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown file selection error.",
      });
    }
  }

  async function saveProfile(): Promise<void> {
    if (!profileName.trim() || !profileAccountId) return;
    setProfileError(null);
    try {
      const profile = await window.budgetApi.import.profiles.save({
        ...(editingProfileId === null ? {} : { id: editingProfileId }),
        name: profileName.trim(),
        accountId: profileAccountId,
        columnMapping,
      });
      setProfiles((current) => [
        ...current.filter((item) => item.id !== profile.id),
        profile,
      ].sort((left, right) => left.name.localeCompare(right.name)));
      setEditingProfileId(null);
      setProfileName("");
    } catch (error: unknown) {
      setProfileError(error instanceof Error ? error.message : "Unable to save CSV profile.");
    }
  }

  function editProfile(profile: CsvImportProfile): void {
    setEditingProfileId(profile.id);
    setProfileName(profile.name);
    setProfileAccountId(accounts.some((account) => account.id === profile.accountId) ? profile.accountId : "");
    setProfileError(null);
  }

  function applyProfile(profile: CsvImportProfile): void {
    const account = accounts.find((item) => item.id === profile.accountId);
    if (account === undefined) {
      setProfileError("This profile's account is unavailable. Edit the profile and choose an available account.");
      return;
    }
    setColumnMapping(profile.columnMapping);
    setPreview(null);
    setPreviewMapping(null);
    setDuplicateDecisions({});
    setPreviewPage(0);
    setValidationReportPage(0);
    setImportAccountId(profile.accountId);
    setImportState({ status: "idle" });
    setProfileError(null);
    setStage(filePath ? "map-and-validate" : "select-file");
  }

  async function deleteProfile(profile: CsvImportProfile): Promise<void> {
    setProfileError(null);
    try {
      await window.budgetApi.import.profiles.delete(profile.id);
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      if (editingProfileId === profile.id) {
        setEditingProfileId(null);
        setProfileName("");
        setProfileAccountId("");
      }
    } catch (error: unknown) {
      setProfileError(error instanceof Error ? error.message : "Unable to delete CSV profile.");
    }
  }

  function handleImport(): void {
    const trimmedPath = filePath.trim();
    if (!trimmedPath || preview === null || previewMapping === null) return;
    if (JSON.stringify(previewMapping) !== JSON.stringify(columnMapping)) return;
    if (preview.rows.some((row) => row.errors.length > 0)) return;

    setImportState({ status: "pending" });
    setStage("confirm");

    window.budgetApi.import
      .importCsv({
        filePath: trimmedPath,
        previewId: preview.previewId,
        columnMapping,
        ...(importAccountId === undefined ? {} : { accountId: importAccountId }),
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
          });
          setStage("complete");
          setFilePath("");
          setPreview(null);
          setPreviewMapping(null);
          setDuplicateDecisions({});
          setTimeout(() => {
            onImportSuccess();
          }, 0);
        } else {
          setPreview(null);
          setPreviewMapping(null);
          setImportState({ status: "validation", errors: response });
          setStage("map-and-validate");
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown import error.";
        setImportState({ status: "error", message });
      });
  }

  return (
    <section aria-label="CSV Import">
      <h2>Import CSV</h2>
      <p className="section-intro">Use this for a bank export ending in <strong>.csv</strong>. Preview it first; nothing is saved until you confirm.</p>
      {importAccountId !== undefined && (
        <p className="import-profile-account">Import account: {accounts.find((account) => account.id === importAccountId)?.name ?? "Unavailable"}</p>
      )}
      <details className="csv-import-profiles">
        <summary aria-label="Manage CSV profiles">Manage CSV profiles ({profiles.length})</summary>
        {profileLoadState === "loading" && <p role="status">Loading CSV profiles and accounts...</p>}
        {profileLoadState === "error" && (
          <div role="alert">
            <p>CSV profiles and accounts could not be loaded.</p>
            <button type="button" onClick={() => setProfileRefreshKey((key) => key + 1)}>Retry profile loading</button>
          </div>
        )}
        {profileLoadState === "ready" && (
          <div className="csv-import-profile-manager">
            <label htmlFor="csv-profile-name">Profile name</label>
            <input
              id="csv-profile-name"
              type="text"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
            />
            <label htmlFor="csv-profile-account">Profile account</label>
            <select
              id="csv-profile-account"
              value={profileAccountId}
              onChange={(event) => setProfileAccountId(event.target.value)}
            >
              <option value="">Choose an account</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <p className="field-help">Saving a profile stores this account and the current column mapping. Applying it explicitly selects that account for the next preview.</p>
            <div className="csv-profile-form-actions">
              <button type="button" disabled={!profileName.trim() || !profileAccountId || profileLoadState !== "ready"} onClick={() => void saveProfile()}>
                {editingProfileId === null ? "Save CSV profile" : "Update CSV profile"}
              </button>
              {editingProfileId !== null && (
                <button type="button" className="import-secondary-action" onClick={() => {
                  setEditingProfileId(null);
                  setProfileName("");
                  setProfileAccountId("");
                }}>Cancel edit</button>
              )}
            </div>
            {profiles.length === 0
              ? <p className="empty-state">No CSV profiles saved.</p>
              : (
                <ul className="csv-import-profile-list" aria-label="Saved CSV profiles">
                  {profiles.map((profile) => (
                    <li key={profile.id}>
                      <span>{profile.name}</span>
                      <small>{accounts.find((account) => account.id === profile.accountId)?.name ?? "Account unavailable"}</small>
                      <div>
                        <button type="button" disabled={!accounts.some((account) => account.id === profile.accountId)} onClick={() => applyProfile(profile)} aria-label={`Use profile ${profile.name}`}>Use</button>
                        <button type="button" onClick={() => editProfile(profile)} aria-label={`Edit profile ${profile.name}`}>Edit</button>
                        <button type="button" className="import-secondary-action" onClick={() => void deleteProfile(profile)} aria-label={`Delete profile ${profile.name}`}>Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            {profileError !== null && <p role="alert">{profileError}</p>}
          </div>
        )}
      </details>
      <ImportStageProgress format="CSV" stage={stage} />
      <div className="import-file-source">
        <button id="csv-file-picker-button" type="button" className="import-file-choice-primary" onClick={() => void handleChooseFile()} disabled={importState.status === "pending"}>
          Choose CSV file
        </button>
        <p aria-live="polite" className="import-selected-file">
          {filePath ? <><strong>Selected:</strong> <code>{filePath}</code></> : "No CSV statement selected."}
        </p>
      </div>
      <details className="import-path-entry">
        <summary>Advanced: enter a file path</summary>
        <label htmlFor="csv-file-path">CSV file path</label>
        <input
          id="csv-file-path"
          type="text"
          value={filePath}
          onChange={(event) => updateFilePath(event.target.value)}
          placeholder="C:\\path\\to\\statement.csv"
          disabled={importState.status === "pending"}
        />
      </details>
      <button
        id="csv-preview-button"
        type="button"
        onClick={handlePreview}
        disabled={importState.status === "pending" || !filePath.trim()}
      >
        Preview CSV
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
        id="csv-confirm-button"
        type="button"
        onClick={handleImport}
        aria-describedby="csv-confirm-help"
        disabled={confirmationDisabled}
      >
        Confirm CSV import
      </button>
      <p id="csv-confirm-help" className="import-action-help">
        {importState.status === "pending"
          ? "Wait for the current import operation to finish."
          : preview === null
            ? filePath
              ? <>The selected file has not passed validation. <a href="#csv-preview-button">Preview CSV</a>.</>
              : <>Choose a CSV statement before previewing it. <a href="#csv-file-picker-button">Choose a file</a>.</>
            : !isMappingCurrent
              ? <>Validate the updated column mapping before confirming. <a href="#csv-preview-button">Preview CSV</a>.</>
              : firstInvalidRow !== undefined
                ? <>Row <a href={`#csv-preview-row-${firstInvalidRow.rowIndex}`}>{firstInvalidRow.rowIndex + 1}</a> needs attention before confirmation.</>
                : unresolvedDuplicateRows[0] !== undefined
                  ? <>Choose whether to skip or import duplicate <a href={`#csv-preview-row-${unresolvedDuplicateRows[0].rowIndex}`}>row {unresolvedDuplicateRows[0].rowIndex + 1}</a> before confirming.</>
                  : "Review the ready rows before confirming the import."}
      </p>
      {importState.status === "cancelled" && <p role="status">Preview cancelled. No transactions were saved.</p>}
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
      {importState.status === "error" && (
        <p role="alert">Import failed: {importState.message}</p>
      )}
      {importState.status === "validation" && (
        <div role="alert">
          <p>Import validation failed:</p>
          <ul>
            {importState.errors.errors.map((e) => (
              <li key={e.rowIndex}>
                {e.rowIndex < 0 ? "File" : `Row ${e.rowIndex + 1}`}: {e.messages.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview !== null && (
        <section aria-label="CSV import preview">
          <h3>CSV import preview</h3>
          <fieldset aria-label="CSV column mapping">
            <legend>Match your CSV columns</legend>
            {mappingFields.map(({ key, label }) => (
              <label key={key}>
                Map {label}
                <select
                  aria-label={`Map ${label}`}
                  aria-describedby={`csv-map-${key}-help`}
                  value={columnMapping[key] ?? ""}
                  onChange={(event) => {
                    const selectedHeader = event.target.value;
                    setColumnMapping((current) => {
                      const updated = { ...current };
                      if (selectedHeader === "") {
                        delete updated[key];
                      } else {
                        updated[key] = selectedHeader;
                      }
                      return updated;
                    });
                    setPreviewMapping(null);
                    setStage("map-and-validate");
                  }}
                >
                  <option value="">Automatic</option>
                  {preview.headers.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
                <span id={`csv-map-${key}-help`} className="field-help">{mappingHelp[key]}</span>
              </label>
            ))}
          </fieldset>
          <p className="preview-summary" aria-live="polite">
            <strong>{validPreviewRowCount} of {preview.rows.length} rows ready.</strong>{" "}
            {invalidPreviewRowCount > 0
              ? `${invalidPreviewRowCount} row${invalidPreviewRowCount === 1 ? "" : "s"} need${invalidPreviewRowCount === 1 ? "s" : ""} attention before import.`
              : "Everything in this preview can be imported."}
          </p>
          {preview.rows.some((row) => row.errors.length > 0) && (
            <div role="alert">
              <p>{invalidPreviewRowCount} row{invalidPreviewRowCount === 1 ? " needs" : "s need"} attention. Open the validation report for row details.</p>
            </div>
          )}
          {invalidPreviewRowCount > 0 && (
            <details className="import-validation-report">
              <summary>Validation report ({invalidPreviewRowCount} rows)</summary>
              <ul>
                {visibleValidationRows.flatMap((row) => row.errors.map((error) => (
                  <li key={`${row.rowIndex}-${error.code}`}>
                    Row {row.rowIndex + 1} · {error.field}: {error.message}
                    <button type="button" className="validation-row-link" onClick={() => navigateToValidationRow(row.rowIndex)}>
                      Show row
                    </button>
                  </li>
                )))}
              </ul>
              {validationReportPageCount > 1 && (
                <div className="import-preview-pagination" aria-label="Validation report pages">
                  <button type="button" disabled={validationReportPage === 0} onClick={() => navigateToValidationPage(validationReportPage - 1)}>Previous report page</button>
                  <span>Page {validationReportPage + 1} of {validationReportPageCount}</span>
                  <button type="button" disabled={validationReportPage + 1 >= validationReportPageCount} onClick={() => navigateToValidationPage(validationReportPage + 1)}>Next report page</button>
                </div>
              )}
            </details>
          )}
          <div className="preview-table-wrap">
            <table className="import-preview-table">
              <caption>CSV statement preview rows and validation states</caption>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Merchant or row</th><th scope="col">Amount</th><th scope="col">Currency</th><th scope="col">Status and duplicate decision</th></tr>
              </thead>
              <tbody>
                {visiblePreviewRows.map((row) => (
                  <tr key={row.rowIndex} id={`csv-preview-row-${row.rowIndex}`} data-state={row.transaction === undefined ? "invalid" : row.duplicateMatch === undefined ? "ready" : "duplicate"}>
                    <td data-label="Date">{row.transaction?.bookedAtIso.slice(0, 10) ?? "Needs review"}</td>
                    <td data-label="Merchant or row">{row.transaction?.merchantRaw ?? `Row ${row.rowIndex + 1}`}</td>
                    <td data-label="Amount">{row.transaction === undefined ? "Not ready" : formatAmount(row.transaction.amountMinor)}</td>
                    <td data-label="Currency">{row.transaction?.currencyCode ?? (row.transaction === undefined ? "Not available" : "NOK")}</td>
                    <td data-label="Status and duplicate decision">
                      {row.transaction === undefined
                        ? "Needs attention"
                        : row.duplicateMatch === undefined
                          ? "Ready"
                          : (
                            <div className="import-duplicate-decision">
                              <strong>Duplicate candidate</strong>
                              <small>Matched by {row.duplicateMatch.matchBasis === "source-reference" ? "source reference" : "transaction fingerprint"}.</small>
                              <span className="import-duplicate-match">
                                Existing: {row.duplicateMatch.matchingTransaction.bookedAtIso.slice(0, 10)} · {row.duplicateMatch.matchingTransaction.merchantRaw} · {formatAmount(row.duplicateMatch.matchingTransaction.amountMinor)}
                              </span>
                              <fieldset aria-label={`Duplicate decision for row ${row.rowIndex + 1}`}>
                                <label>
                                  <input
                                    type="radio"
                                    name={`csv-duplicate-${row.rowIndex}`}
                                    value="skip"
                                    checked={duplicateDecisions[row.rowIndex] === "skip"}
                                    onChange={() => setDuplicateDecisions((current) => ({ ...current, [row.rowIndex]: "skip" }))}
                                  />
                                  Skip duplicate
                                </label>
                                <label>
                                  <input
                                    type="radio"
                                    name={`csv-duplicate-${row.rowIndex}`}
                                    value="import"
                                    checked={duplicateDecisions[row.rowIndex] === "import"}
                                    onChange={() => setDuplicateDecisions((current) => ({ ...current, [row.rowIndex]: "import" }))}
                                  />
                                  Import duplicate
                                </label>
                              </fieldset>
                            </div>
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > PREVIEW_PAGE_SIZE && (
            <div className="import-preview-pagination" aria-label="CSV preview pages">
              <button type="button" disabled={previewPage === 0} onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}>Previous rows</button>
              <span aria-live="polite">
                Rows {previewPage * PREVIEW_PAGE_SIZE + 1}-{Math.min((previewPage + 1) * PREVIEW_PAGE_SIZE, preview.rows.length)} of {preview.rows.length.toLocaleString("nb-NO")} · Page {previewPage + 1} of {previewPageCount}
              </span>
              <button type="button" disabled={previewPage + 1 >= previewPageCount} onClick={() => setPreviewPage((page) => Math.min(previewPageCount - 1, page + 1))}>Next rows</button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
