import React from "react";
import { CsvImportSection } from "../import/CsvImportSection.js";
import { ManualEntrySection } from "../import/ManualEntrySection.js";
import { PdfImportSection } from "../import/PdfImportSection.js";

interface ImportWorkspaceProps {
  isActive: boolean;
  onImportSuccess: () => void;
}

export function ImportWorkspace({ isActive, onImportSuccess }: ImportWorkspaceProps): React.JSX.Element {
  return (
    <section className="destination-workspace" aria-label="Import workspace" hidden={!isActive}>
      <div className="destination-heading">
        <h2>Import</h2>
        <p>Add one transaction or preview a statement before anything is saved.</p>
      </div>
      <div className="workflow-import-grid">
        <ManualEntrySection onEntrySuccess={onImportSuccess} />
        <CsvImportSection onImportSuccess={onImportSuccess} />
        <PdfImportSection onImportSuccess={onImportSuccess} />
      </div>
    </section>
  );
}