import React from "react";
import { CsvImportSection } from "../import/CsvImportSection.js";
import { ImportReviewSection } from "../import/ImportReviewSection.js";
import { ImportHistorySection } from "../import/ImportHistorySection.js";
import { ManualEntrySection } from "../import/ManualEntrySection.js";
import { PdfImportSection } from "../import/PdfImportSection.js";
import { classifyImportFilePath } from "../../domain/import/sourceDocument.js";
import type { HouseholdAccountContext } from "../../domain/types.js";
import { ImportAccountSelect } from "../import/ImportAccountSelect.js";

type ImportFormat = "csv" | "pdf" | "manual";
type ImportWorkspaceView = "new-import" | "review" | "history";

interface ImportWorkspaceProps {
  isFirstImport?: boolean;
  onExplore?: () => void;
  isActive: boolean;
  refreshKey: number;
  onImportSuccess: () => void;
  onOpenLedger: () => void;
  onReviewUncategorized: () => void;
}

export function ImportWorkspace({
  isFirstImport = false,
  onExplore,
  isActive,
  refreshKey,
  onImportSuccess,
  onOpenLedger,
  onReviewUncategorized,
}: ImportWorkspaceProps): React.JSX.Element {
  const [selectedFormat, setSelectedFormat] = React.useState<ImportFormat | null>(null);
  const [activeView, setActiveView] = React.useState<ImportWorkspaceView>("new-import");
  const [hasStatementImportCompleted, setHasStatementImportCompleted] = React.useState(false);
  const [visitedFormats, setVisitedFormats] = React.useState<Set<ImportFormat>>(() => new Set());
  const [selectedFilePath, setSelectedFilePath] = React.useState("");
  const [fileSelectionId, setFileSelectionId] = React.useState(0);
  const [selectionError, setSelectionError] = React.useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = React.useState<string | null>(null);
  const [context, setContext] = React.useState<HouseholdAccountContext | null>(null);
  const [selectedAccountId, setSelectedAccountId] = React.useState("");
  const [contextError, setContextError] = React.useState<string | null>(null);
  const [contextRefreshKey, setContextRefreshKey] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    setContextError(null);
    window.budgetApi.accounts.getCurrent().then((current) => {
      if (!active) return;
      if (current === null) throw new Error("No local household is configured.");
      const firstAccount = current.accounts[0];
      if (firstAccount === undefined) throw new Error("No accounts are available for import.");
      setContext(current);
      setSelectedAccountId((selected) => selected || firstAccount.id);
    }).catch((error: unknown) => {
      if (active) setContextError(error instanceof Error ? error.message : "Could not load the import household.");
    });
    return () => { active = false; };
  }, [contextRefreshKey, refreshKey]);

  const selectedAccount = context?.accounts.find((account) => account.id === selectedAccountId);

  async function chooseStatementFile(): Promise<void> {
    try {
      if (selectedAccount === undefined) {
        setSelectionError("Choose an available destination account before selecting a statement.");
        return;
      }
      const selectedPath = await window.budgetApi.dialogs.chooseImportStatementPath();
      if (selectedPath === null) return;
      const fileFormat = classifyImportFilePath(selectedPath);
      if (fileFormat === undefined) {
        setSelectionError("Choose a supported .csv, .txt, or .pdf statement.");
        return;
      }

      const importFormat = fileFormat === "csv" ? "csv" : "pdf";
      setSelectedFilePath(selectedPath);
      setFileSelectionId((current) => current + 1);
      setSelectionError(null);
      setSelectionNotice(null);
      setSelectedFormat(importFormat);
      setActiveView("new-import");
      setHasStatementImportCompleted(false);
      setVisitedFormats((visited) => new Set(visited).add(importFormat));
    } catch (error: unknown) {
      setSelectionError(error instanceof Error ? error.message : "Could not open the statement file picker.");
    }
  }

  function selectManualEntry(): void {
    setSelectedFormat("manual");
    setActiveView("new-import");
    setHasStatementImportCompleted(false);
    setSelectionNotice(null);
    setSelectionError(null);
    setVisitedFormats((visited) => new Set(visited).add("manual"));
    window.requestAnimationFrame(() => document.getElementById("import-workspace-heading")?.focus());
  }

  function cancelStatementImport(): void {
    setSelectedFormat(null);
    setSelectedFilePath("");
    setFileSelectionId((current) => current + 1);
    setSelectionError(null);
    setSelectionNotice("Import cancelled. No transactions were saved.");
    setHasStatementImportCompleted(false);
    window.requestAnimationFrame(() => document.getElementById("import-statement-picker-button")?.focus());
  }

  function handleStatementImportSuccess(): void {
    setHasStatementImportCompleted(true);
    onImportSuccess();
  }

  function focusImportReview(): void {
    setActiveView("review");
    window.requestAnimationFrame(() => document.getElementById("import-review-queue")?.focus());
  }

  const isManualEntry = activeView === "new-import" && selectedFormat === "manual";
  const headingDescription = isManualEntry
    ? "Add one transaction directly to your ledger. No statement file is needed."
    : activeView === "new-import"
    ? hasStatementImportCompleted
      ? "Import complete. The summary below shows what was added and what stayed unchanged."
      : "Choose a statement, review the rows, then decide what to add."
    : activeView === "review"
      ? "Correct or dismiss rows that could not be imported as transactions."
      : "Review past imports and see what an undo will remove or keep.";

  return (
    <section className="destination-workspace" aria-label="Import workspace" hidden={!isActive}>
      <div className="destination-heading">
        <h2 id="import-workspace-heading" tabIndex={-1}>{isManualEntry ? "Add a transaction" : "Import"}</h2>
        <p>{headingDescription}</p>
        {context !== null && (
          <p role="status" aria-label="Import household">{context.householdName}</p>
        )}
        {selectedAccount !== undefined && (
          <p role="status" aria-label="Import destination">
            {selectedAccount.name} · {selectedAccount.currencyCode}
          </p>
        )}
        {contextError !== null && (
          <div role="alert">
            <p>{contextError}</p>
            <button type="button" onClick={() => setContextRefreshKey((key) => key + 1)}>
              Retry household loading
            </button>
          </div>
        )}
      </div>
      {!isManualEntry && !isFirstImport && (
      <div className="import-workspace-switcher" role="group" aria-label="Import sections">
        <button
          type="button"
          aria-pressed={activeView === "new-import"}
          onClick={() => setActiveView("new-import")}
        >
          New import
        </button>
        <button
          type="button"
          aria-pressed={activeView === "review"}
          onClick={() => setActiveView("review")}
        >
          Import row review
        </button>
        <button
          type="button"
          aria-pressed={activeView === "history"}
          onClick={() => setActiveView("history")}
        >
          Import history
        </button>
      </div>
      )}
      {isFirstImport && (
        <p className="import-first-use-guidance">
          Preview your first statement before adding it to the ledger.{" "}
          <button type="button" className="import-secondary-action action-secondary" onClick={onExplore}>
            Explore other workspaces
          </button>
        </p>
      )}
      {activeView === "new-import" && (
        <div className="import-new-panel">
          {selectedFormat === null && (
            <div className="import-file-source">
              {context !== null && (
                <ImportAccountSelect
                  id="statement-import-account"
                  label="Import into account"
                  accounts={context.accounts}
                  value={selectedAccountId}
                  onChange={setSelectedAccountId}
                />
              )}
              <button
                id="import-statement-picker-button"
                type="button"
                className="import-file-choice-primary"
                aria-describedby="import-statement-file-help"
                disabled={selectedAccount === undefined || contextError !== null}
                onClick={() => void chooseStatementFile()}
              >
                Choose statement file
              </button>
              <p id="import-statement-file-help">
                Choose a local .csv, .txt, or digital .pdf statement. Scanned-image PDFs are not supported.
              </p>
            </div>
          )}
          {selectionError !== null && <p role="alert">{selectionError}</p>}
          {selectionNotice !== null && selectedFormat === null && (
            <p role="status">{selectionNotice}</p>
          )}
          {selectedFormat === null && (
            <>
              <button
                id="manual-entry-choice"
                type="button"
                className="import-secondary-action action-secondary"
                onClick={selectManualEntry}
              >
                Enter transaction manually
              </button>
              <p className="empty-state">A statement import is saved only when you confirm it.</p>
            </>
          )}
          {(selectedFormat === "pdf" || selectedFormat === "csv") && !hasStatementImportCompleted && (
            <button
              id="manual-entry-choice"
              type="button"
              className="import-manual-entry-link"
              onClick={selectManualEntry}
            >
              Enter a transaction manually instead
            </button>
          )}
      {visitedFormats.has("csv") && (
        <div className="import-format-content" hidden={selectedFormat !== "csv"}>
          <CsvImportSection
            preferredAccountId={selectedAccountId}
            onAccountChange={setSelectedAccountId}
            initialFilePath={selectedFilePath}
            fileSelectionId={fileSelectionId}
            onChooseFile={chooseStatementFile}
            onCancelImport={cancelStatementImport}
            onImportSuccess={handleStatementImportSuccess}
            onOpenLedger={onOpenLedger}
            onReviewUncategorized={onReviewUncategorized}
            onReviewImportItems={focusImportReview}
          />
        </div>
      )}
      {visitedFormats.has("pdf") && (
        <div className="import-format-content" hidden={selectedFormat !== "pdf"}>
          <PdfImportSection
            preferredAccountId={selectedAccountId}
            onAccountChange={setSelectedAccountId}
            initialFilePath={selectedFilePath}
            fileSelectionId={fileSelectionId}
            onChooseFile={chooseStatementFile}
            onCancelImport={cancelStatementImport}
            onImportSuccess={handleStatementImportSuccess}
            onOpenLedger={onOpenLedger}
            onReviewUncategorized={onReviewUncategorized}
            onReviewImportItems={focusImportReview}
          />
        </div>
      )}
      {visitedFormats.has("manual") && (
        <div className="import-format-content" hidden={selectedFormat !== "manual"}>
          <ManualEntrySection
            onEntrySuccess={onImportSuccess}
            onOpenLedger={onOpenLedger}
            onReviewUncategorized={onReviewUncategorized}
          />
        </div>
      )}
      {isManualEntry && (
        <button
          type="button"
          className="import-secondary-action"
          onClick={() => {
            setSelectedFormat(null);
            setSelectionError(null);
            window.requestAnimationFrame(() => document.getElementById("manual-entry-choice")?.focus());
          }}
        >
          Back to statement imports
        </button>
      )}
        </div>
      )}
      {activeView === "review" && isActive && (
        <ImportReviewSection isActive={isActive} refreshKey={refreshKey} onReviewChange={onImportSuccess} />
      )}
      {activeView === "history" && isActive && (
        <ImportHistorySection refreshKey={refreshKey} onUndoSuccess={onImportSuccess} />
      )}
    </section>
  );
}