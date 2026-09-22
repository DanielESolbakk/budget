import React from "react";

type ExportState =
  | { status: "idle" }
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
    setExportState({ status: "pending" });

    try {
      const selectedPath = outputPath.trim() || (await chooseOutputPath());
      if (!selectedPath) {
        setExportState({ status: "cancelled" });
        return;
      }

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
    try {
      await chooseOutputPath();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to choose an export path.";
      setExportState({ status: "error", message });
    }
  }

  return (
    <section aria-label="Export">
      <h2>Export Ledger</h2>
      <label htmlFor="export-output-path">CSV output path</label>
      <input
        id="export-output-path"
        type="text"
        value={outputPath}
        onChange={(event) => setOutputPath(event.target.value)}
        placeholder="Choose a CSV destination"
        disabled={exportState.status === "pending"}
      />
      <div className="action-row">
        <button type="button" onClick={handleBrowse} disabled={exportState.status === "pending"}>
          Browse
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exportState.status === "pending"}
        >
          {exportState.status === "pending" ? "Exporting..." : "Export CSV"}
        </button>
      </div>
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