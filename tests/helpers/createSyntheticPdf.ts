import { writePdfObjects } from "./pdfObjectWriter.js";

export function createSyntheticPdfWithText(text: string): Buffer {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const pageHeight = Math.max(850, lines.length * 20 + 80);
  const content = lines.map((line, index) => {
    const y = pageHeight - 40 - index * 20;
    const encodedText = Array.from(Buffer.from(line, "latin1"), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    return `BT /F1 10 Tf 1 0 0 1 24 ${y} Tm <${encodedText}> Tj ET`;
  }).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
  ];

  return writePdfObjects(objects);
}
