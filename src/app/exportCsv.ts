import { writeFileSync } from "node:fs";
import type { LedgerSnapshotData } from "../domain/backup/snapshotContract.js";
import type { Transaction } from "../domain/types.js";
import { buildCsvOutput } from "../domain/export/buildCsvRows.js";

export interface ExportCsvInput {
  /** Transactions to export. The array is sorted by bookedAtIso ascending before serialization. */
  transactions: Transaction[];
}

export interface ExportCsvOutput {
  /** Complete CSV text including header and trailing newline. */
  csvText: string;
  /** Number of data rows written (excluding the header). */
  rowCount: number;
}

export interface ExportCsvToFileInput extends ExportCsvInput {
  /** Absolute or repository-relative destination path for the CSV output file. */
  outputPath: string;
  /** Optional test seam to override file writing behavior. */
  writeFile?: (path: string, data: string) => void;
}

export interface ExportCsvFileOutput extends ExportCsvOutput {
  /** Destination path where the CSV output was written. */
  outputPath: string;
}

export interface ExportCsvSummary {
  /** Number of data rows written (excluding the header). */
  rowCount: number;
  /** Destination path where the CSV output was written. */
  outputPath: string;
}

export interface LedgerExportSource {
  loadLedgerSnapshotData: () => Pick<LedgerSnapshotData, "transactions">;
}

export type ExportLedgerCsvToFileInput = Omit<ExportCsvToFileInput, "transactions"> & {
  ledger: LedgerExportSource;
};

/**
 * Orchestrates CSV export from a transaction list.
 * Transactions are sorted by bookedAtIso ascending to produce deterministic output
 * regardless of the order they arrive from the caller.
 */
export function exportCsv(input: ExportCsvInput): ExportCsvOutput {
  const sorted = [...input.transactions].sort((a, b) =>
    a.bookedAtIso < b.bookedAtIso ? -1 : a.bookedAtIso > b.bookedAtIso ? 1 : 0
  );
  const csvText = buildCsvOutput(sorted);
  return { csvText, rowCount: sorted.length };
}

export function exportCsvToFile(input: ExportCsvToFileInput): ExportCsvFileOutput {
  const { csvText, rowCount } = exportCsv({ transactions: input.transactions });
  const write = input.writeFile ?? ((path: string, data: string) => writeFileSync(path, data, "utf8"));
  write(input.outputPath, csvText);
  return { csvText, rowCount, outputPath: input.outputPath };
}

export function exportLedgerCsvToFile(input: ExportLedgerCsvToFileInput): ExportCsvFileOutput {
  const transactions = input.ledger.loadLedgerSnapshotData().transactions;

  if (input.writeFile === undefined) {
    return exportCsvToFile({
      transactions,
      outputPath: input.outputPath,
    });
  }

  return exportCsvToFile({
    transactions,
    outputPath: input.outputPath,
    writeFile: input.writeFile,
  });
}
