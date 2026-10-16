import { describe, expect, it } from "vitest";
import { extractPdfTextFromBuffer } from "../../src/app/import/extractPdfText.js";
import { parseRogalandStatementText } from "../../src/domain/import/pdfTextParser.js";

interface PdfTextPlacement {
  x: number;
  y: number;
  text: string;
}

function encodePdfText(value: string): string {
  return `<${Array.from(Buffer.from(value, "latin1"), (byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
}

function createSyntheticPdf(placements: readonly PdfTextPlacement[]): Buffer {
  const content = placements.map(({ x, y, text }) =>
    `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm ${encodePdfText(text)} Tj ET`
  ).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate 90 /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
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

  return createSyntheticPdf(placements);
}

describe("position-aware PDF extraction", () => {
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