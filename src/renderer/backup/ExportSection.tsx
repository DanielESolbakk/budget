import React from "react";

type ExportState =
  | { status: "idle" }
  | { status: "choosing" }
  | { status: "pending" }
  | { status: "cancelled" }
  | { status: "success"; outputPath: string; transactionCount: number }
  | { status: "error"; message: string };

export function ExportSection(): React.JSX.Element {
  const [outputPath, setOutputPath] = React.useState("");
  const [exportState, setExportState] = React.useState<ExportState>({ status: "idle" });

  async function chooseOutputPath(): Promise<string | null> {
    const selectedPath = await window.budgetApi.dialogs.chooseCsvExportPath();
    if (selectedPath !== null) {
      setOutputPath(selectedPath);
    }
    return selectedPath;
  }

  async function handleExport(): Promise<void> {
    const selectedPath = outputPath.trim();
    if (!selectedPath) return;

    setExportState({ status: "pending" });

    try {
      const result = await window.budgetApi.export.writeLedgerCsv(selectedPath);
      setExportState({
        status: "success",
        outputPath: result.outputPath,
        transactionCount: result.rowCount,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown export error.";
      setExportState({ status: "error", message });
    }
  }

  async function handleBrowse(): Promise<void> {
    setExportState({ status: "choosing" });

    try {
      const selectedPath = await chooseOutputPath();
      setExportState(selectedPath ? { status: "idle" } : { status: "cancelled" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to choose an export path.";
      setExportState({ status: "error", message });
    }
  }

  return (
    <section aria-label="Export">
      <h2>Export Ledger</h2>
      <label htmlFor="export-output-path">Destination path</label>
      <input
        id="export-output-path"
        type="text"
        value={outputPath}
        onChange={(event) => {
          setOutputPath(event.target.value);
          setExportState({ status: "idle" });
        }}
        placeholder="Choose a CSV destination"
        disabled={exportState.status === "pending" || exportState.status === "choosing"}
      />
      <p id="export-output-help" className="field-help">
        Choose or enter a destination before exporting.
      </p>
      <div className="action-row">
        <button
          type="button"
          className="action-secondary"
          onClick={() => void handleBrowse()}
          disabled={exportState.status === "pending" || exportState.status === "choosing"}
        >
          {exportState.status === "choosing" ? "Choosing destination..." : "Choose destination"}
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={!outputPath.trim() || exportState.status === "pending" || exportState.status === "choosing"}
          aria-describedby="export-output-help"
        >
          {exportState.status === "pending" ? "Exporting..." : "Export CSV"}
        </button>
      </div>
      {exportState.status === "choosing" && <p role="status" aria-live="polite">Choosing CSV destination...</p>}
      {exportState.status === "pending" && <p role="status" aria-live="polite">Exporting ledger...</p>}
      {exportState.status === "cancelled" && <p role="status">Export cancelled.</p>}
      {exportState.status === "success" && (
        <p role="status">
          Export saved to {exportState.outputPath} ({exportState.transactionCount} transactions).
        </p>
      )}
      {exportState.status === "error" && <p role="alert">Export failed: {exportState.message}</p>}
    </section>
  );
}