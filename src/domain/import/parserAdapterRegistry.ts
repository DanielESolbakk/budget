import type { PendingTransactionObservation, Transaction } from "../types.js";
import {
  createTextSourceDocument,
  type SourceDocument,
  type SourceDocumentCapability,
} from "./sourceDocument.js";
import type {
  PdfTextExcludedRow,
  PdfTextParseBatchCallbacks,
  PdfTextParseOptions,
  PdfTextUnresolvedRow,
  PdfTextValidationError,
} from "./pdfTextParser.js";
import {
  isRogalandStatementText,
  parseRogalandStatementText,
  parseRogalandStatementTextInBatches,
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
  pendingObservations?: PendingTransactionObservation[];
  unresolvedRows?: PdfTextUnresolvedRow[];
  excludedRows?: PdfTextExcludedRow[];
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
  /** Capabilities required from a source document before this adapter is considered. */
  readonly requiredCapabilities?: readonly SourceDocumentCapability[];
  /** Returns true when this adapter recognises the source document. */
  canHandle(source: SourceDocument): boolean;
  /** Parses a source document into ordered transaction candidates. */
  parse(source: SourceDocument, options: PdfTextParseOptions): AdapterParseResult;
  /** Parses large sources in cancellable batches when the adapter supports it. */
  parseInBatches?: (
    source: SourceDocument,
    options: PdfTextParseOptions,
    callbacks: PdfTextParseBatchCallbacks
  ) => Promise<AdapterParseResult | null>;
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

  private toSourceDocument(source: string | SourceDocument): SourceDocument {
    return typeof source === "string" ? createTextSourceDocument(source) : source;
  }

  /** Registers an adapter. Adapters with identical ids are deduplicated (first registration wins). */
  register(adapter: ParserAdapter): void {
    if (!this.adapters.some((a) => a.id === adapter.id)) {
      this.adapters.push(adapter);
    }
  }

  /** Returns the registered adapter that can handle the text, or undefined when none match. */
  selectAdapter(source: string | SourceDocument): ParserAdapter | undefined {
    const document = this.toSourceDocument(source);
    return this.adapters.find((adapter) =>
      (adapter.requiredCapabilities ?? []).every((capability) => document.capabilities.includes(capability)) &&
      adapter.canHandle(document)
    );
  }

  /** Selects and runs the appropriate adapter, or returns an explicit unsupported-source failure. */
  parse(source: string | SourceDocument, options: PdfTextParseOptions): RegistryParseResult {
    const document = this.toSourceDocument(source);
    const adapter = this.selectAdapter(document);

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

    return adapter.parse(document, options);
  }

  async parseInBatches(
    source: string | SourceDocument,
    options: PdfTextParseOptions,
    callbacks: PdfTextParseBatchCallbacks
  ): Promise<RegistryParseResult | null> {
    const document = this.toSourceDocument(source);
    const adapter = this.selectAdapter(document);
    if (!adapter) {
      return {
        ok: false,
        adapterId: null,
        errors: [{
          code: "UNSUPPORTED_LAYOUT",
          message: "No registered adapter recognised the source text. Unsupported layout.",
        }],
      };
    }
    if (adapter.parseInBatches !== undefined) {
      return adapter.parseInBatches(document, options, callbacks);
    }
    const result = adapter.parse(document, options);
    callbacks.onProgress(1, 1);
    return result;
  }

  /** Returns the ids of all registered adapters in registration order. */
  registeredIds(): string[] {
    return this.adapters.map((a) => a.id);
  }
}

const rogalandAdapter: ParserAdapter = {
  id: ROGALAND_ADAPTER_ID,
  sourceIdentity: ROGALAND_SOURCE_ID,
  requiredCapabilities: ["plain-text"],
  canHandle(source: SourceDocument): boolean {
    return isRogalandStatementText(source.text);
  },
  parse(source: SourceDocument, options: PdfTextParseOptions): AdapterParseResult {
    const result = parseRogalandStatementText(source.text, options);
    if (result.ok) {
      return {
        ok: true,
        adapterId: result.adapterId,
        sourceIdentity: ROGALAND_SOURCE_ID,
        candidates: result.transactions,
        ...(result.pendingObservations === undefined
          ? {}
          : { pendingObservations: result.pendingObservations }),
        ...(result.unresolvedRows === undefined ? {} : { unresolvedRows: result.unresolvedRows }),
        ...(result.excludedRows === undefined ? {} : { excludedRows: result.excludedRows }),
      };
    }
    return { ok: false, adapterId: ROGALAND_ADAPTER_ID, errors: result.errors };
  },
  async parseInBatches(source, options, callbacks): Promise<AdapterParseResult | null> {
    const result = await parseRogalandStatementTextInBatches(source.text, options, callbacks);
    if (result === null) return null;
    if (result.ok) {
      return {
        ok: true,
        adapterId: result.adapterId,
        sourceIdentity: ROGALAND_SOURCE_ID,
        candidates: result.transactions,
        ...(result.pendingObservations === undefined
          ? {}
          : { pendingObservations: result.pendingObservations }),
        ...(result.unresolvedRows === undefined ? {} : { unresolvedRows: result.unresolvedRows }),
        ...(result.excludedRows === undefined ? {} : { excludedRows: result.excludedRows }),
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
