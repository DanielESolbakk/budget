import type {
  SourceDocumentTextLineEvidence,
  SourceTextLineEvidence,
} from "../types.js";

export type {
  SourceDocumentTextLineEvidence,
  SourceTextLineClassification,
  SourceTextLineEvidence,
  SourceTextItemEvidence,
} from "../types.js";

export type SourceDocumentFormat = "pdf" | "text";
export type ImportStatementFileFormat = "csv" | "pdf" | "text";

export type SourceDocumentCapability =
  | "plain-text"
  | "ordered-pages"
  | "source-offsets"
  | "positioned-text"
  | "standalone-text"
  | "binary-pdf";

export interface SourceDocumentPage {
  pageNumber: number;
  text: string;
  sourceText: string;
  sourceLines: SourceTextLineEvidence[];
  textLineEvidence: SourceDocumentTextLineEvidence[];
}

export interface SourceDocument {
  format: SourceDocumentFormat;
  text: string;
  capabilities: readonly SourceDocumentCapability[];
  pages: SourceDocumentPage[];
  textLineEvidence: SourceDocumentTextLineEvidence[];
}

export function classifyImportFilePath(filePath: string): ImportStatementFileFormat | undefined {
  const fileName = filePath.trim().split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (fileName.endsWith(".csv")) return "csv";
  if (fileName.endsWith(".pdf")) return "pdf";
  if (fileName.endsWith(".txt")) return "text";
  return undefined;
}

function createTextSourceLines(sourceText: string): SourceTextLineEvidence[] {
  const sourceLines: SourceTextLineEvidence[] = [];
  let startOffset = 0;
  let lineNumber = 1;

  while (startOffset <= sourceText.length) {
    const newlineOffset = sourceText.indexOf("\n", startOffset);
    const rawEndOffset = newlineOffset === -1 ? sourceText.length : newlineOffset;
    const endOffset = rawEndOffset > startOffset && sourceText[rawEndOffset - 1] === "\r"
      ? rawEndOffset - 1
      : rawEndOffset;
    sourceLines.push({
      pageNumber: 1,
      lineNumber,
      startOffset,
      endOffset,
      rawText: sourceText.slice(startOffset, endOffset),
    });
    if (newlineOffset === -1) break;
    startOffset = newlineOffset + 1;
    lineNumber += 1;
  }

  return sourceLines;
}

export function createTextSourceDocument(text: string): SourceDocument {
  const sourceLines = createTextSourceLines(text);
  const textLineEvidence = sourceLines.map((sourceLine) => ({
    pageNumber: 1,
    sourceLines: [sourceLine],
  }));

  return {
    format: "text",
    text,
    capabilities: ["plain-text", "ordered-pages", "source-offsets", "standalone-text"],
    pages: [{
      pageNumber: 1,
      text,
      sourceText: text,
      sourceLines,
      textLineEvidence,
    }],
    textLineEvidence,
  };
}