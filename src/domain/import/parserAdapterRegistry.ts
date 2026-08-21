import {
  isRogalandStatementText,
  parseRogalandStatementText,
  ROGALAND_ADAPTER_ID,
  ROGALAND_SOURCE_ID,
  type PdfTextParseResult,
  type PdfTextParseOptions,
  type PdfTextValidationError,
} from "./pdfTextParser.js";
import type { Transaction } from "../types.js";

export interface ParserAdapterParseSuccess {
  ok: true;
  adapterId: string;
  sourceIdentity: string;
  transactions: Transaction[];
}

export interface ParserAdapterParseFailure {
  ok: false;
  errors: PdfTextValidationError[];
}

export type ParserAdapterParseResult = ParserAdapterParseSuccess | ParserAdapterParseFailure;

interface PdfParserAdapter {
  adapterId: string;
  sourceIdentity: string;
  supports: (text: string) => boolean;
  parse: (text: string, options: PdfTextParseOptions) => PdfTextParseResult;
}

const PDF_PARSER_ADAPTERS: readonly PdfParserAdapter[] = [
  {
    adapterId: ROGALAND_ADAPTER_ID,
    sourceIdentity: ROGALAND_SOURCE_ID,
    supports: isRogalandStatementText,
    parse: parseRogalandStatementText,
  },
] as const;

export function getPdfParserAdapters(): readonly PdfParserAdapter[] {
  return PDF_PARSER_ADAPTERS;
}

export function parsePdfStatementWithRegisteredAdapter(
  text: string,
  options: PdfTextParseOptions
): ParserAdapterParseResult {
  const adapter = PDF_PARSER_ADAPTERS.find((candidate) => candidate.supports(text));

  if (!adapter) {
    return {
      ok: false,
      errors: [
        {
          code: "UNSUPPORTED_LAYOUT",
          message: "Statement text does not match any registered parser adapter.",
        },
      ],
    };
  }

  const parsed = adapter.parse(text, options);

  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    adapterId: adapter.adapterId,
    sourceIdentity: adapter.sourceIdentity,
    transactions: parsed.transactions,
  };
}
