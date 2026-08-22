import type { Transaction } from "../types.js";
import type { PdfTextParseOptions, PdfTextValidationError } from "./pdfTextParser.js";
import {
  isRogalandStatementText,
  parseRogalandStatementText,
  ROGALAND_ADAPTER_ID,
  ROGALAND_SOURCE_ID,
} from "./pdfTextParser.js";

/**
 * Discriminated result returned by a parser adapter.
 * On success: stable adapter id, source identity, and ordered transaction candidates.
 * On failure: explicit validation errors; no partial candidates.
 */
export interface AdapterParseSuccess {
  ok: true;
  adapterId: string;
  sourceIdentity: string;
  candidates: Transaction[];
}

export interface AdapterParseFailure {
  ok: false;
  adapterId: string;
  errors: PdfTextValidationError[];
}

export type AdapterParseResult = AdapterParseSuccess | AdapterParseFailure;

/**
 * Source-aware parser adapter contract.
 * Each adapter exposes a stable id, source identity, source probe, and parse method.
 */
export interface ParserAdapter {
  /** Stable, versioned adapter identifier. */
  readonly id: string;
  /** Stable identity for the source layout handled by this adapter. */
  readonly sourceIdentity: string;
  /** Returns true when this adapter recognises the source text. */
  canHandle(text: string): boolean;
  /** Parses the source text into ordered transaction candidates. */
  parse(text: string, options: PdfTextParseOptions): AdapterParseResult;
}

/**
 * UNSUPPORTED_SOURCE failure returned when no adapter recognises the input.
 */
export interface UnsupportedSourceFailure {
  ok: false;
  adapterId: null;
  errors: PdfTextValidationError[];
}

export type RegistryParseResult = AdapterParseResult | UnsupportedSourceFailure;

/**
 * Registry that maps source text to a registered adapter and dispatches parsing.
 * Adapters are evaluated in registration order; the first match wins.
 */
export class ParserAdapterRegistry {
  private readonly adapters: ParserAdapter[] = [];

  /** Registers an adapter. Adapters with identical ids are deduplicated (first registration wins). */
  register(adapter: ParserAdapter): void {
    if (!this.adapters.some((a) => a.id === adapter.id)) {
      this.adapters.push(adapter);
    }
  }

  /** Returns the registered adapter that can handle the text, or undefined when none match. */
  selectAdapter(text: string): ParserAdapter | undefined {
    return this.adapters.find((a) => a.canHandle(text));
  }

  /** Selects and runs the appropriate adapter, or returns an explicit unsupported-source failure. */
  parse(text: string, options: PdfTextParseOptions): RegistryParseResult {
    const adapter = this.selectAdapter(text);

    if (!adapter) {
      return {
        ok: false,
        adapterId: null,
        errors: [
          {
            code: "UNSUPPORTED_LAYOUT",
            message:
              "No registered adapter recognised the source text. Unsupported layout.",
          },
        ],
      };
    }

    return adapter.parse(text, options);
  }

  /** Returns the ids of all registered adapters in registration order. */
  registeredIds(): string[] {
    return this.adapters.map((a) => a.id);
  }
}

const rogalandAdapter: ParserAdapter = {
  id: ROGALAND_ADAPTER_ID,
  sourceIdentity: ROGALAND_SOURCE_ID,
  canHandle(text: string): boolean {
    return isRogalandStatementText(text);
  },
  parse(text: string, options: PdfTextParseOptions): AdapterParseResult {
    const result = parseRogalandStatementText(text, options);
    if (result.ok) {
      return {
        ok: true,
        adapterId: result.adapterId,
        sourceIdentity: ROGALAND_SOURCE_ID,
        candidates: result.transactions,
      };
    }
    return { ok: false, adapterId: ROGALAND_ADAPTER_ID, errors: result.errors };
  },
};

/**
 * Default registry with all bundled adapters pre-registered.
 * Import this singleton for production use; inject a fresh registry in tests.
 */
export const defaultParserAdapterRegistry = new ParserAdapterRegistry();
defaultParserAdapterRegistry.register(rogalandAdapter);
