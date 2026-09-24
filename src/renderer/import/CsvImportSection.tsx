import React from "react";
import type {
  CsvImportPreviewSuccess,
  CsvImportResponse,
} from "../../app/import/importCsv.js";
import type { CsvColumnKey, CsvColumnMapping } from "../../domain/import/csvRowMapper.js";

type ImportState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; importJobId: string; transactionCount: number; duplicateCount: number }
  | { status: "error"; message: string }
  | { status: "validation"; errors: CsvImportResponse & { ok: false } };

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
}

export function CsvImportSection({ onImportSuccess }: CsvImportSectionProps): React.JSX.Element {
  const [filePath, setFilePath] = React.useState("");
  const [importState, setImportState] = React.useState<ImportState>({ status: "idle" });
  const [preview, setPreview] = React.useState<CsvImportPreviewSuccess | null>(null);
  const [columnMapping, setColumnMapping] = React.useState<CsvColumnMapping>({});
  const [previewMapping, setPreviewMapping] = React.useState<CsvColumnMapping | null>(null);
  const validPreviewRowCount = preview?.rows.filter((row) => row.transaction !== undefined).length ?? 0;
  const invalidPreviewRowCount = preview?.rows.length === undefined
    ? 0
    : preview.rows.length - validPreviewRowCount;

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

  function handlePreview(): void {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) return;

    setImportState({ status: "pending" });
    window.budgetApi.import
      .previewCsv({ filePath: trimmedPath, columnMapping })
      .then((response) => {
        if (response.ok) {
          setPreview(response);
          setPreviewMapping(columnMapping);
          setImportState({ status: "idle" });
        } else {
          setPreview(null);
          setPreviewMapping(null);
          setImportState({ status: "error", message: response.message });
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
    if (!trimmedPath || preview === null || previewMapping === null) return;
    if (JSON.stringify(previewMapping) !== JSON.stringify(columnMapping)) return;
    if (preview.rows.some((row) => row.errors.length > 0)) return;

    setImportState({ status: "pending" });

    window.budgetApi.import
      .importCsv({ filePath: trimmedPath, previewId: preview.previewId, columnMapping })
      .then((response) => {
        if (response.ok) {
          setImportState({
            status: "success",
            importJobId: response.importJobId,
            transactionCount: response.transactionCount,
            duplicateCount: response.duplicateCount,
          });
          setFilePath("");
          setPreview(null);
          setPreviewMapping(null);
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
    <section aria-label="CSV Import">
      <h2>Import CSV</h2>
      <p className="section-intro">Use this for a bank export ending in <strong>.csv</strong>. Preview it first; nothing is saved until you confirm.</p>
      <label htmlFor="csv-file-path">CSV file path</label>
      <input
        id="csv-file-path"
        type="text"
        value={filePath}
        onChange={(e) => {
          setFilePath(e.target.value);
          setPreview(null);
          setPreviewMapping(null);
          setColumnMapping({});
          setImportState({ status: "idle" });
        }}
        placeholder="/path/to/statement.csv"
        disabled={importState.status === "pending"}
      />
      <button
        type="button"
        onClick={handlePreview}
        disabled={importState.status === "pending" || !filePath.trim()}
      >
        Preview CSV
      </button>
      <button
        type="button"
        onClick={handleImport}
        disabled={
          importState.status === "pending" ||
          preview === null ||
          previewMapping === null ||
          JSON.stringify(previewMapping) !== JSON.stringify(columnMapping) ||
          preview.rows.some((row) => row.errors.length > 0)
        }
      >
        Confirm CSV import
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
          <p className="preview-summary">
            <strong>{validPreviewRowCount} of {preview.rows.length} rows ready.</strong>{" "}
            {invalidPreviewRowCount > 0
              ? `${invalidPreviewRowCount} row${invalidPreviewRowCount === 1 ? "" : "s"} need${invalidPreviewRowCount === 1 ? "s" : ""} attention before import.`
              : "Everything in this preview can be imported."}
          </p>
          {preview.rows.some((row) => row.errors.length > 0) && (
            <div role="alert">
              <p>Import validation failed during preview:</p>
              <ul>
                {preview.rows.flatMap((row) =>
                  row.errors.map((error) => (
                    <li key={`${row.rowIndex}-${error.code}`}>
                      Row {row.rowIndex + 1}: {error.message}
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
          <div className="preview-table-wrap">
            <table className="import-preview-table">
              <caption>Transactions ready from this CSV preview</caption>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Merchant</th><th scope="col">Amount</th><th scope="col">Currency</th></tr>
              </thead>
              <tbody>
                {preview.rows.flatMap((row) =>
                  row.transaction === undefined ? [] : [
                    <tr key={row.rowIndex}>
                      <td data-label="Date">{row.transaction.bookedAtIso.slice(0, 10)}</td>
                      <td data-label="Merchant">{row.transaction.merchantRaw}</td>
                      <td data-label="Amount">{formatAmount(row.transaction.amountMinor)}</td>
                      <td data-label="Currency">{row.transaction.currencyCode ?? "NOK"}</td>
                    </tr>,
                  ]
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
