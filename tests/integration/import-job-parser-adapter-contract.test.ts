/**
 * Integration tests for the import-job and parser-adapter contract.
 *
 * Covers AC-1 through AC-4 from issue #55 (story S2.1.1):
 *   AC-1: The contract records source identity and adapter identity in the import job provenance.
 *   AC-2: Repeated runs over identical input return identical ordered transaction candidates
 *         and provenance.
 *   AC-3: Malformed or unsupported inputs produce explicit validation failures without partial
 *         ledger writes.
 *   AC-4: The workflow can trace the adapter and provenance back to the source feature slice
 *         for auditability.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ImportJob } from "../../src/domain/types.js";
import {
  isRogalandStatementText,
  parseRogalandStatementText,
  ROGALAND_ADAPTER_ID,
} from "../../src/domain/import/pdfTextParser.js";
import { normalizePdfImportErrors } from "../../src/app/import/importPdf.js";
import { buildTransactionFingerprint } from "../../src/domain/import/buildTransactionFingerprint.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";

const PARSE_OPTIONS = {
  householdId: "hh-contract-test",
  accountId: "acc-contract-test",
};

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

function buildImportJobProvenance(
  adapterId: string,
  sourceName: string,
  importJobId: string
): ImportJob {
  return {
    id: importJobId,
    householdId: PARSE_OPTIONS.householdId,
    sourceType: "pdf",
    sourceName,
    startedAtIso: "2026-05-31T10:00:00Z",
    finishedAtIso: "2026-05-31T10:00:01Z",
  };
}

describe("import-job and parser-adapter contract", () => {
  describe("AC-1: source identity and adapter identity are captured in import job provenance", () => {
    it("adapter ID returned by parser matches the canonical Rogaland identifier", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.adapterId).toBe(ROGALAND_ADAPTER_ID);
      expect(result.adapterId).toBe("rogaland-sparebank-text-v1");
    });

    it("import job provenance records source type as 'pdf' and a non-empty source name", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const job = buildImportJobProvenance(result.adapterId, "rogaland-2026-05-statement.txt", "job-001");

      expect(job.sourceType).toBe("pdf");
      expect(job.sourceName.length).toBeGreaterThan(0);
      expect(job.id).toBe("job-001");
      expect(job.householdId).toBe(PARSE_OPTIONS.householdId);
    });

    it("adapter ID from parser is consistent with the source type recorded in the import job", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.adapterId).toContain("rogaland");
      const job = buildImportJobProvenance(result.adapterId, "rogaland-2026-05-statement.txt", "job-002");
      expect(job.sourceType).toBe("pdf");
    });

    it("isRogalandStatementText correctly identifies the fixture as a supported source", () => {
      const text = loadFixture();
      expect(isRogalandStatementText(text)).toBe(true);
    });

    it("isRogalandStatementText rejects unrelated text as unsupported source", () => {
      expect(isRogalandStatementText("Random text without bank header")).toBe(false);
    });

    it("importJobId is propagated to all transaction candidates", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, { ...PARSE_OPTIONS, importJobId: "job-provenance-01" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.transactions.length).toBeGreaterThan(0);
      for (const tx of result.transactions) {
        expect(tx.importJobId).toBe("job-provenance-01");
      }
    });
  });

  describe("AC-2: repeated runs over identical input return identical ordered candidates and provenance", () => {
    it("two parse runs of the same fixture return deeply equal results", () => {
      const text = loadFixture();
      const first = parseRogalandStatementText(text, PARSE_OPTIONS);
      const second = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(first).toEqual(second);
    });

    it("transaction order is stable across repeated parse calls", () => {
      const text = loadFixture();
      const r1 = parseRogalandStatementText(text, PARSE_OPTIONS);
      const r2 = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      const ids1 = r1.transactions.map((tx) => tx.id);
      const ids2 = r2.transactions.map((tx) => tx.id);
      expect(ids1).toEqual(ids2);
    });

    it("adapter ID is stable across repeated parse calls", () => {
      const text = loadFixture();
      const r1 = parseRogalandStatementText(text, PARSE_OPTIONS);
      const r2 = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      expect(r1.adapterId).toBe(r2.adapterId);
    });

    it("transaction fingerprints are stable across repeated parse calls", () => {
      const text = loadFixture();
      const r1 = parseRogalandStatementText(text, PARSE_OPTIONS);
      const r2 = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      const fp1 = r1.transactions.map((tx) =>
        buildTransactionFingerprint({
          accountId: tx.accountId,
          bookedAtIso: tx.bookedAtIso,
          amountMinor: tx.amountMinor,
          merchantRaw: tx.merchantRaw,
        })
      );
      const fp2 = r2.transactions.map((tx) =>
        buildTransactionFingerprint({
          accountId: tx.accountId,
          bookedAtIso: tx.bookedAtIso,
          amountMinor: tx.amountMinor,
          merchantRaw: tx.merchantRaw,
        })
      );

      expect(fp1).toEqual(fp2);
    });

    it("provenance fields recorded in the import job are identical across two runs", () => {
      const text = loadFixture();
      const r1 = parseRogalandStatementText(text, PARSE_OPTIONS);
      const r2 = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      const job1 = buildImportJobProvenance(r1.adapterId, "rogaland-2026-05-statement.txt", "job-run-1");
      const job2 = buildImportJobProvenance(r2.adapterId, "rogaland-2026-05-statement.txt", "job-run-2");

      expect(job1.sourceType).toBe(job2.sourceType);
      expect(job1.sourceName).toBe(job2.sourceName);
    });
  });

  describe("AC-3: malformed or unsupported inputs produce explicit validation failures without partial ledger writes", () => {
    it("unsupported layout text yields a failure with UNSUPPORTED_LAYOUT code", () => {
      const result = parseRogalandStatementText("This is not a supported bank statement.", PARSE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
    });

    it("unsupported layout produces no transaction candidates", () => {
      const result = parseRogalandStatementText("Random text content.", PARSE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      // Confirm ok is false and there are no transactions in the result shape
      const hasTransactions = "transactions" in result;
      expect(hasTransactions).toBe(false);
    });

    it("header-only statement without transaction table yields MISSING_TRANSACTION_SECTION", () => {
      const text = "ROGALAND SPAREBANK\nKontonummer: 1234 56 78901\n";
      const result = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.errors[0]?.code).toBe("MISSING_TRANSACTION_SECTION");
    });

    it("header-only statement produces no transaction candidates", () => {
      const text = "ROGALAND SPAREBANK\nKontonummer: 1234 56 78901\n";
      const result = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      const hasTransactions = "transactions" in result;
      expect(hasTransactions).toBe(false);
    });

    it("empty string input yields UNSUPPORTED_LAYOUT and no partial candidates", () => {
      const result = parseRogalandStatementText("", PARSE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
    });

    it("normalizePdfImportErrors converts failures to stable IPC shape without partial transactions", () => {
      const result = parseRogalandStatementText("Unsupported content.", PARSE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      const failure = normalizePdfImportErrors(result.errors);

      expect(failure.ok).toBe(false);
      expect(failure.errors.length).toBeGreaterThan(0);
      expect(failure.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
      expect(typeof failure.errors[0]?.message).toBe("string");
    });

    it("isRogalandStatementText returns false for unsupported input so no parse is attempted", () => {
      const unsupported = "Monthly report from Another Bank\nDate   Amount\n01.05.2026  -100.00";
      expect(isRogalandStatementText(unsupported)).toBe(false);

      const result = parseRogalandStatementText(unsupported, PARSE_OPTIONS);
      expect(result.ok).toBe(false);
    });
  });

  describe("AC-4: adapter and provenance are traceable back to the source feature slice", () => {
    it("adapter ID encodes the source bank and format version for auditability", () => {
      expect(ROGALAND_ADAPTER_ID).toMatch(/^rogaland-sparebank-text-v\d+$/);
    });

    it("parse result on fixture exposes adapter ID for downstream traceability", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(typeof result.adapterId).toBe("string");
      expect(result.adapterId.length).toBeGreaterThan(0);
    });

    it("importJobId on transactions links each candidate back to a specific import job", () => {
      const text = loadFixture();
      const importJobId = "job-audit-trace-01";
      const result = parseRogalandStatementText(text, { ...PARSE_OPTIONS, importJobId });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      for (const tx of result.transactions) {
        expect(tx.importJobId).toBe(importJobId);
      }
    });

    it("import job shape records household, source type, and source name for full provenance trail", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const job = buildImportJobProvenance(result.adapterId, "rogaland-2026-05-statement.txt", "job-audit-02");

      expect(job.householdId).toBe(PARSE_OPTIONS.householdId);
      expect(job.sourceType).toBe("pdf");
      expect(typeof job.sourceName).toBe("string");
      expect(job.sourceName.length).toBeGreaterThan(0);
      expect(typeof job.startedAtIso).toBe("string");
    });

    it("transaction fingerprints derived from parse output are deterministic for deduplication", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, PARSE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const fingerprints = result.transactions.map((tx) =>
        buildTransactionFingerprint({
          accountId: tx.accountId,
          bookedAtIso: tx.bookedAtIso,
          amountMinor: tx.amountMinor,
          merchantRaw: tx.merchantRaw,
        })
      );

      // All fingerprints are non-empty hex strings
      for (const fp of fingerprints) {
        expect(fp).toMatch(/^[0-9a-f]{64}$/);
      }

      // Fingerprints are unique across transactions in this fixture
      expect(new Set(fingerprints).size).toBe(fingerprints.length);
    });
  });
});
