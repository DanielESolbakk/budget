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
import { ROGALAND_ADAPTER_ID } from "../../src/domain/import/pdfTextParser.js";

const BASE_OPTIONS = {
  householdId: "hh-test",
  accountId: "acc-test",
};

describe("ParserAdapterRegistry", () => {
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
        canHandle: (text) => text.includes("TOKEN_A"),
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
        canHandle: (text) => text.includes("TOKEN_B"),
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

  describe("AC-3: malformed recognized source returns adapter validation errors", () => {
    it("forwards malformed Rogaland input without partial candidates", () => {
      const result = defaultParserAdapterRegistry.parse(
        [
          "ROGALAND SPAREBANK",
          "Dato         Beskrivelse                              Beløp          Saldo",
          "27.05.2026   MERCHANT-INVALID                         invalid-amount  75 000,00",
        ].join("\n"),
        BASE_OPTIONS
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.adapterId).toBe(ROGALAND_ADAPTER_ID);
      expect(result.errors[0]?.code).toBe("INVALID_AMOUNT_FORMAT");
      expect((result as { candidates?: unknown }).candidates).toBeUndefined();
    });

    it("rejects a date-like row with an unsupported date format instead of skipping it", () => {
      const result = defaultParserAdapterRegistry.parse(
        [
          "ROGALAND SPAREBANK",
          "Dato         Beskrivelse                              Beløp          Saldo",
          "27.05.2026   VALID                                  +1,00       1,00",
          "2026-05-27   MALFORMED DATE                         +2,00       3,00",
        ].join("\n"),
        BASE_OPTIONS
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("INVALID_DATE_FORMAT");
    });
  });

  describe("default registry", () => {
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
