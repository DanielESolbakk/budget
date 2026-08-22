/**
 * Unit tests for PDF parser determinism (AC-2 from issue #32).
 *
 * Verifies that identical input to the Rogaland adapter and the registry
 * produces identical ordered candidates and a stable adapter identity
 * across repeated runs.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultParserAdapterRegistry,
} from "../../src/domain/import/parserAdapterRegistry.js";
import { ROGALAND_ADAPTER_ID } from "../../src/domain/import/pdfTextParser.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";

const BASE_OPTIONS = {
  householdId: "hh-test",
  accountId: "acc-test",
  idPrefix: "det",
};

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

describe("PDF parser determinism", () => {
  describe("AC-2: identical input produces identical ordered candidates", () => {
    it("two parses of the same fixture produce equal candidate arrays", () => {
      const text = loadFixture();

      const r1 = defaultParserAdapterRegistry.parse(text, BASE_OPTIONS);
      const r2 = defaultParserAdapterRegistry.parse(text, BASE_OPTIONS);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);

      if (!r1.ok || !r2.ok) return;

      expect(r1.candidates).toEqual(r2.candidates);
    });

    it("candidate ordering is stable across repeated runs", () => {
      const text = loadFixture();

      const results = Array.from({ length: 3 }, () =>
        defaultParserAdapterRegistry.parse(text, BASE_OPTIONS)
      );

      for (const r of results) {
        expect(r.ok).toBe(true);
      }

      const first = results[0];
      if (!first?.ok) return;

      for (const r of results.slice(1)) {
        if (!r.ok) return;
        expect(r.candidates.map((c) => c.id)).toEqual(
          first.candidates.map((c) => c.id)
        );
      }
    });

    it("candidate bookedAtIso values are identical across runs", () => {
      const text = loadFixture();

      const r1 = defaultParserAdapterRegistry.parse(text, BASE_OPTIONS);
      const r2 = defaultParserAdapterRegistry.parse(text, BASE_OPTIONS);

      if (!r1.ok || !r2.ok) return;

      const dates1 = r1.candidates.map((c) => c.bookedAtIso);
      const dates2 = r2.candidates.map((c) => c.bookedAtIso);

      expect(dates1).toEqual(dates2);
    });
  });

  describe("AC-2: stable adapter identity", () => {
    it("adapter identity is the same across repeated parses", () => {
      const text = loadFixture();

      const r1 = defaultParserAdapterRegistry.parse(text, BASE_OPTIONS);
      const r2 = defaultParserAdapterRegistry.parse(text, BASE_OPTIONS);

      expect(r1.adapterId).toBe(ROGALAND_ADAPTER_ID);
      expect(r2.adapterId).toBe(ROGALAND_ADAPTER_ID);
    });

    it("adapter identity equals the canonical ROGALAND_ADAPTER_ID constant", () => {
      const text = loadFixture();
      const result = defaultParserAdapterRegistry.parse(text, BASE_OPTIONS);

      expect(result.adapterId).toBe(ROGALAND_ADAPTER_ID);
      expect(ROGALAND_ADAPTER_ID).toBe("rogaland-sparebank-text-v1");
    });
  });

  describe("AC-2: determinism with importJobId provenance", () => {
    it("provenance fields are identical when importJobId is provided", () => {
      const text = loadFixture();
      const opts = { ...BASE_OPTIONS, importJobId: "job-determinism-test" };

      const r1 = defaultParserAdapterRegistry.parse(text, opts);
      const r2 = defaultParserAdapterRegistry.parse(text, opts);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);

      if (!r1.ok || !r2.ok) return;

      const ids1 = r1.candidates.map((c) => c.importJobId);
      const ids2 = r2.candidates.map((c) => c.importJobId);

      expect(ids1).toEqual(ids2);
      expect(ids1.every((id) => id === "job-determinism-test")).toBe(true);
    });
  });
});
