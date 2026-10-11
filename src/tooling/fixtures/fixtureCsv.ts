import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

export interface ParsedFixtureCsv {
  header: string[];
  rows: string[][];
}

const summaryRowPrefixes = [
  "Total beløp inn på konto:",
  "Totalt beløp ut av konto:",
  "Inngående saldo pr.",
  "Utgående saldo pr.",
];

export function parseFixtureCsv(text: string): ParsedFixtureCsv {
  const normalizedText = text.replace(/^\uFEFF/, "").trim();

  if (normalizedText.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const records = parse(normalizedText, {
    bom: true,
    delimiter: ";",
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][];
  const header = records[0] ?? [];
  const rows = records.slice(1).flatMap((cells, index) => {
    const rowLabel = (cells[0] ?? "").trim().replace(/\s+/g, " ");
    const isEmptyRow = cells.every((cell) => cell.trim().length === 0);
    const isSummaryRow = summaryRowPrefixes.some((prefix) => rowLabel.startsWith(prefix));

    if (isEmptyRow || isSummaryRow) {
      return [];
    }

    if (cells.length !== header.length) {
      throw new Error(
        `Row ${index + 2} has ${cells.length} cells, expected ${header.length}.`
      );
    }
    return [cells];
  });

  return { header, rows };
}

export function stringifyFixtureCsv(parsed: ParsedFixtureCsv): string {
  const lines = [parsed.header.join(";")];

  for (const row of parsed.rows) {
    lines.push(row.join(";"));
  }

  return `${lines.join("\n")}\n`;
}

export function readFixtureCsv(filePath: string): ParsedFixtureCsv {
  return parseFixtureCsv(readFileSync(filePath, "utf8"));
}

export function writeFixtureCsv(filePath: string, parsed: ParsedFixtureCsv): void {
  writeFileSync(filePath, stringifyFixtureCsv(parsed), "utf8");
}

export function rowsToObjects(parsed: ParsedFixtureCsv): Array<Record<string, string>> {
  return parsed.rows.map((row) => {
    const record: Record<string, string> = {};

    parsed.header.forEach((columnName, index) => {
      record[columnName] = row[index] ?? "";
    });

    return record;
  });
}
