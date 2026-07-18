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
