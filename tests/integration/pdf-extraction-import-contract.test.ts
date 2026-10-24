import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { buildDashboardViewContract } from "../../src/app/dashboardApi.js";
import { extractSourceDocumentFromBuffer } from "../../src/app/import/extractPdfText.js";
import { runPdfImportWorkflow } from "../../src/app/import/importPdf.js";
import { defaultParserAdapterRegistry } from "../../src/domain/import/parserAdapterRegistry.js";
import { createTextSourceDocument } from "../../src/domain/import/sourceDocument.js";
import type { Transaction } from "../../src/domain/types.js";
import { createSyntheticPdfWithText } from "../helpers/createSyntheticPdf.js";

const TEXT_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt");
const HOUSEHOLD = {
  id: "household-pdf-extraction",
  name: "PDF extraction integration household",
  createdAtIso: "2026-01-01T00:00:00Z",
};
const ACCOUNT = {
  id: "account-pdf-extraction",
  householdId: HOUSEHOLD.id,
  name: "Main account",
  currencyCode: "NOK" as const,
};

function createLedger(suffix: string) {
  const directory = mkdtempSync(join(tmpdir(), `budget-pdf-extraction-${suffix}-`));
  const ledger = createLocalLedgerDatabase({
    dbPath: join(directory, "ledger.sqlite"),
    seedData: {
      household: HOUSEHOLD,
      accounts: [ACCOUNT],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });

  return {
    ledger,
    close() {
      try {
        ledger.close();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

function transactionFields(transactions: readonly Transaction[]) {
  return transactions
    .map((transaction) => [
      transaction.bookedAtIso,
      transaction.amountMinor,
      transaction.merchantRaw,
      transaction.currencyCode,
      transaction.accountId,
      transaction.householdId,
      transaction.sourceType,
    ]);
}

function persistedTransactionFields(transactions: readonly Transaction[]) {
  return transactionFields(transactions)
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
}

function importDocument(
  sourceText: string,
  sourceDocument: Awaited<ReturnType<typeof extractSourceDocumentFromBuffer>>,
  filePath: string,
  importJobId: string,
  ledger: ReturnType<typeof createLedger>["ledger"]
) {
  const timestamp = "2026-06-01T12:00:00Z";
  return runPdfImportWorkflow({
    pdfText: sourceText,
    sourceDocument,
    filePath,
    householdId: HOUSEHOLD.id,
    accountId: ACCOUNT.id,
    importJobId,
    startedAtIso: timestamp,
    finishedAtIso: timestamp,
  }, {
    parserRegistry: defaultParserAdapterRegistry,
    appendImportJob: ledger.appendImportJob,
    appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
    appendTransactions: ledger.appendTransactions,
    getTransactionsForImportJob: ledger.getTransactionsForImportJob,
    getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
    getExistingTransactionsForAccount: ledger.getTransactionsForAccount,
    getAccountCurrencyCode: () => ACCOUNT.currencyCode,
  });
}

describe("PDF extraction import contract", () => {
  it("persists original source page and line evidence with unresolved PDF rows", () => {
    const ledgerResult = createLedger("review-evidence");
    const malformedRow = "27.05.2026 Varekjop ACCT-001 SYNTHETIC DEST-001 SYNTHETIC SHOP not-an-amount NOK Bokført MALFORMED ROW";
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Varekjop ACCT-001 SYNTHETIC DEST-001 SYNTHETIC SHOP -10,00 NOK Bokført VALID ROW",
      malformedRow,
    ].join("\n");
    const sourceDocument = createTextSourceDocument(text);
    const timestamp = "2026-06-01T12:00:00Z";

    try {
      const result = runPdfImportWorkflow({
        pdfText: text,
        sourceDocument,
        filePath: "synthetic-review-evidence.txt",
        householdId: HOUSEHOLD.id,
        accountId: ACCOUNT.id,
        importJobId: "import-pdf-review-evidence",
        startedAtIso: timestamp,
        finishedAtIso: timestamp,
      }, {
        parserRegistry: defaultParserAdapterRegistry,
        appendImportJob: ledgerResult.ledger.appendImportJob,
        appendImportJobAndTransactions: ledgerResult.ledger.appendImportJobAndTransactions,
        appendTransactions: ledgerResult.ledger.appendTransactions,
        getTransactionsForImportJob: ledgerResult.ledger.getTransactionsForImportJob,
      });

      expect(result).toMatchObject({ ok: true, transactionCount: 1, unresolvedRowCount: 1 });
      expect(ledgerResult.ledger.listImportReviewItems(HOUSEHOLD.id)).toEqual([
        expect.objectContaining({
          rawRow: malformedRow,
          status: "unresolved",
          sourceEvidence: {
            pageNumber: 1,
            sourceLines: [
              expect.objectContaining({
                pageNumber: 1,
                lineNumber: 5,
                rawText: malformedRow,
              }),
            ],
          },
        }),
      ]);
    } finally {
      ledgerResult.close();
    }
  });

  it("keeps a malformed binary PDF row in review without persisting it as a transaction", async () => {
    const malformedRow = "27.05.2026 Varekjop ACCT-001 SYNTHETIC DEST-001 SYNTHETIC SHOP not-an-amount NOK Bokført SYNTHETIC MALFORMED ROW";
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Varekjop ACCT-001 SYNTHETIC DEST-001 SYNTHETIC SHOP -10,00 NOK Bokført SYNTHETIC VALID ROW",
      malformedRow,
    ].join("\n");
    const sourceDocument = await extractSourceDocumentFromBuffer(
      createSyntheticPdfWithText(text),
      "pdf"
    );
    const ledgerResult = createLedger("malformed-binary-row");

    try {
      const result = importDocument(
        sourceDocument.text,
        sourceDocument,
        "malformed-rogaland-statement.pdf",
        "import-pdf-malformed-binary-row",
        ledgerResult.ledger
      );

      expect(result).toMatchObject({
        ok: true,
        transactionCount: 1,
        unresolvedRowCount: 1,
      });
      expect(ledgerResult.ledger.loadLedgerSnapshotData().transactions).toEqual([
        expect.objectContaining({
          amountMinor: -1000,
          merchantRaw: "SYNTHETIC VALID ROW",
          sourceType: "pdf",
        }),
      ]);
      expect(ledgerResult.ledger.listImportReviewItems(HOUSEHOLD.id)).toEqual([
        expect.objectContaining({
          rawRow: malformedRow,
          status: "unresolved",
          sourceEvidence: {
            pageNumber: 1,
            sourceLines: [
              expect.objectContaining({
                pageNumber: 1,
                lineNumber: 5,
                rawText: malformedRow,
              }),
            ],
          },
        }),
      ]);
    } finally {
      ledgerResult.close();
    }
  });

  it("retains an unknown binary PDF as unresolved input without writing ledger records", async () => {
    const unknownText = "UNKNOWN BANK\nUNRECOGNIZED STATEMENT ROW";
    const sourceDocument = await extractSourceDocumentFromBuffer(
      createSyntheticPdfWithText(unknownText),
      "pdf"
    );
    const ledgerResult = createLedger("unknown-binary-layout");

    try {
      const result = importDocument(
        sourceDocument.text,
        sourceDocument,
        "unknown-bank-statement.pdf",
        "import-pdf-unknown-binary",
        ledgerResult.ledger
      );

      expect(result).toMatchObject({
        ok: false,
        errors: [{ code: "UNSUPPORTED_LAYOUT" }],
        unresolvedInput: {
          sourceName: "unknown-bank-statement.pdf",
          sourceDocument: {
            format: "pdf",
            pages: [
              expect.objectContaining({
                pageNumber: 1,
                sourceText: unknownText,
              }),
            ],
          },
        },
      });
      expect(ledgerResult.ledger.loadLedgerSnapshotData()).toMatchObject({
        transactions: [],
        importJobs: [],
      });
    } finally {
      ledgerResult.close();
    }
  });

  it("persists equivalent ordered text and binary PDF candidates with matching provenance and dashboard totals", async () => {
    const text = readFileSync(TEXT_FIXTURE_PATH, "utf8");
    const textDocument = createTextSourceDocument(text);
    const pdfDocument = await extractSourceDocumentFromBuffer(
      createSyntheticPdfWithText(text),
      "pdf"
    );
    const parseOptions = {
      householdId: HOUSEHOLD.id,
      accountId: ACCOUNT.id,
    };
    const textParseResult = defaultParserAdapterRegistry.parse(textDocument, parseOptions);
    const pdfParseResult = defaultParserAdapterRegistry.parse(pdfDocument, parseOptions);
    expect(textParseResult).toMatchObject({ ok: true, adapterId: "rogaland-sparebank-text-v1" });
    expect(pdfParseResult).toMatchObject({ ok: true, adapterId: "rogaland-sparebank-text-v1" });
    if (!textParseResult.ok || !pdfParseResult.ok) {
      throw new Error("The equivalent statement inputs did not produce parser candidates.");
    }
    expect(transactionFields(pdfParseResult.candidates)).toEqual(
      transactionFields(textParseResult.candidates)
    );
    const textLedger = createLedger("text");
    const pdfLedger = createLedger("pdf");

    try {
      const textResult = importDocument(
        textDocument.text,
        textDocument,
        TEXT_FIXTURE_PATH,
        "import-pdf-text-parity",
        textLedger.ledger
      );
      const pdfResult = importDocument(
        pdfDocument.text,
        pdfDocument,
        "rogaland-2026-05-generated-binary.pdf",
        "import-pdf-binary-parity",
        pdfLedger.ledger
      );

      expect(textResult).toMatchObject({
        ok: true,
        adapterId: "rogaland-sparebank-text-v1",
        transactionCount: 10,
      });
      expect(pdfResult).toMatchObject({
        ok: true,
        adapterId: "rogaland-sparebank-text-v1",
        transactionCount: 10,
      });
      if (!textResult.ok || !pdfResult.ok) return;

      const textSnapshot = textLedger.ledger.loadLedgerSnapshotData();
      const pdfSnapshot = pdfLedger.ledger.loadLedgerSnapshotData();
      expect(textSnapshot.transactions).toHaveLength(10);
      expect(pdfSnapshot.transactions).toHaveLength(10);
      expect(persistedTransactionFields(pdfSnapshot.transactions)).toEqual(
        persistedTransactionFields(textSnapshot.transactions)
      );
      expect(textSnapshot.importJobs[0]).toMatchObject({
        candidateCount: 10,
        adapterId: "rogaland-sparebank-text-v1",
        provenance: {
          sourceIdentity: "no.rogaland-sparebank.statement-text",
          adapterId: "rogaland-sparebank-text-v1",
        },
      });
      expect(pdfSnapshot.importJobs[0]).toMatchObject({
        candidateCount: 10,
        adapterId: "rogaland-sparebank-text-v1",
        provenance: {
          sourceIdentity: "no.rogaland-sparebank.statement-text",
          adapterId: "rogaland-sparebank-text-v1",
        },
      });

      const textDashboard = buildDashboardViewContract({
        transactions: textSnapshot.transactions,
        selectedYearMonth: "2026-05",
      });
      const pdfDashboard = buildDashboardViewContract({
        transactions: pdfSnapshot.transactions,
        selectedYearMonth: "2026-05",
      });
      expect(textDashboard.state).toBe("ready");
      expect(pdfDashboard.state).toBe("ready");
      if (textDashboard.state !== "ready" || pdfDashboard.state !== "ready") return;
      expect(pdfDashboard.snapshot.monthlyTotals).toEqual(textDashboard.snapshot.monthlyTotals);
      expect(pdfDashboard.snapshot.categoryBreakdown).toEqual(textDashboard.snapshot.categoryBreakdown);
    } finally {
      textLedger.close();
      pdfLedger.close();
    }
  });
});
