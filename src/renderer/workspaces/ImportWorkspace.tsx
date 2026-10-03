import React from "react";
import { CsvImportSection } from "../import/CsvImportSection.js";
import { ImportHistorySection } from "../import/ImportHistorySection.js";
import { ManualEntrySection } from "../import/ManualEntrySection.js";
import { PdfImportSection } from "../import/PdfImportSection.js";

type ImportFormat = "csv" | "pdf" | "manual";

const importFormats: Array<{ id: ImportFormat; label: string; description: string }> = [
  { id: "csv", label: "CSV statement", description: "Map bank-export columns and review rows." },
  { id: "pdf", label: "Digital PDF", description: "Check a supported text statement." },
  { id: "manual", label: "Manual transaction", description: "Add one transaction to an account." },
];

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

  function selectFormat(format: ImportFormat): void {
    setSelectedFormat(format);
    setVisitedFormats((visited) => new Set(visited).add(format));
  }

  return (
    <section className="destination-workspace" aria-label="Import workspace" hidden={!isActive}>
      <div className="destination-heading">
        <h2>Import</h2>
        <p>Choose what you want to add. Statement rows are checked before anything is saved.</p>
      </div>
      <div className="import-format-picker">
        <fieldset aria-label="Choose import format">
          <legend>Choose import format</legend>
          <div className="import-format-options">
            {importFormats.map((format) => (
              <button
                key={format.id}
                type="button"
                className={`import-format-choice${selectedFormat === format.id ? " is-selected" : ""}`}
                aria-label={format.label}
                aria-describedby={`import-format-${format.id}-description`}
                aria-pressed={selectedFormat === format.id}
                onClick={() => selectFormat(format.id)}
              >
                <span>{format.label}</span>
                <small id={`import-format-${format.id}-description`}>{format.description}</small>
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      {visitedFormats.has("csv") && (
        <div className="import-format-content" hidden={selectedFormat !== "csv"}>
          <CsvImportSection
            onImportSuccess={onImportSuccess}
            onOpenLedger={onOpenLedger}
            onReviewUncategorized={onReviewUncategorized}
          />
        </div>
      )}
      {visitedFormats.has("pdf") && (
        <div className="import-format-content" hidden={selectedFormat !== "pdf"}>
          <PdfImportSection
            onImportSuccess={onImportSuccess}
            onOpenLedger={onOpenLedger}
            onReviewUncategorized={onReviewUncategorized}
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
      <ImportHistorySection refreshKey={refreshKey} onUndoSuccess={onImportSuccess} />
    </section>
  );
}