/**
 * Parses a semicolon-delimited CSV text string into an array of row objects.
 *
 * Supports the Norwegian bank CSV export format with a semicolon delimiter.
 * Strips the optional UTF-8 BOM and ignores empty lines.
 */
export function parseCsvText(text: string): Array<Record<string, string>> {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  const lines = normalized.split(/\r?\n/).filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const header = lines[0]!.split(";");

  return lines.slice(1).map((line) => {
    const cells = line.split(";");
    const record: Record<string, string> = {};

    header.forEach((columnName, index) => {
      record[columnName] = cells[index] ?? "";
    });

    return record;
  });
}
