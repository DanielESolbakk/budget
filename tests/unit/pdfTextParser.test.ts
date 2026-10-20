/**
 * Unit tests for the Rogaland Sparebank text PDF parser adapter.
 *
 * Covers AC-1 through AC-4 from issue #15:
 *   AC-1: Supported sanitized text-PDF fixture produces expected transaction candidates.
 *   AC-2: Parsing identical fixture content produces identical ordered candidates.
 *   AC-3: Missing required fields and unsupported layouts return explicit validation errors.
 *   AC-4: Source-aware adapter records adapter identity in results.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as pdfTextParser from "../../src/domain/import/pdfTextParser.js";
import {
  buildRogalandImportJobId,
  isRogalandStatementText,
  parseRogalandStatementText,
  ROGALAND_ADAPTER_ID,
} from "../../src/domain/import/pdfTextParser.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";
const PAGINATED_EXPORT_FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-paginated-export.txt";

const BASE_OPTIONS = {
  householdId: "hh-test",
  accountId: "acc-test",
};

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

describe("pdfTextParser unit tests", () => {
  it("reports progress while preserving global transaction order across batches", async () => {
    const parseInBatches = (pdfTextParser as unknown as {
      parseRogalandStatementTextInBatches?: (
        text: string,
        options: typeof BASE_OPTIONS,
        callbacks: {
          batchSize: number;
          isCancelled: () => boolean;
          onProgress: (completedRows: number, totalRows: number) => void;
        }
      ) => Promise<unknown>;
    }).parseRogalandStatementTextInBatches;
    const text = [
      "ROGALAND SPAREBANK",
      "Kontoopplysninger",
      "Dato         Beskrivelse                              Beløp          Saldo",
      "28.05.2026   FIRST SHOP                                -1,00         10,00",
      "30.05.2026   LATER SHOP                                -2,00         11,00",
      "29.05.2026   MIDDLE SHOP                               -3,00         13,00",
    ].join("\n");
    const progress: Array<[number, number]> = [];

    const result = await parseInBatches?.(text, BASE_OPTIONS, {
      batchSize: 1,
      isCancelled: () => false,
      onProgress: (completedRows, totalRows) => progress.push([completedRows, totalRows]),
    });

    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(result).toMatchObject({
      ok: true,
      transactions: [
        expect.objectContaining({ bookedAtIso: "2026-05-30T00:00:00Z", merchantRaw: "LATER SHOP" }),
        expect.objectContaining({ bookedAtIso: "2026-05-29T00:00:00Z", merchantRaw: "MIDDLE SHOP" }),
        expect.objectContaining({ bookedAtIso: "2026-05-28T00:00:00Z", merchantRaw: "FIRST SHOP" }),
      ],
    });
  });

  it.each([1, 5, 7])("preserves excluded-only page batches at batch size %i", async (batchSize) => {
    const tableHeader = "Dato       Type          Fra konto      Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr";
    const continuationColumn = tableHeader.indexOf("Melding/KID/Fakt.nr") - 8;
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 5",
      "Kontonummer: ACCT-001",
      tableHeader,
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -11,00 NOK Reservert SYNTHETIC RESERVED FIRST",
      "27.05.2026 Lønn ACCT-001 SYNTHETIC EMPLOYER 50 000,00 NOK Bokført Fra: SYNTHETIC PAYROLL",
      "1/2 Rogaland Sparebank",
      "Transaksjoner Antall: 5",
      "Kontonummer: ACCT-001",
      tableHeader,
      "30.05.2026 Betaling ACCT-001 LOCAL_USER -350,00 NOK Bekreftet SYNTHETIC CONFIRMED MIDDLE",
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -12,50 NOK Bokført SYNTHETIC FIRST",
      `${" ".repeat(continuationColumn)}WRAPPED   MESSAGE`,
      "2/2 Rogaland Sparebank",
      "Transaksjoner Antall: 5",
      "Kontonummer: ACCT-001",
      tableHeader,
      "26.05.2026 Varekjøp ACCT-001 LOCAL_USER -41,00 NOK Reservert SYNTHETIC RESERVED LAST",
      "3/3 Rogaland Sparebank",
    ].join("\n");
    const synchronous = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(synchronous.ok).toBe(true);
    if (!synchronous.ok) return;
    expect(synchronous).toEqual({
      ok: true,
      adapterId: ROGALAND_ADAPTER_ID,
      transactions: [
        {
          id: "pdf-1",
          householdId: "hh-test",
          accountId: "acc-test",
          bookedAtIso: "2026-05-28T00:00:00Z",
          amountMinor: -1250,
          merchantRaw: "SYNTHETIC FIRST WRAPPED MESSAGE",
          currencyCode: "NOK",
          sourceType: "pdf",
        },
        {
          id: "pdf-2",
          householdId: "hh-test",
          accountId: "acc-test",
          bookedAtIso: "2026-05-27T00:00:00Z",
          amountMinor: 5_000_000,
          merchantRaw: "Fra: SYNTHETIC PAYROLL",
          currencyCode: "NOK",
          sourceType: "pdf",
        },
      ],
      excludedRows: [
        {
          lineNumber: 5,
          status: "Reservert",
          date: "28.05.2026",
          amount: "-11,00",
          currencyCode: "NOK",
          description: "SYNTHETIC RESERVED FIRST",
        },
        {
          lineNumber: 11,
          status: "Bekreftet",
          date: "30.05.2026",
          amount: "-350,00",
          currencyCode: "NOK",
          description: "SYNTHETIC CONFIRMED MIDDLE",
        },
        {
          lineNumber: 18,
          status: "Reservert",
          date: "26.05.2026",
          amount: "-41,00",
          currencyCode: "NOK",
          description: "SYNTHETIC RESERVED LAST",
        },
      ],
    });

    const batched = await pdfTextParser.parseRogalandStatementTextInBatches(text, BASE_OPTIONS, {
      batchSize,
      isCancelled: () => false,
      onProgress: () => undefined,
    });

    expect(batched).toEqual(synchronous);
  });

  it("preserves a reserved transaction after ten booked rows in the production-sized batch", async () => {
    const tableHeader = "Dato       Type          Fra konto      Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr";
    const bookedRows = [
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -1,00 NOK Bokført SYNTHETIC BOOKED 01",
      "27.05.2026 Varekjøp ACCT-001 LOCAL_USER -2,00 NOK Bokført SYNTHETIC BOOKED 02",
      "26.05.2026 Varekjøp ACCT-001 LOCAL_USER -3,00 NOK Bokført SYNTHETIC BOOKED 03",
      "25.05.2026 Varekjøp ACCT-001 LOCAL_USER -4,00 NOK Bokført SYNTHETIC BOOKED 04",
      "24.05.2026 Varekjøp ACCT-001 LOCAL_USER -5,00 NOK Bokført SYNTHETIC BOOKED 05",
      "23.05.2026 Varekjøp ACCT-001 LOCAL_USER -6,00 NOK Bokført SYNTHETIC BOOKED 06",
      "22.05.2026 Varekjøp ACCT-001 LOCAL_USER -7,00 NOK Bokført SYNTHETIC BOOKED 07",
      "21.05.2026 Varekjøp ACCT-001 LOCAL_USER -8,00 NOK Bokført SYNTHETIC BOOKED 08",
      "20.05.2026 Varekjøp ACCT-001 LOCAL_USER -9,00 NOK Bokført SYNTHETIC BOOKED 09",
      "19.05.2026 Varekjøp ACCT-001 LOCAL_USER -10,00 NOK Bokført SYNTHETIC BOOKED 10",
      "18.05.2026 Varekjøp ACCT-001 LOCAL_USER -350,00 NOK Reservert SYNTHETIC RESERVED 11",
    ];
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 11",
      "Kontonummer: ACCT-001",
      tableHeader,
      ...bookedRows,
    ].join("\n");
    const progress: Array<[number, number]> = [];

    const result = await pdfTextParser.parseRogalandStatementTextInBatches(text, BASE_OPTIONS, {
      batchSize: 10,
      isCancelled: () => false,
      onProgress: (completedRows, totalRows) => progress.push([completedRows, totalRows]),
    });

    expect(result).toMatchObject({ ok: true, adapterId: ROGALAND_ADAPTER_ID });
    if (result === null || !result.ok) return;
    expect(result.transactions).toHaveLength(10);
    expect(result.transactions.map(({ bookedAtIso, amountMinor, merchantRaw }) => ({
      bookedAtIso,
      amountMinor,
      merchantRaw,
    }))).toEqual([
      { bookedAtIso: "2026-05-28T00:00:00Z", amountMinor: -100, merchantRaw: "SYNTHETIC BOOKED 01" },
      { bookedAtIso: "2026-05-27T00:00:00Z", amountMinor: -200, merchantRaw: "SYNTHETIC BOOKED 02" },
      { bookedAtIso: "2026-05-26T00:00:00Z", amountMinor: -300, merchantRaw: "SYNTHETIC BOOKED 03" },
      { bookedAtIso: "2026-05-25T00:00:00Z", amountMinor: -400, merchantRaw: "SYNTHETIC BOOKED 04" },
      { bookedAtIso: "2026-05-24T00:00:00Z", amountMinor: -500, merchantRaw: "SYNTHETIC BOOKED 05" },
      { bookedAtIso: "2026-05-23T00:00:00Z", amountMinor: -600, merchantRaw: "SYNTHETIC BOOKED 06" },
      { bookedAtIso: "2026-05-22T00:00:00Z", amountMinor: -700, merchantRaw: "SYNTHETIC BOOKED 07" },
      { bookedAtIso: "2026-05-21T00:00:00Z", amountMinor: -800, merchantRaw: "SYNTHETIC BOOKED 08" },
      { bookedAtIso: "2026-05-20T00:00:00Z", amountMinor: -900, merchantRaw: "SYNTHETIC BOOKED 09" },
      { bookedAtIso: "2026-05-19T00:00:00Z", amountMinor: -1000, merchantRaw: "SYNTHETIC BOOKED 10" },
    ]);
    expect(result.excludedRows).toEqual([
      {
        lineNumber: 15,
        status: "Reservert",
        date: "18.05.2026",
        amount: "-350,00",
        currencyCode: "NOK",
        description: "SYNTHETIC RESERVED 11",
      },
    ]);
    expect(progress).toEqual([[10, 11], [11, 11]]);
  });

  it("reports progress and cancels between paginated export batches", async () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Kontonummer: ACCT-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -97,70 NOK Bokført 27.05 MARKET",
      "1/2 Rogaland Sparebank",
      "Transaksjoner Antall: 2",
      "Kontonummer: ACCT-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "27.05.2026 Lønn SYNTHETIC EMPLOYER 50 000,00 NOK Bokført Fra: EMPLOYER",
      "2/2 Rogaland Sparebank",
    ].join("\n");
    const progress: Array<[number, number]> = [];
    let cancellationObserved = false;
    const progressAfterCancellation: Array<[number, number]> = [];

    const result = await pdfTextParser.parseRogalandStatementTextInBatches(text, BASE_OPTIONS, {
      batchSize: 1,
      isCancelled: () => {
        if (progress.length === 1) {
          cancellationObserved = true;
          return true;
        }
        return false;
      },
      onProgress: (completedRows, totalRows) => {
        const update: [number, number] = [completedRows, totalRows];
        if (cancellationObserved) progressAfterCancellation.push(update);
        progress.push(update);
      },
    });

    expect(result).toBeNull();
    expect(cancellationObserved).toBe(true);
    expect(progress).toEqual([[1, 2]]);
    expect(progressAfterCancellation).toEqual([]);
  });

  it("cancels a paginated parse before processing any rows", async () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 1",
      "Kontonummer: ACCT-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -10,00 NOK Bokført SYNTHETIC SHOP",
      "1/1 Rogaland Sparebank",
    ].join("\n");
    const progress: Array<[number, number]> = [];

    const result = await pdfTextParser.parseRogalandStatementTextInBatches(text, BASE_OPTIONS, {
      batchSize: 1,
      isCancelled: () => true,
      onProgress: (completedRows, totalRows) => progress.push([completedRows, totalRows]),
    });

    expect(result).toBeNull();
    expect(progress).toEqual([]);
  });

  it("builds the same import job ID for identical content and context", () => {
    const text = loadFixture();

    expect(buildRogalandImportJobId(text, BASE_OPTIONS)).toBe(
      buildRogalandImportJobId(text, BASE_OPTIONS)
    );
  });

  it("separates the public import identity when account, household, or content changes", () => {
    const text = loadFixture();
    const identity = buildRogalandImportJobId(text, BASE_OPTIONS);

    expect(identity).not.toBe(buildRogalandImportJobId(text, {
      householdId: BASE_OPTIONS.householdId,
      accountId: "acc-other",
    }));
    expect(identity).not.toBe(buildRogalandImportJobId(text, {
      householdId: "hh-other",
      accountId: BASE_OPTIONS.accountId,
    }));
    expect(identity).not.toBe(buildRogalandImportJobId(`${text}\nchanged source content`, BASE_OPTIONS));
  });
  describe("isRogalandStatementText", () => {
    it("returns true for text containing ROGALAND SPAREBANK header token", () => {
      expect(isRogalandStatementText("ROGALAND SPAREBANK\nKontonummer: 1234")).toBe(true);
    });

    it("returns false for text without the header token", () => {
      expect(isRogalandStatementText("Some other bank statement")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isRogalandStatementText("")).toBe(false);
    });
  });

  describe("AC-3: unsupported layout returns UNSUPPORTED_LAYOUT error", () => {
    it("rejects text that does not contain the Rogaland header token", () => {
      const result = parseRogalandStatementText("Wrong bank\nDato  Beskrivelse  Beløp  Saldo\n", BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
    });

    it("rejects empty text", () => {
      const result = parseRogalandStatementText("", BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
    });
  });

  describe("AC-3: missing transaction section returns MISSING_TRANSACTION_SECTION error", () => {
    it("rejects statement with header token but no transaction table header", () => {
      const text = "ROGALAND SPAREBANK\nKontonummer: 1234\nKontonavn: Brukskonto\n";
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("MISSING_TRANSACTION_SECTION");
    });

    it("rejects statement with header and table header but no transaction rows", () => {
      const text = [
        "ROGALAND SPAREBANK",
        "Kontonummer: 1234",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
        "",
      ].join("\n");
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("MISSING_TRANSACTION_SECTION");
    });
  });

  it("includes the source line and field for a malformed transaction row", () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Dato         Beskrivelse                              Beløp          Saldo",
      "27.05.2026   BROKEN ROW                               invalid         75,00",
    ].join("\n");
    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "INVALID_AMOUNT_FORMAT",
      lineNumber: 3,
      field: "amount",
    });
  });

  it("maps the transaction amount instead of the distinct running balance", () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Dato         Beskrivelse                              Beløp          Saldo",
      "26.05.2026   SYNTHETIC MARKET                         -97,70      24 902,30",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions.map(({ bookedAtIso, amountMinor, merchantRaw }) => ({
      bookedAtIso,
      amountMinor,
      merchantRaw,
    }))).toEqual([
      {
        bookedAtIso: "2026-05-26T00:00:00Z",
        amountMinor: -9770,
        merchantRaw: "SYNTHETIC MARKET",
      },
    ]);
  });

  it("reports a malformed bank-export row before the first transaction", () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "BAD ROW WITHOUT A DATE",
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -97,70 NOK Bokført 27.05 MARKET",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "INVALID_TRANSACTION_ROW", lineNumber: 4 }],
    });
  });

  it("reports an unindented malformed row after a bank-export transaction", () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -97,70 NOK Bokført 27.05 MARKET",
      "BROKEN ROW WITHOUT A DATE",
      "27.05.2026 Lønn SYNTHETIC EMPLOYER 50 000,00 NOK Bokført Fra: EMPLOYER",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "INVALID_TRANSACTION_ROW", lineNumber: 5 }],
    });
  });

  it("does not merge a malformed line outside the message column into a transaction", () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -97,70 NOK Bokført 27.05 MARKET",
      "    BROKEN ROW WITHOUT A DATE",
      "27.05.2026 Lønn SYNTHETIC EMPLOYER 50 000,00 NOK Bokført Fra: EMPLOYER",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "INVALID_TRANSACTION_ROW", lineNumber: 5 }],
    });
  });

  it("joins a message continuation at the supported column boundary exactly once", () => {
    const tableHeader = "Dato       Type          Fra konto       Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr";
    const continuationColumn = tableHeader.indexOf("Melding/KID/Fakt.nr") - 8;
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Kontonummer: ACCT-001",
      tableHeader,
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -10,00 NOK Bokført SYNTHETIC SHOP",
      `${" ".repeat(continuationColumn)}SECOND   LINE`,
      "27.05.2026 Varekjøp ACCT-001 LOCAL_USER -20,00 NOK Bokført SYNTHETIC NEXT SHOP",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map(({ bookedAtIso, amountMinor, merchantRaw }) => ({
      bookedAtIso,
      amountMinor,
      merchantRaw,
    }))).toEqual([
      {
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -1000,
        merchantRaw: "SYNTHETIC SHOP SECOND LINE",
      },
      {
        bookedAtIso: "2026-05-27T00:00:00Z",
        amountMinor: -2000,
        merchantRaw: "SYNTHETIC NEXT SHOP",
      },
    ]);
  });

  it("rejects malformed text one column outside the message continuation boundary", () => {
    const tableHeader = "Dato       Type          Fra konto       Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr";
    const continuationColumn = tableHeader.indexOf("Melding/KID/Fakt.nr") - 9;
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Kontonummer: ACCT-001",
      tableHeader,
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -10,00 NOK Bokført SYNTHETIC SHOP",
      `${" ".repeat(continuationColumn)}MALFORMED OUTSIDE TEXT`,
      "27.05.2026 Varekjøp ACCT-001 LOCAL_USER -20,00 NOK Bokført SYNTHETIC NEXT SHOP",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map(({ code, lineNumber }) => ({ code, lineNumber }))).toEqual([
      { code: "INVALID_TRANSACTION_ROW", lineNumber: 6 },
    ]);
  });

  it("joins a wrapped transaction type just inside its column boundary", () => {
    const tableHeader = "Dato       Type          Fra konto       Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr";
    const continuationColumn = tableHeader.indexOf("Fra konto") - 9;
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Kontonummer: ACCT-001",
      tableHeader,
      "28.05.2026 Betaling ACCT-001 LOCAL_USER -10,00 NOK Bokført SYNTHETIC BILL",
      `${" ".repeat(continuationColumn)}innland`,
      "27.05.2026 Varekjøp ACCT-001 LOCAL_USER -20,00 NOK Bokført SYNTHETIC NEXT SHOP",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map(({ bookedAtIso, amountMinor, merchantRaw }) => ({
      bookedAtIso,
      amountMinor,
      merchantRaw,
    }))).toEqual([
      {
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -1000,
        merchantRaw: "SYNTHETIC BILL",
      },
      {
        bookedAtIso: "2026-05-27T00:00:00Z",
        amountMinor: -2000,
        merchantRaw: "SYNTHETIC NEXT SHOP",
      },
    ]);
  });

  it("preserves a wrapped type once in the fallback description when the message is empty", () => {
    const tableHeader = "Dato       Type          Fra konto       Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr";
    const continuationColumn = tableHeader.indexOf("Fra konto") - 9;
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Kontonummer: ACCT-001",
      tableHeader,
      "28.05.2026 Betaling ACCT-001 LOCAL_USER -10,00 NOK Bokført",
      `${" ".repeat(continuationColumn)}innland`,
      "27.05.2026 Varekjøp ACCT-001 LOCAL_USER -20,00 NOK Bokført SYNTHETIC NEXT SHOP",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map(({ bookedAtIso, amountMinor, merchantRaw }) => ({
      bookedAtIso,
      amountMinor,
      merchantRaw,
    }))).toEqual([
      {
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -1000,
        merchantRaw: "Betaling innland ACCT-001 LOCAL_USER",
      },
      {
        bookedAtIso: "2026-05-27T00:00:00Z",
        amountMinor: -2000,
        merchantRaw: "SYNTHETIC NEXT SHOP",
      },
    ]);
  });

  it("rejects malformed text at the unsupported side of the transaction-type boundary", () => {
    const tableHeader = "Dato       Type          Fra konto       Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr";
    const continuationColumn = tableHeader.indexOf("Fra konto") - 8;
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Kontonummer: ACCT-001",
      tableHeader,
      "28.05.2026 Betaling ACCT-001 LOCAL_USER -10,00 NOK Bokført SYNTHETIC BILL",
      `${" ".repeat(continuationColumn)}MALFORMED OUTSIDE TYPE TEXT`,
      "27.05.2026 Varekjøp ACCT-001 LOCAL_USER -20,00 NOK Bokført SYNTHETIC NEXT SHOP",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map(({ code, lineNumber }) => ({ code, lineNumber }))).toEqual([
      { code: "INVALID_TRANSACTION_ROW", lineNumber: 6 },
    ]);
  });

  it("reports a malformed bank-export amount as an amount error", () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 1",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER invalid NOK Bokført 27.05 MARKET",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "INVALID_AMOUNT_FORMAT", lineNumber: 4, field: "amount" }],
    });
  });

  it("keeps booked rows and reports reserved and confirmed rows as excluded", () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 3",
      "Kontonummer: ACCT-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -97,70 NOK Reservert 27.05 MARKET",
      "1/3 Rogaland Sparebank",
      "Transaksjoner Antall: 3",
      "Kontonummer: ACCT-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Betaling ACCT-001 LOCAL_USER -350,00 NOK Bekreftet 27.05 BILL",
      "2/3 Rogaland Sparebank",
      "Transaksjoner Antall: 3",
      "Kontonummer: ACCT-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "27.05.2026 Varekjøp ACCT-001 LOCAL_USER -20,00 NOK Bokført 26.05 SHOP",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions.map(({ bookedAtIso, amountMinor, merchantRaw }) => ({
      bookedAtIso,
      amountMinor,
      merchantRaw,
    }))).toEqual([
      {
        bookedAtIso: "2026-05-27T00:00:00Z",
        amountMinor: -2000,
        merchantRaw: "26.05 SHOP",
      },
    ]);
    expect(result.excludedRows).toEqual([
      {
        lineNumber: 5,
        status: "Reservert",
        date: "28.05.2026",
        amount: "-97,70",
        currencyCode: "NOK",
        description: "27.05 MARKET",
      },
      {
        lineNumber: 10,
        status: "Bekreftet",
        date: "28.05.2026",
        amount: "-350,00",
        currencyCode: "NOK",
        description: "27.05 BILL",
      },
    ]);
  });

  it("keeps the synchronous no-booked-rows failure for a wholly unbooked statement", () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Kontonummer: ACCT-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -11,00 NOK Reservert SYNTHETIC RESERVED",
      "1/2 Rogaland Sparebank",
      "Transaksjoner Antall: 2",
      "Kontonummer: ACCT-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "27.05.2026 Betaling ACCT-001 LOCAL_USER -350,00 NOK Bekreftet SYNTHETIC CONFIRMED",
      "2/2 Rogaland Sparebank",
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result).toEqual({
      ok: false,
      errors: [{
        code: "MISSING_TRANSACTION_SECTION",
        message: "No bank-export transaction rows were found in the statement.",
      }],
    });
  });

  it("parses wrapped descriptions across repeated bank-export page headers", () => {
    const text = readFileSync(PAGINATED_EXPORT_FIXTURE_PATH, "utf8").replace(
      "1/2 Rogaland Sparebank",
      "Utgående saldo pr. 28.05.2026: 900 000,00 NOK\n1/2 Rogaland Sparebank"
    );
    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map(({ id, bookedAtIso, amountMinor, merchantRaw }) => ({
      id,
      bookedAtIso,
      amountMinor,
      merchantRaw,
    }))).toEqual([
      {
        id: "pdf-1",
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -9770,
        merchantRaw: "27.05 SYNTHETIC MARKET 7 SANDNES",
      },
      {
        id: "pdf-2",
        bookedAtIso: "2026-05-27T00:00:00Z",
        amountMinor: 5_000_000,
        merchantRaw: "Fra: SYNTHETIC EMPLOYER",
      },
    ]);
  });

  it.each([
    { firstTypeLine: "Betaling", typeContinuation: "innland", amount: "-100,00", merchant: "SYNTHETIC BILL", amountMinor: -10_000 },
    { firstTypeLine: "Omkostnin", typeContinuation: "g", amount: "-350,00", merchant: "SYNTHETIC FEE", amountMinor: -35_000 },
  ])("joins wrapped transaction type '$typeContinuation' without changing the message", ({ firstTypeLine, typeContinuation, amount, merchant, amountMinor }) => {
    const tableHeader = "Dato       Type          Fra konto       Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr";
    const wrappedTypeLine = `${" ".repeat(tableHeader.indexOf("Type"))}${typeContinuation}`;
    const text = [
      "ROGALAND SPAREBANK",
      tableHeader,
      `28.05.2026 ${firstTypeLine} ACCT-001 LOCAL_USER ${amount} NOK Bokført ${merchant}`,
      wrappedTypeLine,
    ].join("\n");

    const result = parseRogalandStatementText(text, BASE_OPTIONS);

    expect(result).toMatchObject({
      ok: true,
      transactions: [{ merchantRaw: merchant, amountMinor }],
    });
  });

  describe("AC-1: fixture produces expected transaction candidates", () => {
    it("successfully parses the synthetic fixture", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transactions.length).toBeGreaterThan(0);
    });

    it("parses repeated page headers and joins wrapped descriptions in the bank export layout", () => {
      const text = readFileSync(PAGINATED_EXPORT_FIXTURE_PATH, "utf8");
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transactions).toMatchObject([
        {
          bookedAtIso: "2026-05-28T00:00:00Z",
          amountMinor: -9770,
          merchantRaw: "27.05 SYNTHETIC MARKET 7 SANDNES",
        },
        {
          bookedAtIso: "2026-05-27T00:00:00Z",
          amountMinor: 5_000_000,
          merchantRaw: "Fra: SYNTHETIC EMPLOYER",
        },
      ]);
    });

    it("all transactions have required domain fields set correctly", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      for (const tx of result.transactions) {
        expect(typeof tx.id).toBe("string");
        expect(tx.id.length).toBeGreaterThan(0);
        expect(tx.householdId).toBe("hh-test");
        expect(tx.accountId).toBe("acc-test");
        expect(tx.bookedAtIso).toMatch(ISO_DATETIME_PATTERN);
        expect(Number.isInteger(tx.amountMinor)).toBe(true);
        expect(typeof tx.merchantRaw).toBe("string");
        expect(tx.merchantRaw.length).toBeGreaterThan(0);
        expect(tx.currencyCode).toBe("NOK");
        expect(tx.sourceType).toBe("pdf");
      }
    });

    it("income row maps to positive amountMinor", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const income = result.transactions.find((tx) => tx.amountMinor > 0);
      expect(income).toBeDefined();
    });

    it("expense row maps to negative amountMinor", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const expense = result.transactions.find((tx) => tx.amountMinor < 0);
      expect(expense).toBeDefined();
    });

    it("salary row maps to +5000000 minor units (50 000,00 NOK)", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const salary = result.transactions.find(
        (tx) => tx.merchantRaw.includes("SALARY") && !tx.merchantRaw.includes("ADVANCE")
      );
      expect(salary).toBeDefined();
      expect(salary!.amountMinor).toBe(5000000);
    });

    it("MERCHANT-005 row maps to -9770 minor units (-97,70 NOK)", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const tx = result.transactions.find((tx) => tx.merchantRaw.startsWith("MERCHANT-005"));
      expect(tx).toBeDefined();
      expect(tx!.amountMinor).toBe(-9770);
    });

    const amountPrecisionCases = [
      { layout: "classic", rawAmount: "0,01", balance: "900,00", expectedAmountMinor: 1 },
      { layout: "classic", rawAmount: "-0,01", balance: "800,00", expectedAmountMinor: -1 },
      { layout: "classic", rawAmount: "+97,70", balance: "700,00", expectedAmountMinor: 9770 },
      { layout: "classic", rawAmount: "50 000,00", balance: "75 000,00", expectedAmountMinor: 5_000_000 },
      { layout: "bank-export", rawAmount: "0,01", balance: "", expectedAmountMinor: 1 },
      { layout: "bank-export", rawAmount: "-0,01", balance: "", expectedAmountMinor: -1 },
      { layout: "bank-export", rawAmount: "+97,70", balance: "", expectedAmountMinor: 9770 },
      { layout: "bank-export", rawAmount: "50 000,00", balance: "", expectedAmountMinor: 5_000_000 },
    ] as const;

    it.each(amountPrecisionCases)("maps $rawAmount to $expectedAmountMinor minor units in the $layout layout", ({
      layout,
      rawAmount,
      balance,
      expectedAmountMinor,
    }) => {
      const text = layout === "classic"
        ? [
            "ROGALAND SPAREBANK",
            "Dato         Beskrivelse                              Beløp          Saldo",
            `28.05.2026   SYNTHETIC AMOUNT                         ${rawAmount}     ${balance}`,
          ].join("\n")
        : [
            "ROGALAND SPAREBANK",
            "Transaksjoner Antall: 1",
            "Kontonummer: ACCT-001",
            "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
            `28.05.2026 Varekjøp ACCT-001 LOCAL_USER ${rawAmount} NOK Bokført SYNTHETIC AMOUNT`,
          ].join("\n");

      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toMatchObject({
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: expectedAmountMinor,
        merchantRaw: "SYNTHETIC AMOUNT",
      });
    });

    it("importJobId is propagated to all transactions when provided", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, { ...BASE_OPTIONS, importJobId: "job-42" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transactions.every((tx) => tx.importJobId === "job-42")).toBe(true);
    });

    it("transaction ids use idPrefix and are unique", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, { ...BASE_OPTIONS, idPrefix: "pfx" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const ids = result.transactions.map((tx) => tx.id);
      expect(ids.every((id) => id.startsWith("pfx-"))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("AC-2: deterministic output across repeated parse calls", () => {
    it("produces identical ordered candidates for identical fixture content", () => {
      const text = loadFixture();
      const first = parseRogalandStatementText(text, BASE_OPTIONS);
      const second = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(first).toEqual(second);
    });

    it("produces same transaction count on each parse", () => {
      const text = loadFixture();
      const r1 = parseRogalandStatementText(text, BASE_OPTIONS);
      const r2 = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;
      expect(r1.transactions.length).toBe(r2.transactions.length);
    });
  });

  describe("AC-4: source-aware adapter records adapter identity", () => {
    it("returns the Rogaland adapter ID on successful parse", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.adapterId).toBe(ROGALAND_ADAPTER_ID);
    });

    it("adapter ID is the canonical rogaland-sparebank-text-v1 string", () => {
      expect(ROGALAND_ADAPTER_ID).toBe("rogaland-sparebank-text-v1");
    });
  });

  describe("AC-3: invalid amount format in a transaction line produces error", () => {
    const invalidRow = "27.05.2026   BROKEN AMOUNT                            invalid-amount  75 000,00";
    const firstValidRow = "28.05.2026   SYNTHETIC FIRST                         -10,00          200,00";
    const secondValidRow = "26.05.2026   SYNTHETIC SECOND                        -20,00          300,00";

    it.each([
      { placement: "before", rows: [invalidRow, firstValidRow, secondValidRow], lineNumber: 3 },
      { placement: "between", rows: [firstValidRow, invalidRow, secondValidRow], lineNumber: 4 },
      { placement: "after", rows: [firstValidRow, secondValidRow, invalidRow], lineNumber: 5 },
    ])("rejects an invalid amount $placement valid rows without returning partial transactions", ({ rows, lineNumber }) => {
      const text = [
        "ROGALAND SPAREBANK",
        "Dato         Beskrivelse                              Beløp          Saldo",
        ...rows,
      ].join("\n");

      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.map(({ code, field, lineNumber: errorLineNumber }) => ({
        code,
        field,
        lineNumber: errorLineNumber,
      }))).toEqual([
        { code: "INVALID_AMOUNT_FORMAT", field: "amount", lineNumber },
      ]);
      expect("transactions" in result).toBe(false);
    });

    const dateInput = (layout: "classic" | "bank-export", rawDate: string): string => layout === "classic"
      ? [
          "ROGALAND SPAREBANK",
          "Dato         Beskrivelse                              Beløp          Saldo",
          `${rawDate}   SYNTHETIC DATE                           -1,00          900,00`,
        ].join("\n")
      : [
          "ROGALAND SPAREBANK",
          "Transaksjoner Antall: 1",
          "Kontonummer: ACCT-001",
          "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
          `${rawDate} Varekjøp ACCT-001 LOCAL_USER -1,00 NOK Bokført SYNTHETIC DATE`,
        ].join("\n");

    it.each([
      { layout: "classic", rawDate: "29.02.2024", expectedDate: "2024-02-29T00:00:00Z" },
      { layout: "bank-export", rawDate: "29.02.2024", expectedDate: "2024-02-29T00:00:00Z" },
    ] as const)("maps valid leap day $rawDate in the $layout layout without rollover", ({
      layout,
      rawDate,
      expectedDate,
    }) => {
      const result = parseRogalandStatementText(dateInput(layout, rawDate), BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected a valid leap-day transaction");
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toMatchObject({
        bookedAtIso: expectedDate,
        amountMinor: -100,
        merchantRaw: "SYNTHETIC DATE",
      });
    });

    it.each([
      { layout: "classic", rawDate: "29.02.2025", lineNumber: 3 },
      { layout: "classic", rawDate: "31.04.2026", lineNumber: 3 },
      { layout: "bank-export", rawDate: "29.02.2025", lineNumber: 5 },
      { layout: "bank-export", rawDate: "31.04.2026", lineNumber: 5 },
    ] as const)("rejects invalid date $rawDate in the $layout layout without rollover", ({
      layout,
      rawDate,
      lineNumber,
    }) => {
      const result = parseRogalandStatementText(dateInput(layout, rawDate), BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected an invalid calendar date to fail");
      expect(result.errors.map(({ code, field, lineNumber: errorLineNumber }) => ({
        code,
        field,
        lineNumber: errorLineNumber,
      }))).toEqual([
        { code: "INVALID_DATE_FORMAT", field: "date", lineNumber },
      ]);
      expect("transactions" in result).toBe(false);
    });
  });

  describe("Scenario 2: reordered input rows produce deterministic per-row results", () => {
    it("parsing reordered rows produces a result with the same set of merchantRaw values", () => {
      const header = [
        "ROGALAND SPAREBANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
      ];
      const row1 = "27.05.2026   SALARY                                  +50 000,00     75 000,00 ";
      const row2 = "26.05.2026   MERCHANT-005 Butikkkjøp                    -97,70      24 902,30 ";

      const original = parseRogalandStatementText([...header, row1, row2].join("\n"), BASE_OPTIONS);
      const reordered = parseRogalandStatementText([...header, row2, row1].join("\n"), BASE_OPTIONS);

      expect(original.ok).toBe(true);
      expect(reordered.ok).toBe(true);
      if (!original.ok || !reordered.ok) return;

      const originalMerchants = original.transactions.map((tx) => tx.merchantRaw).sort();
      const reorderedMerchants = reordered.transactions.map((tx) => tx.merchantRaw).sort();
      expect(originalMerchants).toEqual(reorderedMerchants);
    });

    it("parsing reordered rows yields the same canonical transaction order", () => {
      const header = [
        "ROGALAND SPAREBANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
      ];
      const row1 = "27.05.2026   SALARY                                  +50 000,00     75 000,00 ";
      const row2 = "26.05.2026   MERCHANT-005 Butikkkjøp                    -97,70      24 902,30 ";

      const original = parseRogalandStatementText([...header, row1, row2].join("\n"), BASE_OPTIONS);
      const reordered = parseRogalandStatementText([...header, row2, row1].join("\n"), BASE_OPTIONS);

      expect(original.ok).toBe(true);
      expect(reordered.ok).toBe(true);
      if (!original.ok || !reordered.ok) return;

      expect(reordered).toEqual(original);
    });

    it("parsing the same reordered input twice produces identical results (deterministic)", () => {
      const text = [
        "ROGALAND SPAREBANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
        "26.05.2026   MERCHANT-005 Butikkkjøp                    -97,70      24 902,30 ",
        "27.05.2026   SALARY                                  +50 000,00     75 000,00 ",
      ].join("\n");

      const first = parseRogalandStatementText(text, BASE_OPTIONS);
      const second = parseRogalandStatementText(text, BASE_OPTIONS);
      expect(first).toEqual(second);
    });
  });

  describe("Scenario 3: malformed input returns explicit failures without partial results", () => {
    it("rejects a transaction row with a missing amount", () => {
      const text = [
        "ROGALAND SPAREBANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
        "27.05.2026   SALARY",
      ].join("\n");

      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("INVALID_AMOUNT_FORMAT");
      expect(result).not.toHaveProperty("transactions");
    });

    it("rejects a malformed row after a valid row without returning partial transactions", () => {
      const text = [
        "ROGALAND SPAREBANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
        "27.05.2026   SALARY                                  +50 000,00     75 000,00 ",
        "26.05.2026   MERCHANT-005 Butikkkjøp                    invalid-amount  24 902,30 ",
      ].join("\n");

      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("INVALID_AMOUNT_FORMAT");
      expect(result).not.toHaveProperty("transactions");
    });

    it("rejects an unsupported layout without returning partial transactions", () => {
      const text = [
        "OTHER BANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
        "27.05.2026   SALARY                                  +50 000,00     75 000,00 ",
      ].join("\n");

      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
      expect(result).not.toHaveProperty("transactions");
    });
  });

  describe("importJobId and idPrefix edge cases", () => {
    it("omitting importJobId means importJobId is absent from transactions", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const tx of result.transactions) {
        expect(Object.prototype.hasOwnProperty.call(tx, "importJobId")).toBe(false);
      }
    });

    it("default idPrefix is 'pdf' when not specified", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transactions.every((tx) => tx.id.startsWith("pdf-"))).toBe(true);
    });
  });
});
