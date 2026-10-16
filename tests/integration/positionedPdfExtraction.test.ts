import { describe, expect, it } from "vitest";
import {
  extractPdfTextFromBuffer,
  extractSourceDocumentFromBuffer,
} from "../../src/app/import/extractPdfText.js";
import { defaultParserAdapterRegistry } from "../../src/domain/import/parserAdapterRegistry.js";
import { parseRogalandStatementText } from "../../src/domain/import/pdfTextParser.js";

interface PdfTextPlacement {
  x: number;
  y: number;
  text: string;
}

function encodePdfText(value: string): string {
  return `<${Array.from(Buffer.from(value, "latin1"), (byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
}

function createSyntheticPdf(pages: readonly PdfTextPlacement[][]): Buffer {
  const pageObjectIds = pages.map((_, pageIndex) => 4 + pageIndex * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((pageObjectId) => `${pageObjectId} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ...pages.flatMap((placements, pageIndex) => {
      const pageObjectId = pageObjectIds[pageIndex]!;
      const contentObjectId = pageObjectId + 1;
      const content = placements.map(({ x, y, text }) =>
        `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm ${encodePdfText(text)} Tj ET`
      ).join("\n");
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate 90 /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
        `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
      ];
    }),
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const crossReferenceOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

function createColumnOrderedStatement(): Buffer {
  const placements: PdfTextPlacement[] = [
    { x: 480, y: 24, text: "ROGALAND SPAREBANK" },
    { x: 273, y: 24, text: "Dato" },
    { x: 273, y: 84, text: "Type" },
    { x: 273, y: 144, text: "Fra konto" },
    { x: 273, y: 219, text: "Avsender" },
    { x: 273, y: 319, text: "Til konto" },
    { x: 273, y: 394, text: "Mottakernavn" },
    { x: 273, y: 538, text: "Beløp" },
    { x: 273, y: 574, text: "Valuta" },
    { x: 273, y: 614, text: "Status" },
    { x: 273, y: 666, text: "Melding/KID/Fakt.nr" },
    { x: 293, y: 24, text: "28.05.2026" },
    { x: 293, y: 84, text: "Betaling" },
    { x: 303, y: 84, text: "innland" },
    { x: 293, y: 144, text: "ACCT-001" },
    { x: 293, y: 219, text: "LOCAL_USER" },
    { x: 293, y: 538, text: "-97,70" },
    { x: 293, y: 574, text: "NOK" },
    { x: 293, y: 614, text: "Bokført" },
    { x: 293, y: 666, text: "SYNTHETIC SHOP" },
  ];

  return createSyntheticPdf([placements]);
}

function createRogalandStatementPage(
  date: string,
  amount: string,
  message: string,
  footer: string,
  continuation?: string
): PdfTextPlacement[] {
  return [
    { x: 480, y: 24, text: "ROGALAND SPAREBANK" },
    { x: 273, y: 24, text: "Dato" },
    { x: 273, y: 84, text: "Type" },
    { x: 273, y: 144, text: "Fra konto" },
    { x: 273, y: 219, text: "Avsender" },
    { x: 273, y: 319, text: "Til konto" },
    { x: 273, y: 394, text: "Mottakernavn" },
    { x: 273, y: 538, text: "Beløp" },
    { x: 273, y: 574, text: "Valuta" },
    { x: 273, y: 614, text: "Status" },
    { x: 273, y: 666, text: "Melding/KID/Fakt.nr" },
    { x: 293, y: 24, text: date },
    { x: 293, y: 84, text: "Varekjop" },
    { x: 293, y: 144, text: "ACCT-001" },
    { x: 293, y: 219, text: "SYNTHETIC" },
    { x: 293, y: 319, text: "DEST-001" },
    { x: 293, y: 394, text: "SYNTHETIC SHOP" },
    { x: 293, y: 538, text: amount },
    { x: 293, y: 574, text: "NOK" },
    { x: 293, y: 614, text: "Bokført" },
    { x: 293, y: 666, text: message },
    ...(continuation === undefined ? [] : [{ x: 303, y: 666, text: continuation }]),
    { x: 480, y: 800, text: footer },
  ];
}

function createPaginatedRogalandStatement(): Buffer {
  return createSyntheticPdf([
    createRogalandStatementPage("28.05.2026", "-10,00", "FIRST PAGE SHOP", "1/2 Rogaland Sparebank"),
    createRogalandStatementPage("27.05.2026", "-20,00", "WRAPPED", "2/2 Rogaland Sparebank", "DESCRIPTION"),
  ]);
}

describe("position-aware PDF extraction", () => {
  it("preserves page roles and wrapped-row evidence across repeated headers and footers", async () => {
    const sourceDocument = await extractSourceDocumentFromBuffer(createPaginatedRogalandStatement());
    const repeatedExtraction = await extractSourceDocumentFromBuffer(createPaginatedRogalandStatement());

    expect(repeatedExtraction).toEqual(sourceDocument);
    expect(sourceDocument.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    const secondPage = sourceDocument.pages[1];
    expect(secondPage).toBeDefined();
    if (secondPage === undefined) return;

    expect(secondPage.sourceLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ classification: "column-header" }),
      expect.objectContaining({
        classification: "document-decoration",
        rawText: expect.stringContaining("2/2 Rogaland Sparebank"),
      }),
      expect.objectContaining({ classification: "continuation", rawText: "DESCRIPTION" }),
    ]));
    expect(secondPage.text).toContain("WRAPPED DESCRIPTION");

    const parseResult = defaultParserAdapterRegistry.parse(sourceDocument, {
      householdId: "hh-test",
      accountId: "acc-test",
    });
    expect(parseResult).toMatchObject({
      ok: true,
      candidates: [
        { bookedAtIso: "2026-05-28T00:00:00Z", merchantRaw: "FIRST PAGE SHOP" },
        { bookedAtIso: "2026-05-27T00:00:00Z", merchantRaw: "WRAPPED DESCRIPTION" },
      ],
    });
  });

  it("reconstructs column-ordered PDF text into a parseable bank transaction", async () => {
    const pdfText = await extractPdfTextFromBuffer(createColumnOrderedStatement());
    const result = parseRogalandStatementText(pdfText, {
      householdId: "hh-test",
      accountId: "acc-test",
    });

    expect(result).toMatchObject({
      ok: true,
      transactions: [{
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -9770,
        merchantRaw: "SYNTHETIC SHOP",
        currencyCode: "NOK",
        sourceType: "pdf",
      }],
    });
  });
});