import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PDF_ROW_HEADERS = [
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

const PDF_ROW_BASELINE_TOLERANCE = 2;
const PDF_CONTINUATION_X_TOLERANCE = 5;

interface PositionedTextItem {
  text: string;
  x: number;
  y: number;
}

interface PdfJsTextItem {
  str: string;
  transform: number[];
}

interface PositionedTextLine {
  y: number;
  items: PositionedTextItem[];
}

interface PdfColumnAnchor {
  label: (typeof PDF_ROW_HEADERS)[number];
  x: number;
}

function isTextItem(item: unknown): item is PdfJsTextItem {
  return typeof item === "object" && item !== null &&
    "str" in item && typeof item.str === "string" &&
    "transform" in item && Array.isArray(item.transform);
}

function groupTextItemsByBaseline(items: readonly PositionedTextItem[]): PositionedTextLine[] {
  const lines: PositionedTextLine[] = [];
  for (const item of [...items].sort((left, right) => left.y - right.y || left.x - right.x)) {
    const currentLine = lines.at(-1);
    if (currentLine !== undefined && Math.abs(currentLine.y - item.y) <= PDF_ROW_BASELINE_TOLERANCE) {
      currentLine.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  return lines;
}

function findPdfColumnAnchors(line: PositionedTextLine): PdfColumnAnchor[] | null {
  const anchors = PDF_ROW_HEADERS.flatMap((label) => {
    const item = line.items.find((candidate) => candidate.text.trim() === label);
    return item === undefined ? [] : [{ label, x: item.x }];
  });
  return anchors.length === PDF_ROW_HEADERS.length ? anchors : null;
}

function findColumnIndex(x: number, columns: readonly PdfColumnAnchor[]): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [index, column] of columns.entries()) {
    const distance = Math.abs(column.x - x);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

function appendLineToCells(cells: string[][], line: PositionedTextLine, columns: readonly PdfColumnAnchor[]): void {
  for (const item of line.items) {
    const columnIndex = findColumnIndex(item.x, columns);
    cells[columnIndex]?.push(item.text.trim());
  }
}

function isTransactionDate(value: string): boolean {
  return /^\d{2}\.\d{2}\.\d{4}$/.test(value.trim());
}

function isDocumentDecoration(line: PositionedTextLine): boolean {
  const text = line.items.map((item) => item.text.trim()).join(" ");
  return line.items.some((item) => PDF_ROW_HEADERS.includes(item.text.trim() as (typeof PDF_ROW_HEADERS)[number])) ||
    /^(?:Transaksjoner|Kontonummer\s*:|Søkekriterier|Etter dato|Før dato|Total beløp|Totalt beløp|Inngående saldo|Utgående\s+saldo)\b/i.test(text) ||
    text.toLowerCase().includes("rogaland sparebank");
}

function renderCells(cells: readonly string[][]): string {
  return cells.map((parts) => parts.join(" ").trim()).filter(Boolean).join(" ");
}

function renderPageText(lines: readonly PositionedTextLine[], pageNumber: number): string[] {
  const headerIndex = lines.findIndex((line) => findPdfColumnAnchors(line) !== null);
  if (headerIndex === -1) {
    return lines.map((line) => line.items.map((item) => item.text.trim()).filter(Boolean).join(" "));
  }

  const columns = findPdfColumnAnchors(lines[headerIndex]!);
  if (columns === null) return lines.map((line) => line.items.map((item) => item.text.trim()).join(" "));

  const rendered = [PDF_ROW_HEADERS.join(" ")];
  let currentCells: string[][] | undefined;
  const finishCurrentRow = (): void => {
    if (currentCells !== undefined) {
      rendered.push(renderCells(currentCells));
      currentCells = undefined;
    }
  };

  for (const line of lines.slice(headerIndex + 1)) {
    if (isDocumentDecoration(line)) {
      finishCurrentRow();
      continue;
    }

    const hasDate = line.items.some((item) => isTransactionDate(item.text));
    if (hasDate) {
      finishCurrentRow();
      currentCells = PDF_ROW_HEADERS.map(() => []);
      appendLineToCells(currentCells, line, columns);
      continue;
    }

    const firstItemX = line.items[0]?.x;
    if (
      currentCells !== undefined &&
      firstItemX !== undefined &&
      firstItemX >= columns[0]!.x + PDF_CONTINUATION_X_TOLERANCE
    ) {
      appendLineToCells(currentCells, line, columns);
    } else {
      finishCurrentRow();
      rendered.push(line.items.map((item) => item.text.trim()).filter(Boolean).join(" "));
    }
  }

  finishCurrentRow();
  return [`Transaksjoner ${pageNumber}`, ...rendered];
}

export async function extractPdfTextFromBuffer(data: Buffer): Promise<string> {
  if (data.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return data.toString("utf8");
  }

  const require = createRequire(import.meta.url);
  const pdfJsEntry = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = `${resolve(dirname(pdfJsEntry), "../../standard_fonts").replace(/\\/g, "/")}/`;
  const document = await getDocument({ data: new Uint8Array(data), standardFontDataUrl }).promise;

  try {
    const pageTexts: string[] = [];
    let hasRogalandSource = false;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const positionedItems = content.items.flatMap((item): PositionedTextItem[] => {
          if (!isTextItem(item) || item.str.trim().length === 0) return [];
          const [x, y] = viewport.convertToViewportPoint(item.transform[4] ?? 0, item.transform[5] ?? 0);
          return [{ text: item.str, x, y }];
        });

        if (positionedItems.some((item) => item.text.toUpperCase().includes("ROGALAND SPAREBANK"))) {
          hasRogalandSource = true;
        }
        pageTexts.push(...renderPageText(groupTextItemsByBaseline(positionedItems), pageNumber));
      } finally {
        page.cleanup();
      }
    }

    if (hasRogalandSource) return [`ROGALAND SPAREBANK`, ...pageTexts].join("\n");
    return pageTexts.join("\n");
  } finally {
    await document.destroy();
  }
}

export async function extractPdfTextFromFile(filePath: string): Promise<string> {
  return extractPdfTextFromBuffer(await readFile(filePath));
}
