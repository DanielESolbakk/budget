import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createTextSourceDocument } from "../../domain/import/sourceDocument.js";
import type {
  SourceDocument,
  SourceDocumentPage,
  SourceDocumentFormat,
  SourceDocumentTextLineEvidence,
  SourceTextLineClassification,
  SourceTextLineEvidence,
} from "../../domain/import/sourceDocument.js";

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

interface RenderedPdfTextLine {
  text: string;
  sourceLineIndexes: number[];
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

function renderPageText(lines: readonly PositionedTextLine[], pageNumber: number): RenderedPdfTextLine[] {
  const headerIndex = lines.findIndex((line) => findPdfColumnAnchors(line) !== null);
  if (headerIndex === -1) {
    return lines.map((line, sourceLineIndex) => ({
      text: line.items.map((item) => item.text.trim()).filter(Boolean).join(" "),
      sourceLineIndexes: [sourceLineIndex],
    }));
  }

  const columns = findPdfColumnAnchors(lines[headerIndex]!);
  if (columns === null) {
    return lines.map((line, sourceLineIndex) => ({
      text: line.items.map((item) => item.text.trim()).join(" "),
      sourceLineIndexes: [sourceLineIndex],
    }));
  }

  const rendered: RenderedPdfTextLine[] = [
    { text: `Transaksjoner ${pageNumber}`, sourceLineIndexes: [] },
    { text: PDF_ROW_HEADERS.join(" "), sourceLineIndexes: [headerIndex] },
  ];
  let currentCells: string[][] | undefined;
  let currentSourceLineIndexes: number[] | undefined;
  const finishCurrentRow = (): void => {
    if (currentCells !== undefined) {
      rendered.push({
        text: renderCells(currentCells),
        sourceLineIndexes: currentSourceLineIndexes ?? [],
      });
      currentCells = undefined;
      currentSourceLineIndexes = undefined;
    }
  };

  for (const [offset, line] of lines.slice(headerIndex + 1).entries()) {
    const sourceLineIndex = headerIndex + offset + 1;
    if (isDocumentDecoration(line)) {
      finishCurrentRow();
      continue;
    }

    const hasDate = line.items.some((item) => isTransactionDate(item.text));
    if (hasDate) {
      finishCurrentRow();
      currentCells = PDF_ROW_HEADERS.map(() => []);
      currentSourceLineIndexes = [sourceLineIndex];
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
      currentSourceLineIndexes?.push(sourceLineIndex);
    } else {
      finishCurrentRow();
      rendered.push({
        text: line.items.map((item) => item.text.trim()).filter(Boolean).join(" "),
        sourceLineIndexes: [sourceLineIndex],
      });
    }
  }

  finishCurrentRow();
  return rendered;
}

function classifySourceLines(
  lines: readonly PositionedTextLine[]
): SourceTextLineClassification[] {
  const tableHeaderIndex = lines.findIndex((line) => findPdfColumnAnchors(line) !== null);
  const columns = tableHeaderIndex === -1 ? null : findPdfColumnAnchors(lines[tableHeaderIndex]!);
  let transactionActive = false;

  return lines.map((line, lineIndex) => {
    if (findPdfColumnAnchors(line) !== null) {
      transactionActive = false;
      return "column-header";
    }
    if (isDocumentDecoration(line)) {
      transactionActive = false;
      return "document-decoration";
    }
    if (line.items.some((item) => isTransactionDate(item.text))) {
      transactionActive = true;
      return "transaction";
    }

    const firstItemX = line.items[0]?.x;
    if (
      lineIndex > tableHeaderIndex &&
      transactionActive &&
      columns !== null &&
      firstItemX !== undefined &&
      firstItemX >= columns[0]!.x + PDF_CONTINUATION_X_TOLERANCE
    ) {
      return "continuation";
    }

    transactionActive = false;
    return tableHeaderIndex === -1 || lineIndex < tableHeaderIndex
      ? "document-metadata"
      : "unclassified";
  });
}

function createPdfSourcePage(
  pageNumber: number,
  lines: readonly PositionedTextLine[]
): SourceDocumentPage {
  const sourceLineTexts = lines.map((line) =>
    line.items.map((item) => item.text.trim()).filter(Boolean).join(" ")
  );
  const sourceText = sourceLineTexts.join("\n");
  const classifications = classifySourceLines(lines);
  let startOffset = 0;
  const sourceLines = lines.map((line, index): SourceTextLineEvidence => {
    const rawText = sourceLineTexts[index] ?? "";
    const endOffset = startOffset + rawText.length;
    const sourceLine: SourceTextLineEvidence = {
      pageNumber,
      lineNumber: index + 1,
      startOffset,
      endOffset,
      rawText,
      classification: classifications[index] ?? "unclassified",
      items: line.items.map(({ text, x, y }) => ({ text: text.trim(), x, y })),
    };
    startOffset = endOffset + 1;
    return sourceLine;
  });
  const renderedLines = renderPageText(lines, pageNumber);
  const textLineEvidence: SourceDocumentTextLineEvidence[] = renderedLines.map(({ sourceLineIndexes }) => ({
    pageNumber,
    sourceLines: sourceLineIndexes.flatMap((sourceLineIndex) => {
      const sourceLine = sourceLines[sourceLineIndex];
      return sourceLine === undefined ? [] : [sourceLine];
    }),
  }));

  return {
    pageNumber,
    text: renderedLines.map(({ text }) => text).join("\n"),
    sourceText,
    sourceLines,
    textLineEvidence,
  };
}

export async function extractSourceDocumentFromBuffer(
  data: Buffer,
  expectedFormat?: SourceDocumentFormat
): Promise<SourceDocument> {
  const isBinaryPdf = data.subarray(0, 5).toString("ascii") === "%PDF-";
  if (expectedFormat === "pdf" && !isBinaryPdf) {
    throw new Error("The selected .pdf file does not have a valid PDF signature.");
  }
  if (expectedFormat === "text" && isBinaryPdf) {
    throw new Error("The selected .txt file contains PDF data. Choose the .pdf file instead.");
  }
  if (!isBinaryPdf) {
    return createTextSourceDocument(data.toString("utf8"));
  }

  const require = createRequire(import.meta.url);
  const pdfJsEntry = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = `${resolve(dirname(pdfJsEntry), "../../standard_fonts").replace(/\\/g, "/")}/`;
  const document = await getDocument({ data: new Uint8Array(data), standardFontDataUrl }).promise;

  try {
    const pages: SourceDocumentPage[] = [];
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
        pages.push(createPdfSourcePage(pageNumber, groupTextItemsByBaseline(positionedItems)));
      } finally {
        page.cleanup();
      }
    }

    const pageText = pages.flatMap((page) => page.text.split("\n"));
    const textLineEvidence = pages.flatMap((page) => page.textLineEvidence);
    if (hasRogalandSource) {
      textLineEvidence.unshift({ pageNumber: 1, sourceLines: [] });
    }
    const text = hasRogalandSource
      ? [`ROGALAND SPAREBANK`, ...pageText].join("\n")
      : pageText.join("\n");

    return {
      format: "pdf",
      text,
      capabilities: ["plain-text", "ordered-pages", "source-offsets", "positioned-text", "binary-pdf"],
      pages,
      textLineEvidence,
    };
  } finally {
    await document.destroy();
  }
}

export async function extractPdfTextFromBuffer(
  data: Buffer,
  expectedFormat?: SourceDocumentFormat
): Promise<string> {
  return (await extractSourceDocumentFromBuffer(data, expectedFormat)).text;
}

export async function extractPdfTextFromFile(filePath: string): Promise<string> {
  return extractPdfTextFromBuffer(await readFile(filePath), "pdf");
}
