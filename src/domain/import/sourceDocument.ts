export type SourceDocumentFormat = "pdf" | "text";

export type SourceDocumentCapability =
  | "plain-text"
  | "ordered-pages"
  | "source-offsets"
  | "positioned-text"
  | "standalone-text"
  | "binary-pdf";

export interface SourceTextItemEvidence {
  text: string;
  x: number;
  y: number;
}

export type SourceTextLineClassification =
  | "document-metadata"
  | "column-header"
  | "transaction"
  | "continuation"
  | "document-decoration"
  | "unclassified";

export interface SourceTextLineEvidence {
  pageNumber: number;
  lineNumber: number;
  startOffset: number;
  endOffset: number;
  rawText: string;
  classification?: SourceTextLineClassification;
  items?: SourceTextItemEvidence[];
}

export interface SourceDocumentPage {
  pageNumber: number;
  text: string;
  sourceText: string;
  sourceLines: SourceTextLineEvidence[];
}

export interface SourceDocument {
  format: SourceDocumentFormat;
  text: string;
  capabilities: readonly SourceDocumentCapability[];
  pages: SourceDocumentPage[];
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
  return {
    format: "text",
    text,
    capabilities: ["plain-text", "ordered-pages", "source-offsets", "standalone-text"],
    pages: [{
      pageNumber: 1,
      text,
      sourceText: text,
      sourceLines: createTextSourceLines(text),
    }],
  };
}