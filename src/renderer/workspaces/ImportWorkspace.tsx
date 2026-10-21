import React from "react";
import { CsvImportSection } from "../import/CsvImportSection.js";
import { ImportReviewSection } from "../import/ImportReviewSection.js";
import { ImportHistorySection } from "../import/ImportHistorySection.js";
import { ManualEntrySection } from "../import/ManualEntrySection.js";
import { PdfImportSection } from "../import/PdfImportSection.js";
import { classifyImportFilePath } from "../../domain/import/sourceDocument.js";

type ImportFormat = "csv" | "pdf" | "manual";

interface ImportWorkspaceProps {
  isActive: boolean;
  refreshKey: number;
  onImportSuccess: () => void;
  onOpenLedger: () => void;
  onReviewUncategorized: () => void;
}

export function ImportWorkspace({
  isActive,
  refreshKey,
  onImportSuccess,
  onOpenLedger,
  onReviewUncategorized,
}: ImportWorkspaceProps): React.JSX.Element {
  const [selectedFormat, setSelectedFormat] = React.useState<ImportFormat | null>(null);
  const [visitedFormats, setVisitedFormats] = React.useState<Set<ImportFormat>>(() => new Set());
  const [selectedFilePath, setSelectedFilePath] = React.useState("");
  const [fileSelectionId, setFileSelectionId] = React.useState(0);
  const [selectionError, setSelectionError] = React.useState<string | null>(null);

  async function chooseStatementFile(): Promise<void> {
    try {
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
      setSelectedFormat(importFormat);
      setVisitedFormats((visited) => new Set(visited).add(importFormat));
    } catch (error: unknown) {
      setSelectionError(error instanceof Error ? error.message : "Could not open the statement file picker.");
    }
  }

  function selectManualEntry(): void {
    setSelectedFormat("manual");
    setVisitedFormats((visited) => new Set(visited).add("manual"));
  }

  function focusImportReview(): void {
    document.getElementById("import-review-queue")?.focus();
  }

  return (
    <section className="destination-workspace" aria-label="Import workspace" hidden={!isActive}>
      <div className="destination-heading">
        <h2>Import</h2>
        <p>Choose a statement to preview its rows before anything is saved.</p>
      </div>
      <div className="import-file-source">
        <button
          id="import-statement-picker-button"
          type="button"
          className="import-file-choice-primary"
          aria-describedby="import-statement-file-help"
          onClick={() => void chooseStatementFile()}
        >
          Import statement
        </button>
        <p id="import-statement-file-help">
          Select a local .csv, .txt, or digital .pdf statement. Scanned-image PDFs are not supported.
        </p>
      </div>
      {selectionError !== null && <p role="alert">{selectionError}</p>}
      <button
        id="manual-entry-choice"
        type="button"
        className="import-secondary-action"
        onClick={selectManualEntry}
      >
        Enter transaction manually
      </button>
      {selectedFormat === null && (
        <p className="empty-state">Choose a statement file or enter a transaction manually.</p>
      )}
      {visitedFormats.has("csv") && (
        <div className="import-format-content" hidden={selectedFormat !== "csv"}>
          <CsvImportSection
            initialFilePath={selectedFilePath}
            fileSelectionId={fileSelectionId}
            onImportSuccess={onImportSuccess}
            onOpenLedger={onOpenLedger}
            onReviewUncategorized={onReviewUncategorized}
            onReviewImportItems={focusImportReview}
          />
        </div>
      )}
      {visitedFormats.has("pdf") && (
        <div className="import-format-content" hidden={selectedFormat !== "pdf"}>
          <PdfImportSection
            initialFilePath={selectedFilePath}
            fileSelectionId={fileSelectionId}
            onImportSuccess={onImportSuccess}
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
      <ImportReviewSection
        isActive={isActive}
        refreshKey={refreshKey}
        onReviewChange={onImportSuccess}
      />
      <ImportHistorySection refreshKey={refreshKey} onUndoSuccess={onImportSuccess} />
    </section>
  );
}