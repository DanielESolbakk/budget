/**
 * Integration tests for the import job / parser adapter contract (AC-1, AC-2, AC-3 from issue #32).
 *
 * These tests exercise the full chain: fixture text → registry → AdapterParseResult →
 * ImportJob construction, verifying that provenance propagates end-to-end and
 * that failure paths produce explicit errors with no partial candidates.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultParserAdapterRegistry,
  ParserAdapterRegistry,
} from "../../src/domain/import/parserAdapterRegistry.js";
import { ROGALAND_ADAPTER_ID } from "../../src/domain/import/pdfTextParser.js";
import type { ImportJob } from "../../src/domain/types.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";

const BASE_OPTIONS = {
  householdId: "hh-integration",
  accountId: "acc-integration",
};

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

/** Builds an ImportJob from a successful parse result (simulates what main.ts does). */
function buildImportJobFromParse(
  importJobId: string,
  sourceName: string,
  householdId: string,
  adapterId: string,
  candidateCount: number
): ImportJob {
  const now = new Date().toISOString();
  return {
    id: importJobId,
    householdId,
    sourceType: "pdf",
    sourceName,
    adapterId,
    candidateCount,
    validationFailureCount: 0,
    startedAtIso: now,
    finishedAtIso: now,
  };
}

describe("import job / parser adapter contract", () => {
  describe("AC-1: import job carries full provenance", () => {
    it("import job records source identity from fixture parse", () => {
      const text = loadFixture();
      const importJobId = "job-contract-test-1";

      const parseResult = defaultParserAdapterRegistry.parse(text, {
        ...BASE_OPTIONS,
        importJobId,
        idPrefix: importJobId,
      });

      expect(parseResult.ok).toBe(true);
      if (!parseResult.ok) return;

      const job = buildImportJobFromParse(
        importJobId,
        FIXTURE_PATH,
        BASE_OPTIONS.householdId,
        parseResult.adapterId,
        parseResult.candidates.length
      );

      expect(job.sourceType).toBe("pdf");
      expect(job.sourceName).toBe(FIXTURE_PATH);
      expect(job.householdId).toBe("hh-integration");
    });

    it("import job records adapter identity from parse result", () => {
      const text = loadFixture();
      const importJobId = "job-contract-test-2";

      const parseResult = defaultParserAdapterRegistry.parse(text, {
        ...BASE_OPTIONS,
        importJobId,
      });

      expect(parseResult.ok).toBe(true);
      if (!parseResult.ok) return;

      const job = buildImportJobFromParse(
        importJobId,
        FIXTURE_PATH,
        BASE_OPTIONS.householdId,
        parseResult.adapterId,
        parseResult.candidates.length
      );

      expect(job.adapterId).toBe(ROGALAND_ADAPTER_ID);
    });

    it("import job candidate count matches parse result", () => {
      const text = loadFixture();
      const importJobId = "job-contract-test-3";

      const parseResult = defaultParserAdapterRegistry.parse(text, {
        ...BASE_OPTIONS,
        importJobId,
      });

      expect(parseResult.ok).toBe(true);
      if (!parseResult.ok) return;

      const job = buildImportJobFromParse(
        importJobId,
        FIXTURE_PATH,
        BASE_OPTIONS.householdId,
        parseResult.adapterId,
        parseResult.candidates.length
      );

      expect(job.candidateCount).toBe(parseResult.candidates.length);
      expect(job.candidateCount).toBeGreaterThan(0);
    });

    it("all candidates carry importJobId provenance", () => {
      const text = loadFixture();
      const importJobId = "job-provenance-check";

      const parseResult = defaultParserAdapterRegistry.parse(text, {
        ...BASE_OPTIONS,
        importJobId,
      });

      expect(parseResult.ok).toBe(true);
      if (!parseResult.ok) return;

      for (const candidate of parseResult.candidates) {
        expect(candidate.importJobId).toBe(importJobId);
        expect(candidate.bookedAtIso).toMatch(ISO_DATETIME_PATTERN);
        expect(Number.isInteger(candidate.amountMinor)).toBe(true);
      }
    });
  });

  describe("AC-2: determinism across repeated registry parses", () => {
    it("two registry parses of the fixture produce equal candidate lists", () => {
      const text = loadFixture();
      const opts = { ...BASE_OPTIONS, idPrefix: "det" };

      const r1 = defaultParserAdapterRegistry.parse(text, opts);
      const r2 = defaultParserAdapterRegistry.parse(text, opts);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);

      if (!r1.ok || !r2.ok) return;

      expect(r1.candidates).toEqual(r2.candidates);
      expect(r1.adapterId).toBe(r2.adapterId);
    });
  });

  describe("AC-3: malformed and unsupported sources produce explicit failures", () => {
    it("unsupported source returns failure with no candidates and UNSUPPORTED_LAYOUT code", () => {
      const registry = new ParserAdapterRegistry();
      const result = registry.parse("irrelevant content", BASE_OPTIONS);

      expect(result.ok).toBe(false);
      expect(result.adapterId).toBeNull();
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
      expect((result as { candidates?: unknown }).candidates).toBeUndefined();
    });

    it("Rogaland statement with missing transaction section returns failure", () => {
      const noTransactions = "ROGALAND SPAREBANK\nKontonummer: 1234\n";
      const result = defaultParserAdapterRegistry.parse(noTransactions, BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.length).toBeGreaterThan(0);
      expect((result as { candidates?: unknown }).candidates).toBeUndefined();
    });

    it("default registry parse of unsupported text has null adapterId", () => {
      const result = defaultParserAdapterRegistry.parse(
        "NOT A BANK STATEMENT",
        BASE_OPTIONS
      );

      expect(result.ok).toBe(false);
      expect(result.adapterId).toBeNull();
    });
  });
});
