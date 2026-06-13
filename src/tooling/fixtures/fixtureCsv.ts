import { readFileSync, writeFileSync } from "node:fs";

export interface ParsedFixtureCsv {
  header: string[];
  rows: string[][];
}

export function parseFixtureCsv(text: string): ParsedFixtureCsv {
  const normalizedText = text.replace(/^\uFEFF/, "").trim();
  const lines = normalizedText.split(/\r?\n/).filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const header = lines[0]!.split(";");
  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split(";");
    if (cells.length !== header.length) {
      throw new Error(
        `Row ${index + 2} has ${cells.length} cells, expected ${header.length}.`
      );
    }
    return cells;
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