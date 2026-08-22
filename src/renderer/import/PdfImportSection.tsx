import React from "react";
import type { PdfImportResponse } from "../../app/import/importPdf.js";

type ImportState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; importJobId: string; transactionCount: number; adapterId: string }
  | { status: "error"; message: string }
  | { status: "validation"; errors: PdfImportResponse & { ok: false } };

interface PdfImportSectionProps {
  onImportSuccess: () => void;
}

export function PdfImportSection({ onImportSuccess }: PdfImportSectionProps): React.JSX.Element {
  const [filePath, setFilePath] = React.useState("");
  const [importState, setImportState] = React.useState<ImportState>({ status: "idle" });

  function handleImport(): void {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) return;

    setImportState({ status: "pending" });

    window.budgetApi.import
      .importPdf({ filePath: trimmedPath })
      .then((response) => {
        if (response.ok) {
          setImportState({
            status: "success",
            importJobId: response.importJobId,
            transactionCount: response.transactionCount,
            adapterId: response.adapterId,
          });
          setFilePath("");
          setTimeout(() => {
            onImportSuccess();
          }, 0);
        } else {
          setImportState({ status: "validation", errors: response });
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown import error.";
        setImportState({ status: "error", message });
      });
  }

  return (
    <section aria-label="PDF Import">
      <h2>Import PDF Statement</h2>
      <label htmlFor="pdf-file-path">PDF text file path</label>
      <input
        id="pdf-file-path"
        type="text"
        value={filePath}
        onChange={(e) => setFilePath(e.target.value)}
        placeholder="/path/to/statement.txt"
        disabled={importState.status === "pending"}
      />
      <button
        onClick={handleImport}
        disabled={importState.status === "pending" || !filePath.trim()}
      >
        Import PDF
      </button>
      {importState.status === "pending" && <p>Importing...</p>}
      {importState.status === "success" && (
        <p role="status">
          Import complete: {importState.transactionCount} transactions imported (job{" "}
          {importState.importJobId}, adapter {importState.adapterId}).
        </p>
      )}
      {importState.status === "error" && (
        <p role="alert">Import failed: {importState.message}</p>
      )}
      {importState.status === "validation" && (
        <div role="alert">
          <p>Import validation failed:</p>
          <ul>
            {importState.errors.errors.map((e, i) => (
              <li key={i}>
                {e.code}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
