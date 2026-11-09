import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import {
  extractPdfTextFromBuffer,
  extractSourceDocumentFromBuffer,
} from "../../src/app/import/extractPdfText.js";
import { runPdfImportWorkflow } from "../../src/app/import/importPdf.js";
import { defaultParserAdapterRegistry } from "../../src/domain/import/parserAdapterRegistry.js";
import { parseRogalandStatementText } from "../../src/domain/import/pdfTextParser.js";
import { writePdfObjects } from "../helpers/pdfObjectWriter.js";

interface PdfTextPlacement {
  x: number;
  y: number;
  text: string;
}

function encodePdfText(value: string): string {
  return `<${Array.from(Buffer.from(value, "latin1"), (byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
}

function createSyntheticPdf(pages: readonly PdfTextPlacement[][]): Buffer {
  const pageObjectIds = pages.map((_, pageIndex) => 4 + pageIndex * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((pageObjectId) => `${pageObjectId} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ...pages.flatMap((placements, pageIndex) => {
      const pageObjectId = pageObjectIds[pageIndex]!;
      const contentObjectId = pageObjectId + 1;
      const content = placements.map(({ x, y, text }) =>
        `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm ${encodePdfText(text)} Tj ET`
      ).join("\n");
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate 90 /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
        `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
      ];
    }),
  ];

  return writePdfObjects(objects);
}

function createColumnOrderedStatement(): Buffer {
  const placements: PdfTextPlacement[] = [
    { x: 480, y: 24, text: "ROGALAND SPAREBANK" },
    { x: 273, y: 24, text: "Dato" },
    { x: 273, y: 84, text: "Type" },
    { x: 273, y: 144, text: "Fra konto" },
    { x: 273, y: 219, text: "Avsender" },
    { x: 273, y: 319, text: "Til konto" },
    { x: 273, y: 394, text: "Mottakernavn" },
    { x: 273, y: 538, text: "Beløp" },
    { x: 273, y: 574, text: "Valuta" },
    { x: 273, y: 614, text: "Status" },
    { x: 273, y: 666, text: "Melding/KID/Fakt.nr" },
    { x: 293, y: 24, text: "28.05.2026" },
    { x: 293, y: 84, text: "Betaling" },
    { x: 303, y: 84, text: "innland" },
    { x: 293, y: 144, text: "ACCT-001" },
    { x: 293, y: 219, text: "LOCAL_USER" },
    { x: 293, y: 538, text: "-97,70" },
    { x: 293, y: 574, text: "NOK" },
    { x: 293, y: 614, text: "Bokført" },
    { x: 293, y: 666, text: "SYNTHETIC SHOP" },
  ];

  return createSyntheticPdf([placements]);
}

function createRogalandStatementPage(
  date: string,
  amount: string,
  message: string,
  footer: string,
  continuation?: string
): PdfTextPlacement[] {
  return [
    { x: 480, y: 24, text: "ROGALAND SPAREBANK" },
    { x: 273, y: 24, text: "Dato" },
    { x: 273, y: 84, text: "Type" },
    { x: 273, y: 144, text: "Fra konto" },
    { x: 273, y: 219, text: "Avsender" },
    { x: 273, y: 319, text: "Til konto" },
    { x: 273, y: 394, text: "Mottakernavn" },
    { x: 273, y: 538, text: "Beløp" },
    { x: 273, y: 574, text: "Valuta" },
    { x: 273, y: 614, text: "Status" },
    { x: 273, y: 666, text: "Melding/KID/Fakt.nr" },
    { x: 293, y: 24, text: date },
    { x: 293, y: 84, text: "Varekjop" },
    { x: 293, y: 144, text: "ACCT-001" },
    { x: 293, y: 219, text: "SYNTHETIC" },
    { x: 293, y: 319, text: "DEST-001" },
    { x: 293, y: 394, text: "SYNTHETIC SHOP" },
    { x: 293, y: 538, text: amount },
    { x: 293, y: 574, text: "NOK" },
    { x: 293, y: 614, text: "Bokført" },
    { x: 293, y: 666, text: message },
    ...(continuation === undefined ? [] : [{ x: 303, y: 666, text: continuation }]),
    { x: 480, y: 800, text: footer },
  ];
}

function createPaginatedRogalandStatement(): Buffer {
  return createSyntheticPdf([
    createRogalandStatementPage("28.05.2026", "-10,00", "FIRST PAGE SHOP", "1/2 Rogaland Sparebank"),
    createRogalandStatementPage("27.05.2026", "-20,00", "WRAPPED", "2/2 Rogaland Sparebank", "DESCRIPTION"),
  ]);
}

describe("position-aware PDF extraction", () => {
  it("preserves representative rotated PDF bytes captured before writer extraction", () => {
    expect(createHash("sha256").update(createColumnOrderedStatement()).digest("hex")).toBe("06d8cc5c775a0a0202a00d6d76349dfb125bb0fc89a281850be983febac9f908");
  });
  it("maps malformed rows from a later PDF page back to their original source lines", async () => {
    const sourceDocument = await extractSourceDocumentFromBuffer(createSyntheticPdf([
      createRogalandStatementPage("28.05.2026", "-10,00", "FIRST PAGE SHOP", "1/2 Rogaland Sparebank"),
      createRogalandStatementPage("27.05.2026", "not-an-amount", "MALFORMED", "2/2 Rogaland Sparebank", "DESCRIPTION"),
    ]));
    const parseResult = defaultParserAdapterRegistry.parse(sourceDocument, {
      householdId: "hh-test",
      accountId: "acc-test",
    });

    expect(parseResult).toMatchObject({
      ok: true,
      unresolvedRows: [{
        rawRow: expect.stringContaining("not-an-amount"),
        sourceEvidence: {
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
        },
      }],
    });

    const directory = mkdtempSync(join(tmpdir(), "budget-pdf-review-page-evidence-"));
    const dbPath = join(directory, "ledger.sqlite");
    const household = {
      id: "hh-positioned-review",
      name: "Positioned review test household",
      createdAtIso: "2026-01-01T00:00:00Z",
    };
    const account = {
      id: "acc-positioned-review",
      householdId: household.id,
      name: "Main account",
      currencyCode: "NOK" as const,
    };
    let ledger = createLocalLedgerDatabase({
      dbPath,
      seedData: {
        household,
        accounts: [account],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const imported = runPdfImportWorkflow({
        pdfText: sourceDocument.text,
        sourceDocument,
        filePath: "synthetic-paginated-rogaland.pdf",
        householdId: household.id,
        accountId: account.id,
        importJobId: "positioned-page-evidence-import",
        startedAtIso: "2026-06-01T12:00:00Z",
        finishedAtIso: "2026-06-01T12:00:01Z",
      }, {
        parserRegistry: defaultParserAdapterRegistry,
        appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
        getTransactionsForImportJob: ledger.getTransactionsForImportJob,
        getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
        getExistingTransactionsForAccount: ledger.getTransactionsForAccount,
        getAccountCurrencyCode: () => account.currencyCode,
      });
      expect(imported).toMatchObject({ ok: true, transactionCount: 1, unresolvedRowCount: 1 });

      ledger.close();
      ledger = createLocalLedgerDatabase({ dbPath });

      expect(ledger.getTransactionsForImportJob("positioned-page-evidence-import")).toHaveLength(1);
      expect(ledger.listImportReviewItems(household.id)).toMatchObject([
        expect.objectContaining({
          sourceEvidence: {
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
          },
        }),
      ]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves page roles and wrapped-row evidence across repeated headers and footers", async () => {
    const sourceDocument = await extractSourceDocumentFromBuffer(createPaginatedRogalandStatement());
    const repeatedExtraction = await extractSourceDocumentFromBuffer(createPaginatedRogalandStatement());

    expect(repeatedExtraction).toEqual(sourceDocument);
    expect(sourceDocument.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    const secondPage = sourceDocument.pages[1];
    expect(secondPage).toBeDefined();
    if (secondPage === undefined) return;

    expect(secondPage.sourceLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ classification: "column-header" }),
      expect.objectContaining({
        classification: "document-decoration",
        rawText: expect.stringContaining("2/2 Rogaland Sparebank"),
      }),
      expect.objectContaining({ classification: "continuation", rawText: "DESCRIPTION" }),
    ]));
    expect(secondPage.text).toContain("WRAPPED DESCRIPTION");

    const parseResult = defaultParserAdapterRegistry.parse(sourceDocument, {
      householdId: "hh-test",
      accountId: "acc-test",
    });
    expect(parseResult).toMatchObject({
      ok: true,
      candidates: [
        { bookedAtIso: "2026-05-28T00:00:00Z", merchantRaw: "FIRST PAGE SHOP" },
        { bookedAtIso: "2026-05-27T00:00:00Z", merchantRaw: "WRAPPED DESCRIPTION" },
      ],
    });
  });

  it("reconstructs column-ordered PDF text into a parseable bank transaction", async () => {
    const pdfText = await extractPdfTextFromBuffer(createColumnOrderedStatement());
    const result = parseRogalandStatementText(pdfText, {
      householdId: "hh-test",
      accountId: "acc-test",
    });

    expect(result).toMatchObject({
      ok: true,
      transactions: [{
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -9770,
        merchantRaw: "SYNTHETIC SHOP",
        currencyCode: "NOK",
        sourceType: "pdf",
      }],
    });
  });
});