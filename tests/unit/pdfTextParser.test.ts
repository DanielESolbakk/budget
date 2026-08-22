/**
 * Unit tests for the Rogaland Sparebank text PDF parser adapter.
 *
 * Covers AC-1 through AC-4 from issue #15:
 *   AC-1: Supported sanitized text-PDF fixture produces expected transaction candidates.
 *   AC-2: Parsing identical fixture content produces identical ordered candidates.
 *   AC-3: Missing required fields and unsupported layouts return explicit validation errors.
 *   AC-4: Source-aware adapter records adapter identity in results.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRogalandImportJobId,
  isRogalandStatementText,
  parseRogalandStatementText,
  ROGALAND_ADAPTER_ID,
} from "../../src/domain/import/pdfTextParser.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";

const BASE_OPTIONS = {
  householdId: "hh-test",
  accountId: "acc-test",
};

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

describe("pdfTextParser unit tests", () => {
  it("builds the same import job ID for identical content and context", () => {
    const text = loadFixture();

    expect(buildRogalandImportJobId(text, BASE_OPTIONS)).toBe(
      buildRogalandImportJobId(text, BASE_OPTIONS)
    );
  });
  describe("isRogalandStatementText", () => {
    it("returns true for text containing ROGALAND SPAREBANK header token", () => {
      expect(isRogalandStatementText("ROGALAND SPAREBANK\nKontonummer: 1234")).toBe(true);
    });

    it("returns false for text without the header token", () => {
      expect(isRogalandStatementText("Some other bank statement")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isRogalandStatementText("")).toBe(false);
    });
  });

  describe("AC-3: unsupported layout returns UNSUPPORTED_LAYOUT error", () => {
    it("rejects text that does not contain the Rogaland header token", () => {
      const result = parseRogalandStatementText("Wrong bank\nDato  Beskrivelse  Beløp  Saldo\n", BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
    });

    it("rejects empty text", () => {
      const result = parseRogalandStatementText("", BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
    });
  });

  describe("AC-3: missing transaction section returns MISSING_TRANSACTION_SECTION error", () => {
    it("rejects statement with header token but no transaction table header", () => {
      const text = "ROGALAND SPAREBANK\nKontonummer: 1234\nKontonavn: Brukskonto\n";
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("MISSING_TRANSACTION_SECTION");
    });

    it("rejects statement with header and table header but no transaction rows", () => {
      const text = [
        "ROGALAND SPAREBANK",
        "Kontonummer: 1234",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
        "",
      ].join("\n");
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("MISSING_TRANSACTION_SECTION");
    });
  });

  describe("AC-1: fixture produces expected transaction candidates", () => {
    it("successfully parses the synthetic fixture", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transactions.length).toBeGreaterThan(0);
    });

    it("all transactions have required domain fields set correctly", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      for (const tx of result.transactions) {
        expect(typeof tx.id).toBe("string");
        expect(tx.id.length).toBeGreaterThan(0);
        expect(tx.householdId).toBe("hh-test");
        expect(tx.accountId).toBe("acc-test");
        expect(tx.bookedAtIso).toMatch(ISO_DATETIME_PATTERN);
        expect(Number.isInteger(tx.amountMinor)).toBe(true);
        expect(typeof tx.merchantRaw).toBe("string");
        expect(tx.merchantRaw.length).toBeGreaterThan(0);
        expect(tx.currencyCode).toBe("NOK");
        expect(tx.sourceType).toBe("pdf");
      }
    });

    it("income row maps to positive amountMinor", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const income = result.transactions.find((tx) => tx.amountMinor > 0);
      expect(income).toBeDefined();
    });

    it("expense row maps to negative amountMinor", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const expense = result.transactions.find((tx) => tx.amountMinor < 0);
      expect(expense).toBeDefined();
    });

    it("salary row maps to +5000000 minor units (50 000,00 NOK)", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const salary = result.transactions.find(
        (tx) => tx.merchantRaw.includes("SALARY") && !tx.merchantRaw.includes("ADVANCE")
      );
      expect(salary).toBeDefined();
      expect(salary!.amountMinor).toBe(5000000);
    });

    it("MERCHANT-005 row maps to -9770 minor units (-97,70 NOK)", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const tx = result.transactions.find((tx) => tx.merchantRaw.startsWith("MERCHANT-005"));
      expect(tx).toBeDefined();
      expect(tx!.amountMinor).toBe(-9770);
    });

    it("importJobId is propagated to all transactions when provided", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, { ...BASE_OPTIONS, importJobId: "job-42" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transactions.every((tx) => tx.importJobId === "job-42")).toBe(true);
    });

    it("transaction ids use idPrefix and are unique", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, { ...BASE_OPTIONS, idPrefix: "pfx" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const ids = result.transactions.map((tx) => tx.id);
      expect(ids.every((id) => id.startsWith("pfx-"))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("AC-2: deterministic output across repeated parse calls", () => {
    it("produces identical ordered candidates for identical fixture content", () => {
      const text = loadFixture();
      const first = parseRogalandStatementText(text, BASE_OPTIONS);
      const second = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(first).toEqual(second);
    });

    it("produces same transaction count on each parse", () => {
      const text = loadFixture();
      const r1 = parseRogalandStatementText(text, BASE_OPTIONS);
      const r2 = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;
      expect(r1.transactions.length).toBe(r2.transactions.length);
    });
  });

  describe("AC-4: source-aware adapter records adapter identity", () => {
    it("returns the Rogaland adapter ID on successful parse", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.adapterId).toBe(ROGALAND_ADAPTER_ID);
    });

    it("adapter ID is the canonical rogaland-sparebank-text-v1 string", () => {
      expect(ROGALAND_ADAPTER_ID).toBe("rogaland-sparebank-text-v1");
    });
  });

  describe("AC-3: invalid amount format in a transaction line produces error", () => {
    it("returns INVALID_AMOUNT_FORMAT for a line with unparseable amount", () => {
      const text = [
        "ROGALAND SPAREBANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
        "27.05.2026   SALARY                                  invalid-amount  75 000,00",
      ].join("\n");

      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(false);
    });

    it("returns INVALID_DATE_FORMAT for an impossible calendar date (31 February)", () => {
      const text = [
        "ROGALAND SPAREBANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
        "31.02.2026   SALARY                                  +50 000,00     75 000,00 ",
      ].join("\n");

      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("INVALID_DATE_FORMAT");
    });
  });

  describe("Scenario 2: reordered input rows produce deterministic per-row results", () => {
    it("parsing reordered rows produces a result with the same set of merchantRaw values", () => {
      const header = [
        "ROGALAND SPAREBANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
      ];
      const row1 = "27.05.2026   SALARY                                  +50 000,00     75 000,00 ";
      const row2 = "26.05.2026   MERCHANT-005 Butikkkjøp                    -97,70      24 902,30 ";

      const original = parseRogalandStatementText([...header, row1, row2].join("\n"), BASE_OPTIONS);
      const reordered = parseRogalandStatementText([...header, row2, row1].join("\n"), BASE_OPTIONS);

      expect(original.ok).toBe(true);
      expect(reordered.ok).toBe(true);
      if (!original.ok || !reordered.ok) return;

      const originalMerchants = original.transactions.map((tx) => tx.merchantRaw).sort();
      const reorderedMerchants = reordered.transactions.map((tx) => tx.merchantRaw).sort();
      expect(originalMerchants).toEqual(reorderedMerchants);
    });

    it("parsing reordered rows yields a different transaction order", () => {
      const header = [
        "ROGALAND SPAREBANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
      ];
      const row1 = "27.05.2026   SALARY                                  +50 000,00     75 000,00 ";
      const row2 = "26.05.2026   MERCHANT-005 Butikkkjøp                    -97,70      24 902,30 ";

      const original = parseRogalandStatementText([...header, row1, row2].join("\n"), BASE_OPTIONS);
      const reordered = parseRogalandStatementText([...header, row2, row1].join("\n"), BASE_OPTIONS);

      expect(original.ok).toBe(true);
      expect(reordered.ok).toBe(true);
      if (!original.ok || !reordered.ok) return;

      expect(original.transactions[0]?.merchantRaw).not.toBe(reordered.transactions[0]?.merchantRaw);
    });

    it("parsing the same reordered input twice produces identical results (deterministic)", () => {
      const text = [
        "ROGALAND SPAREBANK",
        "",
        "Dato         Beskrivelse                              Beløp          Saldo",
        "26.05.2026   MERCHANT-005 Butikkkjøp                    -97,70      24 902,30 ",
        "27.05.2026   SALARY                                  +50 000,00     75 000,00 ",
      ].join("\n");

      const first = parseRogalandStatementText(text, BASE_OPTIONS);
      const second = parseRogalandStatementText(text, BASE_OPTIONS);
      expect(first).toEqual(second);
    });
  });

  describe("importJobId and idPrefix edge cases", () => {
    it("omitting importJobId means importJobId is absent from transactions", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const tx of result.transactions) {
        expect(Object.prototype.hasOwnProperty.call(tx, "importJobId")).toBe(false);
      }
    });

    it("default idPrefix is 'pdf' when not specified", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, BASE_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transactions.every((tx) => tx.id.startsWith("pdf-"))).toBe(true);
    });
  });
});
