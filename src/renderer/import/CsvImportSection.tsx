import React from "react";
import type { CsvImportResponse } from "../../app/import/importCsv.js";

type ImportState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; importJobId: string; transactionCount: number }
  | { status: "error"; message: string }
  | { status: "validation"; errors: CsvImportResponse & { ok: false } };

interface CsvImportSectionProps {
  onImportSuccess: () => void;
}

export function CsvImportSection({ onImportSuccess }: CsvImportSectionProps): React.JSX.Element {
  const [filePath, setFilePath] = React.useState("");
  const [importState, setImportState] = React.useState<ImportState>({ status: "idle" });

  function handleImport(): void {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) return;

    setImportState({ status: "pending" });

    window.budgetApi.import
      .importCsv(trimmedPath)
      .then((response) => {
        if (response.ok) {
          setImportState({
            status: "success",
            importJobId: response.importJobId,
            transactionCount: response.transactionCount,
          });
          onImportSuccess();
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
    <section aria-label="CSV Import">
      <h2>Import CSV</h2>
      <label htmlFor="csv-file-path">CSV file path</label>
      <input
        id="csv-file-path"
        type="text"
        value={filePath}
        onChange={(e) => setFilePath(e.target.value)}
        placeholder="/path/to/statement.csv"
        disabled={importState.status === "pending"}
      />
      <button
        onClick={handleImport}
        disabled={importState.status === "pending" || !filePath.trim()}
      >
        Import CSV
      </button>
      {importState.status === "pending" && <p>Importing...</p>}
      {importState.status === "success" && (
        <p role="status">
          Import complete: {importState.transactionCount} transactions imported (job{" "}
          {importState.importJobId}).
        </p>
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
                Row {e.rowIndex + 1}: {e.messages.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
