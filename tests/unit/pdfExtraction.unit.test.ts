import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSourceDocumentFromBuffer } from "../../src/app/import/extractPdfText.js";
import { defaultParserAdapterRegistry } from "../../src/domain/import/parserAdapterRegistry.js";
import { createTextSourceDocument } from "../../src/domain/import/sourceDocument.js";
import type { Transaction } from "../../src/domain/types.js";
import { createPaginatedRogalandPdfWithMalformedSecondPage } from "../helpers/createPaginatedRogalandPdf.js";
import { createSyntheticPdfWithText } from "../helpers/createSyntheticPdf.js";

const TEXT_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt");
const PARSE_OPTIONS = {
  householdId: "household-pdf-extraction",
  accountId: "account-pdf-extraction",
};

const EXPECTED_TRANSACTIONS = [
  ["2026-05-27T00:00:00Z", 5_000_000, "SALARY"],
  ["2026-05-26T00:00:00Z", -9_770, "MERCHANT-005 Butikkkjøp"],
  ["2026-05-25T00:00:00Z", -45_800, "MERCHANT_005 Netthandel"],
  ["2026-05-24T00:00:00Z", -7_800, "MERCHANT_007 Valutakjøp GBP"],
  ["2026-05-23T00:00:00Z", -97_310, "MERCHANT_008 Dagligvare"],
  ["2026-05-22T00:00:00Z", -14_500, "MERCHANT_009 Dagligvare"],
  ["2026-05-21T00:00:00Z", -25_000, "MERCHANT_010 Dagligvare"],
  ["2026-05-20T00:00:00Z", -35_000, "PAYMENT_EF Overføring"],
  ["2026-05-18T00:00:00Z", -6_250, "MERCHANT_011 Butikkkjøp"],
  ["2026-05-15T00:00:00Z", 500_000, "SALARY_ADVANCE Forskudd"],
] as const;

function transactionFields(transactions: readonly Transaction[]) {
  return transactions.map((transaction) => [
    transaction.bookedAtIso,
    transaction.amountMinor,
    transaction.merchantRaw,
    transaction.currencyCode,
    transaction.accountId,
    transaction.householdId,
    transaction.sourceType,
  ]);
}

describe("binary PDF extraction", () => {
  it("routes standalone statement text through the shared source-document contract", async () => {
    const text = readFileSync(TEXT_FIXTURE_PATH, "utf8");
    const sourceDocument = await extractSourceDocumentFromBuffer(Buffer.from(text, "utf8"), "text");
    const parseResult = defaultParserAdapterRegistry.parse(sourceDocument, PARSE_OPTIONS);

    expect(sourceDocument).toMatchObject({
      format: "text",
      text,
      capabilities: expect.arrayContaining(["plain-text", "standalone-text", "source-offsets"]),
      pages: [{ pageNumber: 1, sourceText: text }],
    });
    expect(sourceDocument.capabilities).not.toContain("binary-pdf");
    expect(parseResult).toMatchObject({
      ok: true,
      adapterId: "rogaland-sparebank-text-v1",
      sourceIdentity: "no.rogaland-sparebank.statement-text",
    });
  });

  it("preserves source page and continuation evidence while extracting a multi-page PDF", async () => {
    const sourceDocument = await extractSourceDocumentFromBuffer(
      createPaginatedRogalandPdfWithMalformedSecondPage(),
      "pdf"
    );
    const malformedLineIndex = sourceDocument.text.split("\n").findIndex((line) =>
      line.includes("not-an-amount")
    );

    expect(sourceDocument.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(malformedLineIndex).toBeGreaterThanOrEqual(0);
    expect(sourceDocument.textLineEvidence[malformedLineIndex]).toMatchObject({
      pageNumber: 2,
      sourceLines: expect.arrayContaining([
        expect.objectContaining({
          pageNumber: 2,
          classification: "transaction",
          rawText: expect.stringContaining("27.05.2026"),
        }),
        expect.objectContaining({
          pageNumber: 2,
          classification: "continuation",
          rawText: "DESCRIPTION",
        }),
      ]),
    });
  });

  it("rejects unreadable binary PDF bytes instead of returning an empty source document", async () => {
    await expect(
      extractSourceDocumentFromBuffer(Buffer.from("%PDF-1.4\ninvalid synthetic PDF data", "ascii"), "pdf")
    ).rejects.toThrow();
  });

  it("preserves the exact ordered Rogaland transaction candidates from equivalent text and PDF sources", async () => {
    const text = readFileSync(TEXT_FIXTURE_PATH, "utf8");
    const textResult = defaultParserAdapterRegistry.parse(
      createTextSourceDocument(text),
      PARSE_OPTIONS
    );
    const binarySource = await extractSourceDocumentFromBuffer(
      createSyntheticPdfWithText(text),
      "pdf"
    );
    const pdfResult = defaultParserAdapterRegistry.parse(binarySource, PARSE_OPTIONS);

    expect(textResult).toMatchObject({
      ok: true,
      adapterId: "rogaland-sparebank-text-v1",
      sourceIdentity: "no.rogaland-sparebank.statement-text",
    });
    expect(pdfResult).toMatchObject({
      ok: true,
      adapterId: "rogaland-sparebank-text-v1",
      sourceIdentity: "no.rogaland-sparebank.statement-text",
    });
    if (!textResult.ok || !pdfResult.ok) return;

    const expected = EXPECTED_TRANSACTIONS.map(([bookedAtIso, amountMinor, merchantRaw]) => [
      bookedAtIso,
      amountMinor,
      merchantRaw,
      "NOK",
      PARSE_OPTIONS.accountId,
      PARSE_OPTIONS.householdId,
      "pdf",
    ]);
    const textTransactions = transactionFields(textResult.candidates);
    const pdfTransactions = transactionFields(pdfResult.candidates);

    expect(textTransactions).toEqual(expected);
    expect(pdfTransactions).toEqual(expected);
    expect(pdfTransactions).toEqual(textTransactions);
  });
});
