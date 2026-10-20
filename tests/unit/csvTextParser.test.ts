import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapCsvRows, previewCsvRows } from "../../src/domain/import/csvRowMapper.js";
import {
  decodeCsvBytes,
  parseCsvText,
  parseRogalandCsvText,
} from "../../src/domain/import/parseCsvText.js";

describe("parseCsvText", () => {
  it("preserves delimiters, escaped quotes, and line breaks inside quoted cells", () => {
    const csvText = [
      "Utført dato;Bokført dato;Beskrivelse;Beløp ut;Valuta;Melding/KID/Fakt.nr",
      '28.05.2026;28.05.2026;"SYNTHETIC; ""WEST"" SHOP',
      'SECOND LINE";-12.50;NOK;REF-001',
    ].join("\n");
    const rows = parseCsvText(csvText);

    expect(rows).toHaveLength(1);
    expect(rows).toEqual([
      {
        "Utført dato": "28.05.2026",
        "Bokført dato": "28.05.2026",
        Beskrivelse: 'SYNTHETIC; "WEST" SHOP\nSECOND LINE',
        "Beløp ut": "-12.50",
        Valuta: "NOK",
        "Melding/KID/Fakt.nr": "REF-001",
      },
    ]);

    const mapped = mapCsvRows(rows, {
      householdId: "hh-quoted",
      accountId: "acc-quoted",
    });

    expect(mapped.skipped).toEqual([]);
    expect(mapped.transactions).toHaveLength(1);
    expect(mapped.transactions.map(({ householdId, accountId, bookedAtIso, amountMinor, merchantRaw, sourceReference, sourceType }) => ({
      householdId,
      accountId,
      bookedAtIso,
      amountMinor,
      merchantRaw,
      sourceReference,
      sourceType,
    }))).toEqual([
      {
        householdId: "hh-quoted",
        accountId: "acc-quoted",
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -1250,
        merchantRaw: 'SYNTHETIC; "WEST" SHOP\nSECOND LINE',
        sourceReference: "REF-001",
        sourceType: "csv",
      },
    ]);
  });

  it("keeps valid rows previewable when other rows have inconsistent cell counts", () => {
    const csvText = [
      "Utført dato;Beskrivelse;Beløp ut;Valuta",
      "28.05.2026;SYNTHETIC VALID;-10.00;NOK",
      "29.05.2026;SYNTHETIC SHORT",
      "27.05.2026;SYNTHETIC EXTRA;-5.00;NOK;UNEXPECTED",
    ].join("\n");

    const preview = previewCsvRows(parseCsvText(csvText), {
      householdId: "hh-fixture",
      accountId: "acc-fixture",
    });

    expect(preview.rows).toHaveLength(3);
    expect(preview.rows[0]?.transaction).toMatchObject({
      merchantRaw: "SYNTHETIC VALID",
      amountMinor: -1000,
    });
    expect(preview.rows[1]?.errors).toEqual([
      {
        code: "INVALID_ROW_SHAPE",
        message: "Row 3 has 2 cells, expected 4.",
        field: "row",
      },
    ]);
    expect(preview.rows[2]?.errors).toEqual([
      {
        code: "INVALID_ROW_SHAPE",
        message: "Row 4 has 5 cells, expected 4.",
        field: "row",
      },
    ]);
    expect(preview.transactions).toHaveLength(1);
  });

  it("decodes legacy Windows-1252 bytes without corrupting Norwegian characters", () => {
    const legacyEncodedMerchant = Uint8Array.from([
      0x56, 0xe5, 0x67, 0x73, 0x67, 0x61, 0x74, 0x61,
    ]);

    expect(decodeCsvBytes(legacyEncodedMerchant)).toBe("Vågsgata");
  });

  it("decodes UTF-8 BOM text without leaving the BOM in the header", () => {
    const utf8BomText = Uint8Array.from([0xef, 0xbb, 0xbf, 0x41, 0x42, 0x43]);

    expect(decodeCsvBytes(utf8BomText)).toBe("ABC");
  });

  it("excludes bank balance summary rows while preserving transaction statuses", () => {
    const csvText = [
      "Utført dato;Bokført dato;Rentedato;Beskrivelse;Type;Undertype;Fra konto;Avsender;Til konto;Mottakernavn;Beløp inn;Beløp ut;Valuta;Status;Melding/KID/Fakt.nr",
      "29.05.2026;;29.05.2026;SYNTHETIC PENDING SHOP;Varekjøp;;ACCT-001;;;;0.00;-10.00;NOK;Reservert;REF-001",
      "28.05.2026;28.05.2026;28.05.2026;SYNTHETIC BOOKED SHOP;Varekjøp;;ACCT-001;;;;0.00;-20.00;NOK;Bokført;REF-002",
      "Total beløp inn på konto:;;123,45 NOK;;;;;;;;;;;;",
      "Totalt beløp ut av konto:;;-123,45 NOK;;;;;;;;;;;;",
    ].join("\n");

    const rows = parseRogalandCsvText(csvText);

    expect(rows.map((row) => row["Beskrivelse"])).toEqual([
      "SYNTHETIC PENDING SHOP",
      "SYNTHETIC BOOKED SHOP",
    ]);
    expect(rows.map((row) => row["Status"])).toEqual(["Reservert", "Bokført"]);
  });

  it("leaves bank-specific footer filtering out of the generic CSV parser", () => {
    const csvText = [
      "Utført dato;Beskrivelse;Beløp inn",
      "Total beløp inn på konto:;SYNTHETIC IMPORT NOTE;10.00",
    ].join("\n");

    expect(parseCsvText(csvText)).toEqual([
      {
        "Utført dato": "Total beløp inn på konto:",
        Beskrivelse: "SYNTHETIC IMPORT NOTE",
        "Beløp inn": "10.00",
      },
    ]);
  });

  it("ignores delimiter-only separator rows", () => {
    const csvText = [
      "Bokført dato;Beskrivelse;Beløp ut",
      "28.05.2026;SYNTHETIC SHOP;-10.00",
      ";;",
    ].join("\n");

    expect(parseCsvText(csvText)).toEqual([
      { "Bokført dato": "28.05.2026", Beskrivelse: "SYNTHETIC SHOP", "Beløp ut": "-10.00" },
    ]);
  });

  it("ignores the ending-balance footer when its label has extra whitespace", () => {
    const csvText = [
      "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Status",
      "28.05.2026;28.05.2026;SYNTHETIC SHOP;;-10.00;Bokført",
      "Utgående  saldo pr. 29.05.2026:;;108 991,81 NOK;;;",
    ].join("\n");

    expect(parseRogalandCsvText(csvText)).toEqual([
      {
        "Utført dato": "28.05.2026",
        "Bokført dato": "28.05.2026",
        Beskrivelse: "SYNTHETIC SHOP",
        "Beløp inn": "",
        "Beløp ut": "-10.00",
        Status: "Bokført",
      },
    ]);
  });

  it("parses the sanitized bank export fixture without converting summary rows to transactions", () => {
    const fixture = readFileSync(
      "tests/fixtures/synthetic/rogaland-2026-05-export-edge-cases.csv",
      "utf8"
    );

    const rows = parseRogalandCsvText(fixture);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row["Status"])).toEqual(["Reservert", "Bokført"]);
    expect(rows[1]?.["Beskrivelse"]).toBe('SYNTHETIC SHOP; "WEST" WING');
    expect(rows[1]?.["Melding/KID/Fakt.nr"]?.replace(/\r\n/g, "\n")).toBe(
      "REF-001; FIRST LINE\nSECOND LINE"
    );
  });

  it("maps the sanitized bank export fixture transaction rows into ledger candidates", () => {
    const fixture = readFileSync(
      "tests/fixtures/synthetic/rogaland-2026-05-export-edge-cases.csv",
      "utf8"
    );
    const result = mapCsvRows(parseRogalandCsvText(fixture), {
      householdId: "hh-fixture",
      accountId: "acc-fixture",
    });

    expect(result.skipped).toEqual([]);
    expect(result.transactions).toMatchObject([
      {
        bookedAtIso: "2026-05-29T00:00:00Z",
        amountMinor: -4500,
        merchantRaw: "SYNTHETIC MARKET 7",
      },
      {
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -9770,
        merchantRaw: 'SYNTHETIC SHOP; "WEST" WING',
      },
    ]);
  });
});