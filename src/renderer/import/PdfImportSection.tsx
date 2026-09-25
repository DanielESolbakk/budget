import React from "react";
import type {
  PdfImportPreviewSuccess,
  PdfImportResponse,
} from "../../app/import/importPdf.js";

type ImportState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; importJobId: string; transactionCount: number; duplicateCount: number; adapterId: string }
  | { status: "error"; message: string }
  | { status: "validation"; errors: PdfImportResponse & { ok: false } };

const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAmount(amountMinor: number): string {
  return nokCurrencyFormatter.format(amountMinor / 100);
}

interface PdfImportSectionProps {
  onImportSuccess: () => void;
}

export function PdfImportSection({ onImportSuccess }: PdfImportSectionProps): React.JSX.Element {
  const [filePath, setFilePath] = React.useState("");
  const [importState, setImportState] = React.useState<ImportState>({ status: "idle" });
  const [preview, setPreview] = React.useState<PdfImportPreviewSuccess | null>(null);

  function handlePreview(): void {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) return;

    setImportState({ status: "pending" });
    window.budgetApi.import
      .previewPdf({ filePath: trimmedPath })
      .then((response) => {
        if (response.ok) {
          setPreview(response);
          setImportState({ status: "idle" });
        } else {
          setPreview(null);
          setImportState({ status: "validation", errors: response });
        }
      })
      .catch((error: unknown) => {
        setPreview(null);
        setImportState({
          status: "error",
          message: error instanceof Error ? error.message : "Unknown preview error.",
        });
      });
  }

  function handleImport(): void {
    const trimmedPath = filePath.trim();
    if (!trimmedPath || preview === null) return;

    setImportState({ status: "pending" });

    window.budgetApi.import
      .importPdf({ filePath: trimmedPath, previewId: preview.previewId })
      .then((response) => {
        if (response.ok) {
          setImportState({
            status: "success",
            importJobId: response.importJobId,
            transactionCount: response.transactionCount,
            duplicateCount: response.duplicateCount,
            adapterId: response.adapterId,
          });
          setFilePath("");
          setPreview(null);
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
      <p className="section-intro">Use this for a digital bank statement ending in <strong>.pdf</strong>. Scanned image statements are not supported yet.</p>
      <label htmlFor="pdf-file-path">PDF statement path</label>
      <input
        id="pdf-file-path"
        type="text"
        value={filePath}
        onChange={(e) => {
          setFilePath(e.target.value);
          setPreview(null);
          setImportState({ status: "idle" });
        }}
        placeholder="/path/to/statement.pdf"
        disabled={importState.status === "pending"}
      />
      <button
        type="button"
        onClick={handlePreview}
        disabled={importState.status === "pending" || !filePath.trim()}
      >
        Preview PDF
      </button>
      <button
        type="button"
        onClick={handleImport}
        disabled={importState.status === "pending" || preview === null}
      >
        Confirm PDF import
      </button>
      {importState.status === "pending" && <p role="status">Checking the file...</p>}
      {importState.status === "success" && (
        <p role="status">
          Added {importState.transactionCount} transaction{importState.transactionCount === 1 ? "" : "s"} to your ledger. {importState.duplicateCount > 0 ? `${importState.duplicateCount} duplicate${importState.duplicateCount === 1 ? "" : "s"} skipped.` : "No duplicates found."}
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
      {preview !== null && (
        <section aria-label="PDF import preview">
          <h3>PDF import preview</h3>
          <p className="preview-summary">
            <strong>{preview.transactions.length} transaction{preview.transactions.length === 1 ? "" : "s"} ready.</strong>{" "}
            Review the rows below before confirming the import.
          </p>
          <p>Statement format recognized: {preview.adapterId === "rogaland-sparebank-text-v1" ? "Rogaland Sparebank digital statement" : "supported bank statement"}.</p>
          <div className="preview-table-wrap">
            <table className="import-preview-table">
              <caption>Transactions ready from this PDF preview</caption>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Merchant</th><th scope="col">Amount</th><th scope="col">Currency</th></tr>
              </thead>
              <tbody>
                {preview.transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td data-label="Date">{transaction.bookedAtIso.slice(0, 10)}</td>
                    <td data-label="Merchant">{transaction.merchantRaw}</td>
                    <td data-label="Amount">{formatAmount(transaction.amountMinor)}</td>
                    <td data-label="Currency">{transaction.currencyCode ?? "NOK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
