import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { previewCsvRowsWithProgress } from "../../src/app/import/importCsv.js";
import { decodeCsvBytes, parseRogalandCsvText } from "../../src/domain/import/parseCsvText.js";

const CSV_FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-upload-shape.csv.gz.base64";

describe("sanitized CSV upload-shape fixture", () => {
  it("preserves the real CSV structure and maps every eligible row", async () => {
    const compressedFixture = Buffer.from(readFileSync(CSV_FIXTURE_PATH, "utf8").replace(/\\s+/g, ""), "base64");
    const fixtureText = gunzipSync(compressedFixture).toString("utf8");
    const bytes = Buffer.from(fixtureText, "latin1");
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    expect(() => utf8Decoder.decode(bytes)).toThrow();

    const text = decodeCsvBytes(bytes);
    const records = parse(text, {
      bom: true,
      delimiter: ";",
      relax_column_count: true,
      skip_empty_lines: true,
    }) as string[][];
    const dataRows = records.slice(1);

    expect(records[0]).toEqual([
      "Utført dato",
      "Bokført dato",
      "Rentedato",
      "Beskrivelse",
      "Type",
      "Undertype",
      "Fra konto",
      "Avsender",
      "Til konto",
      "Mottakernavn",
      "Beløp inn",
      "Beløp ut",
      "Valuta",
      "Status",
      "Melding/KID/Fakt.nr",
    ]);
    expect(dataRows).toHaveLength(784);
    expect(dataRows.every((row) => row.length === 15)).toBe(true);
    expect(dataRows.filter((row) => row.some((cell) => /[\\r\\n]/.test(cell)))).toHaveLength(22);
    expect([...bytes.toString("latin1")].filter((character) => character === "\\\"")).toHaveLength(44);
    expect((fixtureText.match(/\\r\\n/g) ?? [])).toHaveLength(0);
    expect((fixtureText.match(/\\n/g) ?? []).length).toBe(807);

    const rows = parseRogalandCsvText(text);
    expect(rows).toHaveLength(776);
    const preview = await previewCsvRowsWithProgress(rows, {
      householdId: "fixture-household",
      accountId: "fixture-account",
      sourceIdentity: "sanitized-csv-fixture",
      sourceScope: "sanitized-csv-fixture.csv",
    }, {
      isCancelled: () => false,
      onProgress: () => undefined,
      batchSize: 100,
    });

    expect(preview).not.toBeNull();
    if (preview === null) return;
    expect(preview.rows).toHaveLength(776);
    expect(preview.transactions).toHaveLength(776);
    expect(preview.rows.every((row) => row.errors.length === 0)).toBe(true);
    expect(preview.transactions.every((transaction) =>
      transaction.sourceType === "csv" && Number.isInteger(transaction.amountMinor) &&
      /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/.test(transaction.bookedAtIso)
    )).toBe(true);
    expect(preview.transactions.some((transaction) => transaction.amountMinor > 0)).toBe(true);
    expect(preview.transactions.some((transaction) => transaction.amountMinor < 0)).toBe(true);
  });
});
