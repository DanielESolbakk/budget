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

/**
 * Parses a semicolon-delimited CSV text string into an array of row objects.
 *
 * Supports the Norwegian bank CSV export format with a semicolon delimiter.
 * Handles quoted delimiters and multiline fields, and ignores empty lines.
 */
export function parseCsvText(text: string): Array<Record<string, string>> {
  if (text.trim().length === 0) {
    return [];
  }

  const records = parse(text, {
    bom: true,
    columns: true,
    delimiter: ";",
    skip_empty_lines: true,
  }) as Array<Record<string, string>>;

  return records.filter((record) => {
    const summaryLabel = (record["Utført dato"] ?? "").trim().replace(/\s+/g, " ");
    return Object.values(record).some((value) => value.trim().length > 0) &&
      !ROGALAND_SUMMARY_PREFIXES.some((prefix) => summaryLabel.startsWith(prefix));
  });
}
