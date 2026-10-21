/**
 * Unit tests for the parser adapter registry (AC-3 from issue #32).
 *
 * Verifies that:
 * - Adapter registration and selection are deterministic.
 * - Unsupported source text returns an explicit UNSUPPORTED_LAYOUT error without candidates.
 * - Malformed content is forwarded to the adapter which returns validation failures.
 * - The default registry includes the Rogaland adapter.
 */

import { describe, expect, it } from "vitest";
import {
  ParserAdapterRegistry,
  defaultParserAdapterRegistry,
  type ParserAdapter,
} from "../../src/domain/import/parserAdapterRegistry.js";
import {
  createTextSourceDocument,
  type SourceDocument,
} from "../../src/domain/import/sourceDocument.js";
import { ROGALAND_ADAPTER_ID } from "../../src/domain/import/pdfTextParser.js";

const BASE_OPTIONS = {
  householdId: "hh-test",
  accountId: "acc-test",
};

describe("ParserAdapterRegistry", () => {
  it("selects a stable adapter only when the source provides its required capabilities", () => {
    const registry = new ParserAdapterRegistry();
    const textOnlyAdapter = {
      id: "bank-b-text-v1",
      sourceIdentity: "no.bank-b.statement-text",
      requiredCapabilities: ["standalone-text"] as const,
      canHandle: (source: SourceDocument) => source.text.includes("BANK-B"),
      parse: () => ({
        ok: true as const,
        adapterId: "bank-b-text-v1",
        sourceIdentity: "no.bank-b.statement-text",
        candidates: [],
      }),
    };
    const positionedPdfAdapter = {
      id: "bank-b-positioned-v1",
      sourceIdentity: "no.bank-b.statement-pdf",
      requiredCapabilities: ["positioned-text"] as const,
      canHandle: (source: SourceDocument) => source.text.includes("BANK-B"),
      parse: () => ({
        ok: true as const,
        adapterId: "bank-b-positioned-v1",
        sourceIdentity: "no.bank-b.statement-pdf",
        candidates: [],
      }),
    };
    registry.register(textOnlyAdapter);
    registry.register(positionedPdfAdapter);

    const textResult = registry.parse(createTextSourceDocument("BANK-B statement"), BASE_OPTIONS);
    expect(textResult).toMatchObject({
      ok: true,
      adapterId: "bank-b-text-v1",
      sourceIdentity: "no.bank-b.statement-text",
    });

    const source: SourceDocument = {
      format: "pdf",
      text: "BANK-B statement",
      capabilities: ["plain-text", "ordered-pages", "source-offsets", "positioned-text"],
      pages: [{ pageNumber: 1, text: "BANK-B statement", sourceText: "BANK-B statement", sourceLines: [] }],
    };

    const result = registry.parse(source, BASE_OPTIONS);

    expect(result).toMatchObject({
      ok: true,
      adapterId: "bank-b-positioned-v1",
      sourceIdentity: "no.bank-b.statement-pdf",
    });
  });

  it("does not select a recognizable adapter when a required source capability is missing", () => {
    const registry = new ParserAdapterRegistry();
    registry.register({
      id: "bank-b-positioned-v1",
      sourceIdentity: "no.bank-b.statement-pdf",
      requiredCapabilities: ["positioned-text"],
      canHandle: (source) => source.text.includes("BANK-B"),
      parse: () => ({
        ok: true,
        adapterId: "bank-b-positioned-v1",
        sourceIdentity: "no.bank-b.statement-pdf",
        candidates: [],
      }),
    });
    const source: SourceDocument = {
      format: "pdf",
      text: "BANK-B statement",
      capabilities: ["plain-text", "ordered-pages", "source-offsets"],
      pages: [{ pageNumber: 1, text: "BANK-B statement", sourceText: "BANK-B statement", sourceLines: [] }],
    };

    const result = registry.parse(source, BASE_OPTIONS);

    expect(result).toMatchObject({
      ok: false,
      adapterId: null,
      errors: [{ code: "UNSUPPORTED_LAYOUT" }],
    });
  });

  it("forwards progress through the selected adapter's batched parse", async () => {
    const registryWithBatches = defaultParserAdapterRegistry as unknown as {
      parseInBatches?: (
        text: string,
        options: typeof BASE_OPTIONS,
        callbacks: {
          batchSize: number;
          isCancelled: () => boolean;
          onProgress: (completedRows: number, totalRows: number) => void;
        }
      ) => Promise<unknown>;
    };
    const progress: Array<[number, number]> = [];
    const text = [
      "ROGALAND SPAREBANK",
      "Dato         Beskrivelse                              Beløp          Saldo",
      "28.05.2026   FIRST SHOP                                -1,00         10,00",
      "30.05.2026   LATER SHOP                                -2,00         11,00",
    ].join("\n");

    const result = await registryWithBatches.parseInBatches?.(text, BASE_OPTIONS, {
      batchSize: 1,
      isCancelled: () => false,
      onProgress: (completedRows, totalRows) => progress.push([completedRows, totalRows]),
    });

    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(result).toMatchObject({
      ok: true,
      adapterId: ROGALAND_ADAPTER_ID,
      sourceIdentity: "no.rogaland-sparebank.statement-text",
    });
  });

  describe("registration", () => {
    it("registers an adapter and lists its id", () => {
      const registry = new ParserAdapterRegistry();
      const stub: ParserAdapter = {
        id: "stub-v1",
        sourceIdentity: "stub-source",
        canHandle: () => true,
        parse: () => ({
          ok: true,
          adapterId: "stub-v1",
          sourceIdentity: "stub-source",
          candidates: [],
        }),
      };

      registry.register(stub);
      expect(registry.registeredIds()).toContain("stub-v1");
    });

    it("deduplicates adapters with identical ids", () => {
      const registry = new ParserAdapterRegistry();
      const stub: ParserAdapter = {
        id: "dup-v1",
        sourceIdentity: "duplicate-source",
        canHandle: () => true,
        parse: () => ({
          ok: true,
          adapterId: "dup-v1",
          sourceIdentity: "duplicate-source",
          candidates: [],
        }),
      };

      registry.register(stub);
      registry.register(stub);
      expect(registry.registeredIds().filter((id) => id === "dup-v1")).toHaveLength(1);
    });
  });

  describe("selectAdapter", () => {
    it("returns the first adapter whose canHandle returns true", () => {
      const registry = new ParserAdapterRegistry();
      const a: ParserAdapter = {
        id: "a-v1",
        sourceIdentity: "source-a",
        canHandle: (source) => source.text.includes("TOKEN_A"),
        parse: () => ({
          ok: true,
          adapterId: "a-v1",
          sourceIdentity: "source-a",
          candidates: [],
        }),
      };
      const b: ParserAdapter = {
        id: "b-v1",
        sourceIdentity: "source-b",
        canHandle: (source) => source.text.includes("TOKEN_B"),
        parse: () => ({
          ok: true,
          adapterId: "b-v1",
          sourceIdentity: "source-b",
          candidates: [],
        }),
      };

      registry.register(a);
      registry.register(b);

      expect(registry.selectAdapter("TOKEN_A document")?.id).toBe("a-v1");
      expect(registry.selectAdapter("TOKEN_B document")?.id).toBe("b-v1");
    });

    it("returns undefined when no adapter matches", () => {
      const registry = new ParserAdapterRegistry();
      expect(registry.selectAdapter("unrecognised source")).toBeUndefined();
    });
  });

  describe("AC-3: unsupported source returns UNSUPPORTED_LAYOUT without candidates", () => {
    it("returns ok: false with UNSUPPORTED_LAYOUT when no adapter matches", () => {
      const registry = new ParserAdapterRegistry();
      const result = registry.parse("completely unknown statement format", BASE_OPTIONS);

      expect(result.ok).toBe(false);
      expect(result.adapterId).toBeNull();
      if (result.ok) return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
    });

    it("does not produce partial candidates for unsupported source", () => {
      const registry = new ParserAdapterRegistry();
      const result = registry.parse("not a bank statement", BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // No candidates field on failure
      expect((result as { candidates?: unknown }).candidates).toBeUndefined();
    });
  });

  describe("AC-3: malformed recognized source returns reviewable rows", () => {
    it("forwards valid candidates and malformed rows through the adapter", () => {
      const result = defaultParserAdapterRegistry.parse(
        [
          "ROGALAND SPAREBANK",
          "Dato         Beskrivelse                              Beløp          Saldo",
          "27.05.2026   MERCHANT-INVALID                         invalid-amount  75 000,00",
        ].join("\n"),
        BASE_OPTIONS
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.adapterId).toBe(ROGALAND_ADAPTER_ID);
      expect(result.candidates).toHaveLength(0);
      expect(result.unresolvedRows).toEqual([
        expect.objectContaining({
          lineNumber: 3,
          rawRow: expect.stringContaining("invalid-amount"),
          errors: [expect.objectContaining({ code: "INVALID_AMOUNT_FORMAT" })],
        }),
      ]);
    });

    it("retains a date-like row with an unsupported date format beside valid candidates", () => {
      const result = defaultParserAdapterRegistry.parse(
        [
          "ROGALAND SPAREBANK",
          "Dato         Beskrivelse                              Beløp          Saldo",
          "27.05.2026   VALID                                  +1,00       1,00",
          "2026-05-27   MALFORMED DATE                         +2,00       3,00",
        ].join("\n"),
        BASE_OPTIONS
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candidates).toHaveLength(1);
      expect(result.unresolvedRows).toEqual([
        expect.objectContaining({
          rawRow: expect.stringContaining("2026-05-27"),
          errors: [expect.objectContaining({ code: "INVALID_DATE_FORMAT" })],
        }),
      ]);
    });
  });

  describe("default registry", () => {
    it("preserves excluded bank-export statuses through the adapter", () => {
      const text = [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 3",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "29.05.2026 Varekjøp ACCT-001 SYNTHETIC -45,00 NOK Reservert SYNTHETIC TRANSIT",
        "29.05.2026 Betaling ACCT-001 SYNTHETIC -350,00 NOK Bekreftet SYNTHETIC BILL",
        "28.05.2026 Varekjøp ACCT-001 SYNTHETIC -20,00 NOK Bokført SYNTHETIC SHOP",
      ].join("\n");

      const result = defaultParserAdapterRegistry.parse(text, BASE_OPTIONS);

      expect(result).toMatchObject({
        ok: true,
        candidates: [{ merchantRaw: "SYNTHETIC SHOP" }],
        excludedRows: [{ status: "Reservert" }, { status: "Bekreftet" }],
      });
    });

    it("includes the Rogaland adapter", () => {
      expect(defaultParserAdapterRegistry.registeredIds()).toContain(ROGALAND_ADAPTER_ID);
    });

    it("selects the Rogaland adapter for Rogaland statement text", () => {
      const adapter = defaultParserAdapterRegistry.selectAdapter(
        "ROGALAND SPAREBANK\nKontonummer: 1234"
      );
      expect(adapter?.id).toBe(ROGALAND_ADAPTER_ID);
    });

    it("returns ok: false for non-Rogaland text", () => {
      const result = defaultParserAdapterRegistry.parse(
        "ANOTHER BANK\nKontonummer: 9999",
        BASE_OPTIONS
      );
      expect(result.ok).toBe(false);
    });
  });
});
