import { writePdfObjects } from "./pdfObjectWriter.js";

interface PdfTextPlacement {
  x: number;
  y: number;
  text: string;
}

const columnHeaders = [
  "Dato",
  "Type",
  "Fra konto",
  "Avsender",
  "Til konto",
  "Mottakernavn",
  "Beløp",
  "Valuta",
  "Status",
  "Melding/KID/Fakt.nr",
] as const;

function encodePdfText(value: string): string {
  return `<${Array.from(Buffer.from(value, "latin1"), (byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
}

function createPositionedPdf(pages: readonly PdfTextPlacement[][]): Buffer {
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
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
        `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
      ];
    }),
  ];

  return writePdfObjects(objects);
}

function createStatementPage(
  date: string,
  amount: string,
  description: string,
  pageNumber: number,
  continuation?: string
): PdfTextPlacement[] {
  const columnX = [20, 95, 170, 270, 370, 455, 565, 635, 695, 760];
  return [
    { x: 20, y: 570, text: "ROGALAND SPAREBANK" },
    ...columnHeaders.map((text, index) => ({ x: columnX[index]!, y: 520, text })),
    { x: 20, y: 475, text: date },
    { x: 95, y: 475, text: "Purchase" },
    { x: 170, y: 475, text: "ACCT-001" },
    { x: 270, y: 475, text: "SYNTHETIC" },
    { x: 370, y: 475, text: "DEST-001" },
    { x: 455, y: 475, text: "SYNTHETIC SHOP" },
    { x: 565, y: 475, text: amount },
    { x: 635, y: 475, text: "NOK" },
    { x: 695, y: 475, text: "Bokført" },
    { x: 760, y: 475, text: description },
    ...(continuation === undefined ? [] : [{ x: 760, y: 445, text: continuation }]),
    { x: 480, y: 25, text: `${pageNumber}/2 Rogaland Sparebank` },
  ];
}

export function createPaginatedRogalandPdfWithMalformedSecondPage(): Buffer {
  return createPositionedPdf([
    createStatementPage("28.05.2026", "-10,00", "FIRST PAGE SHOP", 1),
    createStatementPage("27.05.2026", "not-an-amount", "MALFORMED", 2, "DESCRIPTION"),
  ]);
}
