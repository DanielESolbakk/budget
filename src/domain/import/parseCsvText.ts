import { parse } from "csv-parse/sync";

const ROGALAND_SUMMARY_PREFIXES = [
  "Total beløp inn på konto:",
  "Totalt beløp ut av konto:",
  "Inngående saldo pr.",
  "Utgående saldo pr.",
];

export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Parses semicolon-delimited CSV text without applying bank-specific row rules. */
export function parseCsvText(text: string): Array<Record<string, string>> {
  return parseCsvTextWithSummaryPrefixes(text, []);
}

/** Parses the Rogaland export format and excludes its recognized balance-summary rows. */
export function parseRogalandCsvText(text: string): Array<Record<string, string>> {
  return parseCsvTextWithSummaryPrefixes(text, ROGALAND_SUMMARY_PREFIXES);
}

function parseCsvTextWithSummaryPrefixes(
  text: string,
  summaryRowPrefixes: readonly string[]
): Array<Record<string, string>> {
  if (text.trim().length === 0) {
    return [];
  }

  const records = parse(text, {
    bom: true,
    delimiter: ";",
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][];
  const header = records[0] ?? [];

  return records.slice(1).flatMap((cells, index) => {
    const record: Record<string, string> = {};
    header.forEach((columnName, columnIndex) => {
      record[columnName] = cells[columnIndex] ?? "";
    });

    const summaryLabel = (record["Utført dato"] ?? "").trim().replace(/\s+/g, " ");
    const isEmptyRow = cells.every((cell) => cell.trim().length === 0);
    const isSummaryRow = summaryRowPrefixes.some((prefix) => summaryLabel.startsWith(prefix));
    if (isEmptyRow || isSummaryRow) return [];

    if (cells.length !== header.length) {
      record.__csvRowShapeError = `Row ${index + 2} has ${cells.length} cells, expected ${header.length}.`;
    }

    return [record];
  });
}
