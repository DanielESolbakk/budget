/**
 * Integration tests for the PDF import contract.
 *
 * Covers AC-1 through AC-4 from issue #15:
 *   AC-1: Fixture produces expected transaction candidates with all required fields.
 *   AC-2: Repeated parses of the same fixture produce identical ordered candidates.
 *         Re-importing the same fixture leaves ledger row count unchanged (duplicate-safe).
 *   AC-3: Missing fields, malformed rows, and unsupported layouts return explicit errors
 *         and persist no partial transactions.
 *   AC-4: Source-aware adapter parses the Rogaland layout and records adapter identity
 *         in import provenance.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildRogalandImportJobId,
  parseRogalandStatementText,
  ROGALAND_ADAPTER_ID,
  ROGALAND_SOURCE_ID,
} from "../../src/domain/import/pdfTextParser.js";
import { buildTransactionFingerprint } from "../../src/domain/import/buildTransactionFingerprint.js";
import {
  defaultParserAdapterRegistry,
  ParserAdapterRegistry,
} from "../../src/domain/import/parserAdapterRegistry.js";
import type { SourceDocument } from "../../src/domain/import/sourceDocument.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { buildDashboardViewContract } from "../../src/app/dashboardApi.js";
import { createTextSourceDocument } from "../../src/domain/import/sourceDocument.js";
import {
  buildPdfImportRequest,
  normalizePdfImportErrors,
  appendUniqueTransactions,
  previewPdfImportWorkflow,
  previewPdfImportWorkflowInBatches,
  runPdfImportWorkflow,
} from "../../src/app/import/importPdf.js";
import type { Account, Household, ImportJob, Transaction } from "../../src/domain/types.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";
const PAGINATED_EXPORT_FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-paginated-export.txt";

const MAPPING_OPTIONS = {
  householdId: "hh-test",
  accountId: "acc-test",
};

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const SAMPLE_HOUSEHOLD: Household = {
  id: "hh-test",
  name: "Integration Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const SAMPLE_ACCOUNT: Account = {
  id: "acc-test",
  householdId: SAMPLE_HOUSEHOLD.id,
  name: "Brukskonto",
  currencyCode: "NOK",
};

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

function makeTestLedger(suffix = randomUUID(), accounts: Account[] = [SAMPLE_ACCOUNT]) {
  const dir = join(tmpdir(), `budget-pdf-integration-${suffix}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "test.sqlite");

  const ledger = createLocalLedgerDatabase({
    dbPath,
    seedData: {
      household: SAMPLE_HOUSEHOLD,
      accounts,
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });

  return {
    ...ledger,
    close() {
      try {
        ledger.close();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

function runPdfImportOrchestration(
  text: string,
  ledger: ReturnType<typeof makeTestLedger>,
  options: { householdId: string; accountId: string; sourceName?: string }
) {
  const importJobId = `import-pdf-test-${randomUUID()}`;
  const now = new Date().toISOString();

  return runPdfImportWorkflow(
    {
      pdfText: text,
      filePath: options.sourceName ?? "rogaland-statement.txt",
      householdId: options.householdId,
      accountId: options.accountId,
      importJobId,
      startedAtIso: now,
      finishedAtIso: now,
    },
    {
      parserRegistry: defaultParserAdapterRegistry,
      appendImportJob: ledger.appendImportJob,
      appendTransactions: ledger.appendTransactions,
      appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
      getTransactionsForImportJob: ledger.getTransactionsForImportJob,
    }
  );
}
describe("pdf import contract", () => {
  it("returns unknown layout source evidence with explicit diagnostics", () => {
    const unresolvedText = "UNKNOWN BANK\nUnrecognized statement row";
    const sourceDocument = createTextSourceDocument(unresolvedText);
    const preview = previewPdfImportWorkflow({
      pdfText: unresolvedText,
      sourceDocument,
      filePath: "unknown-statement.txt",
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
    }, defaultParserAdapterRegistry);

    expect(preview).toMatchObject({
      ok: false,
      errors: [{ code: "UNSUPPORTED_LAYOUT" }],
      unresolvedInput: {
        sourceName: "unknown-statement.txt",
        sourceDocument: {
          format: "text",
          pages: [{
            pageNumber: 1,
            sourceText: unresolvedText,
            sourceLines: expect.arrayContaining([
              expect.objectContaining({ lineNumber: 2, rawText: "Unrecognized statement row" }),
            ]),
          }],
        },
      },
    });
  });

  it("returns malformed extracted row evidence with explicit diagnostics", () => {
    const malformedRow = "29.05.2026 Varekjop ACCT-001 SYNTHETIC DEST-001 SYNTHETIC SHOP not-an-amount NOK Bokført INVALID ROW";
    const malformedText = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 1",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      malformedRow,
    ].join("\n");
    const preview = previewPdfImportWorkflow({
      pdfText: malformedText,
      sourceDocument: createTextSourceDocument(malformedText),
      filePath: "malformed-statement.txt",
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
    }, defaultParserAdapterRegistry);

    expect(preview).toMatchObject({
      ok: true,
      transactions: [],
      unresolvedRows: [{
        lineNumber: 4,
        rawRow: malformedRow,
        errors: [expect.objectContaining({ code: "INVALID_AMOUNT_FORMAT", lineNumber: 4 })],
      }],
    });
  });

  it("previews exact candidates without mutating the seeded SQLite ledger", () => {
    const ledger = makeTestLedger(randomUUID());
    const existingTransaction: Transaction = {
      id: "preview-existing-row",
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
      bookedAtIso: "2026-05-20T00:00:00Z",
      amountMinor: -8100,
      merchantRaw: "SYNTHETIC EXISTING ROW",
      sourceType: "manual",
    };
    const pdfText = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Kontonummer: ACCT-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -12,50 NOK Bokført SYNTHETIC PREVIEW SHOP",
      "27.05.2026 Refusjon ACCT-001 LOCAL_USER 3,25 NOK Bokført SYNTHETIC PREVIEW REFUND",
    ].join("\n");

    try {
      ledger.appendTransactions([existingTransaction]);
      const beforePreview = structuredClone(ledger.loadLedgerSnapshotData());

      const preview = previewPdfImportWorkflow({
        pdfText,
        filePath: "preview-isolation.pdf",
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      }, defaultParserAdapterRegistry);

      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.adapterId).toBe(ROGALAND_ADAPTER_ID);
      expect(preview.transactions).toHaveLength(2);
      expect(preview.transactions.map(({ householdId, accountId, bookedAtIso, amountMinor, merchantRaw }) => ({
        householdId,
        accountId,
        bookedAtIso,
        amountMinor,
        merchantRaw,
      }))).toEqual([
        {
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          bookedAtIso: "2026-05-28T00:00:00Z",
          amountMinor: -1250,
          merchantRaw: "SYNTHETIC PREVIEW SHOP",
        },
        {
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          bookedAtIso: "2026-05-27T00:00:00Z",
          amountMinor: 325,
          merchantRaw: "SYNTHETIC PREVIEW REFUND",
        },
      ]);
      expect(ledger.loadLedgerSnapshotData()).toEqual(beforePreview);
    } finally {
      ledger.close();
    }
  });

  it("passes the structured source document through preview adapter selection", () => {
    const registry = new ParserAdapterRegistry();
    registry.register({
      id: "bank-b-pdf-v1",
      sourceIdentity: "no.bank-b.statement-pdf",
      requiredCapabilities: ["binary-pdf"],
      canHandle: (source) => source.text.includes("BANK-B"),
      parse: () => ({
        ok: true,
        adapterId: "bank-b-pdf-v1",
        sourceIdentity: "no.bank-b.statement-pdf",
        candidates: [],
      }),
    });
    const sourceDocument: SourceDocument = {
      format: "pdf",
      text: "BANK-B statement",
      capabilities: ["plain-text", "ordered-pages", "source-offsets", "positioned-text", "binary-pdf"],
      pages: [{
        pageNumber: 1,
        text: "BANK-B statement",
        sourceText: "BANK-B statement",
        sourceLines: [],
        textLineEvidence: [],
      }],
      textLineEvidence: [],
    };

    const preview = previewPdfImportWorkflow({
      pdfText: sourceDocument.text,
      sourceDocument,
      filePath: "bank-b-statement.pdf",
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
    }, registry);

    expect(preview).toMatchObject({ ok: true, adapterId: "bank-b-pdf-v1" });
  });

  it("uses PDF capabilities through final import and records the adapter identity", () => {
    const registry = new ParserAdapterRegistry();
    const candidate: Transaction = {
      id: "bank-b-candidate",
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
      bookedAtIso: "2026-05-28T00:00:00Z",
      amountMinor: -1200,
      merchantRaw: "BANK-B SHOP",
      currencyCode: "NOK",
      sourceType: "pdf",
      importJobId: "bank-b-import-job",
    };
    registry.register({
      id: "bank-b-pdf-v1",
      sourceIdentity: "no.bank-b.statement-pdf",
      requiredCapabilities: ["binary-pdf"],
      canHandle: (source) => source.text.includes("BANK-B"),
      parse: () => ({
        ok: true,
        adapterId: "bank-b-pdf-v1",
        sourceIdentity: "no.bank-b.statement-pdf",
        candidates: [candidate],
        sourceRows: [{
          lineNumber: 1,
          amountMinor: candidate.amountMinor,
          ...(candidate.currencyCode === undefined ? {} : { currencyCode: candidate.currencyCode }),
          candidateId: candidate.id,
        }],
      }),
    });
    const sourceDocument: SourceDocument = {
      format: "pdf",
      text: "BANK-B statement",
      capabilities: ["plain-text", "ordered-pages", "source-offsets", "positioned-text", "binary-pdf"],
      pages: [{
        pageNumber: 1,
        text: "BANK-B statement",
        sourceText: "BANK-B statement",
        sourceLines: [],
        textLineEvidence: [],
      }],
      textLineEvidence: [],
    };
    const importJobs: ImportJob[] = [];
    const importedTransactions: Transaction[] = [];
    let lookedUpContentDigest: string | undefined;

    const response = runPdfImportWorkflow({
      pdfText: sourceDocument.text,
      sourceDocument,
      filePath: "bank-b-statement.pdf",
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
      importJobId: "bank-b-import-job",
      startedAtIso: "2026-05-28T00:00:00Z",
      finishedAtIso: "2026-05-28T00:00:00Z",
    }, {
      parserRegistry: registry,
      getImportedTransactionsForSource: (_sourceType, _sourceName, _accountId, contentDigest) => {
        lookedUpContentDigest = contentDigest;
        return [];
      },
      appendImportJob: (importJob) => importJobs.push(importJob),
      appendTransactions: (transactions) => {
        importedTransactions.push(...transactions);
        return transactions.length;
      },
      getTransactionsForImportJob: (importJobId) =>
        importedTransactions.filter((transaction) => transaction.importJobId === importJobId),
    });

    expect(response).toMatchObject({ ok: true, adapterId: "bank-b-pdf-v1", transactionCount: 1 });
    expect(importJobs[0]).toMatchObject({
      adapterId: "bank-b-pdf-v1",
      provenance: { sourceIdentity: "no.bank-b.statement-pdf" },
    });
    const expectedContentDigest = `import-pdf-${createHash("sha256")
      .update(["bank-b-pdf-v1", SAMPLE_HOUSEHOLD.id, SAMPLE_ACCOUNT.id, sourceDocument.text].join("|"), "utf8")
      .digest("hex")
      .slice(0, 24)}`;
    expect(lookedUpContentDigest).toBe(expectedContentDigest);
    expect(importJobs[0]?.provenance?.contentDigest).toBe(expectedContentDigest);
    expect(importedTransactions).toMatchObject([{ merchantRaw: "BANK-B SHOP", sourceType: "pdf" }]);
  });

  describe("pending bank transaction imports", () => {
    const mixedStatusText = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 3",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "29.05.2026 Varekjøp ACCT-001 SYNTHETIC -45,00 NOK Reservert SYNTHETIC TRANSIT",
      "29.05.2026 Betaling ACCT-001 SYNTHETIC -350,00 NOK Bekreftet SYNTHETIC BILL",
      "28.05.2026 Varekjøp ACCT-001 SYNTHETIC -20,00 NOK Bokført SYNTHETIC SHOP",
    ].join("\n");

    function makeDependencies(ledger: ReturnType<typeof makeTestLedger>) {
      return {
        parserRegistry: defaultParserAdapterRegistry,
        appendImportJob: ledger.appendImportJob,
        appendTransactions: ledger.appendTransactions,
        appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
        getTransactionsForImportJob: ledger.getTransactionsForImportJob,
      };
    }

    it("reports pending observations in the PDF preview before confirmation", () => {
      const preview = previewPdfImportWorkflow({
        pdfText: mixedStatusText,
        filePath: "mixed-status-statement.pdf",
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      }, defaultParserAdapterRegistry);

      expect(preview).toMatchObject({
        ok: true,
        transactions: [{ merchantRaw: "SYNTHETIC SHOP" }],
        excludedRowCount: 2,
        excludedRows: [
          {
            lineNumber: 4,
            status: "Reservert",
            date: "29.05.2026",
            amount: "-45,00",
            currencyCode: "NOK",
            description: "SYNTHETIC TRANSIT",
          },
          {
            lineNumber: 5,
            status: "Bekreftet",
            date: "29.05.2026",
            amount: "-350,00",
            currencyCode: "NOK",
            description: "SYNTHETIC BILL",
          },
        ],
      });
    });

    it("preserves paginated pending observations through preview and import", async () => {
      const ledger = makeTestLedger(randomUUID());
      const existingTransaction: Transaction = {
        id: "existing-acknowledgement-ledger-row",
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
        bookedAtIso: "2026-05-20T00:00:00Z",
        amountMinor: -8100,
        merchantRaw: "SYNTHETIC EXISTING ROW",
        sourceType: "manual",
      };
      const tableHeader = "Dato       Type          Fra konto      Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr";
      const pdfText = [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 5",
        "Kontonummer: ACCT-001",
        tableHeader,
        "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -11,00 NOK Reservert SYNTHETIC RESERVED FIRST",
        "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -12,50 NOK Bokført SYNTHETIC BOOKED FIRST",
        "1/3 Rogaland Sparebank",
        "Transaksjoner Antall: 5",
        "Kontonummer: ACCT-001",
        tableHeader,
        "30.05.2026 Betaling ACCT-001 LOCAL_USER -350,00 NOK Bekreftet SYNTHETIC CONFIRMED MIDDLE",
        "27.05.2026 Lønn ACCT-001 SYNTHETIC EMPLOYER 50 000,00 NOK Bokført Fra: SYNTHETIC PAYROLL",
        "2/3 Rogaland Sparebank",
        "Transaksjoner Antall: 5",
        "Kontonummer: ACCT-001",
        tableHeader,
        "26.05.2026 Varekjøp ACCT-001 LOCAL_USER -41,00 NOK Reservert SYNTHETIC RESERVED LAST",
        "3/3 Rogaland Sparebank",
      ].join("\n");
      const filePath = "paginated-status-statement.pdf";
      const importInput = {
        pdfText,
        filePath,
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
        startedAtIso: "2026-05-31T00:00:00Z",
        finishedAtIso: "2026-05-31T00:00:00Z",
      };

      try {
        ledger.appendTransactions([existingTransaction]);
        const beforeImport = structuredClone(ledger.loadLedgerSnapshotData());
        const preview = await previewPdfImportWorkflowInBatches({
          pdfText,
          filePath,
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
        }, defaultParserAdapterRegistry, {
          batchSize: 1,
          isCancelled: () => false,
          onProgress: () => undefined,
        });

        expect(preview).toMatchObject({
          ok: true,
          adapterId: ROGALAND_ADAPTER_ID,
          excludedRowCount: 3,
          transactions: [
            {
              bookedAtIso: "2026-05-28T00:00:00Z",
              amountMinor: -1250,
              merchantRaw: "SYNTHETIC BOOKED FIRST",
            },
            {
              bookedAtIso: "2026-05-27T00:00:00Z",
              amountMinor: 5_000_000,
              merchantRaw: "Fra: SYNTHETIC PAYROLL",
            },
          ],
          excludedRows: [
            {
              lineNumber: 5,
              status: "Reservert",
              amount: "-11,00",
              description: "SYNTHETIC RESERVED FIRST",
            },
            {
              lineNumber: 11,
              status: "Bekreftet",
              amount: "-350,00",
              description: "SYNTHETIC CONFIRMED MIDDLE",
            },
            {
              lineNumber: 17,
              status: "Reservert",
              amount: "-41,00",
              description: "SYNTHETIC RESERVED LAST",
            },
          ],
          pendingObservations: [
            {
              status: "reserved",
              sourceStatus: "Reservert",
              sourceRowIndex: 4,
            },
            {
              status: "confirmed",
              sourceStatus: "Bekreftet",
              sourceRowIndex: 10,
            },
            {
              status: "reserved",
              sourceStatus: "Reservert",
              sourceRowIndex: 16,
            },
          ],
        });
        if (preview === null || !preview.ok) throw new Error("Expected a valid batched PDF preview");
        expect(ledger.loadLedgerSnapshotData()).toEqual(beforeImport);

        const dependencies = {
          parserRegistry: defaultParserAdapterRegistry,
          appendImportJob: ledger.appendImportJob,
          appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
          appendTransactions: ledger.appendTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
        };
        const imported = runPdfImportWorkflow({
          ...importInput,
          importJobId: "paginated-status-job",
        }, dependencies);
        expect(imported).toMatchObject({
          ok: true,
          transactionCount: 2,
          pendingCount: 3,
          duplicateCount: 0,
          excludedRowCount: 3,
        });
        const afterImport = ledger.loadLedgerSnapshotData();
        expect(afterImport.transactions).toHaveLength(beforeImport.transactions.length + 2);
        expect(afterImport.transactions.filter((transaction) => transaction.id === existingTransaction.id))
          .toEqual([existingTransaction]);
        expect(afterImport.transactions.filter((transaction) => transaction.sourceType === "pdf")
          .map(({ householdId, accountId, bookedAtIso, amountMinor, merchantRaw }) => ({
            householdId,
            accountId,
            bookedAtIso,
            amountMinor,
            merchantRaw,
          })).sort((left, right) => left.bookedAtIso.localeCompare(right.bookedAtIso))).toEqual([
          {
            householdId: SAMPLE_HOUSEHOLD.id,
            accountId: SAMPLE_ACCOUNT.id,
            bookedAtIso: "2026-05-27T00:00:00Z",
            amountMinor: 5_000_000,
            merchantRaw: "Fra: SYNTHETIC PAYROLL",
          },
          {
            householdId: SAMPLE_HOUSEHOLD.id,
            accountId: SAMPLE_ACCOUNT.id,
            bookedAtIso: "2026-05-28T00:00:00Z",
            amountMinor: -1250,
            merchantRaw: "SYNTHETIC BOOKED FIRST",
          },
        ]);
        expect(afterImport.pendingObservations
          ?.map(({ sourceRowIndex, status, sourceStatus }) => ({
            sourceRowIndex,
            status,
            sourceStatus,
          }))
          .sort((left, right) => left.sourceRowIndex - right.sourceRowIndex)
        ).toEqual([
          { sourceRowIndex: 4, status: "reserved", sourceStatus: "Reservert" },
          { sourceRowIndex: 10, status: "confirmed", sourceStatus: "Bekreftet" },
          { sourceRowIndex: 16, status: "reserved", sourceStatus: "Reservert" },
        ]);
      } finally {
        ledger.close();
      }
    });

    it("imports a pending-only statement without booked transactions", () => {
      const ledger = makeTestLedger(randomUUID());
      const pendingOnlyText = [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 1",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "29.05.2026 Varekjøp ACCT-001 SYNTHETIC -45,00 NOK Reservert SYNTHETIC TRANSIT",
      ].join("\n");
      const input = {
        pdfText: pendingOnlyText,
        filePath: "mixed-status-statement.pdf",
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
        importJobId: "mixed-status-job",
        startedAtIso: "2026-05-29T00:00:00Z",
        finishedAtIso: "2026-05-29T00:00:00Z",
      };

      try {
        const response = runPdfImportWorkflow(input, makeDependencies(ledger));

        expect(response).toMatchObject({
          ok: true,
          transactionCount: 0,
          pendingCount: 1,
        });
        expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(0);
        expect(ledger.listPendingTransactionObservations(SAMPLE_HOUSEHOLD.id)).toMatchObject([
          { sourceStatus: "Reservert", status: "reserved" },
        ]);
      } finally {
        ledger.close();
      }
    });

    it("stores pending rows separately while importing booked candidates", () => {
      const ledger = makeTestLedger(randomUUID());
      const input = {
        pdfText: mixedStatusText,
        filePath: "mixed-status-statement.pdf",
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
        importJobId: "mixed-status-acknowledged-job",
        startedAtIso: "2026-05-29T00:00:00Z",
        finishedAtIso: "2026-05-29T00:00:00Z",
      };

      try {
        const response = runPdfImportWorkflow(input, makeDependencies(ledger));

        expect(response).toMatchObject({
          ok: true,
          transactionCount: 1,
          pendingCount: 2,
          excludedRowCount: 2,
        });
        expect(ledger.loadLedgerSnapshotData().transactions).toMatchObject([
          {
            bookedAtIso: "2026-05-28T00:00:00Z",
            amountMinor: -2000,
            merchantRaw: "SYNTHETIC SHOP",
          },
        ]);
        expect(ledger.listPendingTransactionObservations(SAMPLE_HOUSEHOLD.id)).toMatchObject([
          { status: "reserved", sourceStatus: "Reservert" },
          { status: "confirmed", sourceStatus: "Bekreftet" },
        ]);
      } finally {
        ledger.close();
      }
    });
  });

  it("removes temporary ledger files after closing the test database", () => {
    const suffix = randomUUID();
    const tempDir = join(tmpdir(), `budget-pdf-integration-${suffix}`);
    const ledger = makeTestLedger(suffix);

    expect(existsSync(tempDir)).toBe(true);
    try {
      ledger.close();
      expect(existsSync(tempDir)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("AC-1: fixture produces expected transaction candidates", () => {
    it("parses the synthetic fixture into transactions with all required domain fields", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, MAPPING_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.transactions.length).toBeGreaterThan(0);

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

    it("fixture contains at least one income and one expense transaction", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, MAPPING_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const hasIncome = result.transactions.some((tx) => tx.amountMinor > 0);
      const hasExpense = result.transactions.some((tx) => tx.amountMinor < 0);

      expect(hasIncome).toBe(true);
      expect(hasExpense).toBe(true);
    });

    it("transaction ids from the fixture are unique", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, MAPPING_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const ids = result.transactions.map((tx) => tx.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("fixture transactions are compatible with the dashboard app consumer", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, MAPPING_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const contract = buildDashboardViewContract({
        transactions: result.transactions,
        selectedYearMonth: "2026-05",
      });

      expect(contract.state).toBe("ready");
      if (contract.state !== "ready") return;

      expect(contract.snapshot.selectedYearMonth).toBe("2026-05");
      expect(contract.snapshot.monthlyTotals.yearMonth).toBe("2026-05");
    });
  });

  describe("AC-2: import provenance and determinism", () => {
    it("produces identical ordered candidates across repeated parse calls", () => {
      const text = loadFixture();
      const first = parseRogalandStatementText(text, MAPPING_OPTIONS);
      const second = parseRogalandStatementText(text, MAPPING_OPTIONS);

      expect(first).toEqual(second);
    });

    it("adapter ID is stable across repeated parse calls", () => {
      const text = loadFixture();
      const r1 = parseRogalandStatementText(text, MAPPING_OPTIONS);
      const r2 = parseRogalandStatementText(text, MAPPING_OPTIONS);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;
      expect(r1.adapterId).toBe(r2.adapterId);
    });

    it("importJobId is propagated to all transactions", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, { ...MAPPING_OPTIONS, importJobId: "job-pdf-01" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transactions.every((tx) => tx.importJobId === "job-pdf-01")).toBe(true);
    });

    it("persists adapter provenance and ignores a repeated import", () => {
      const ledger = makeTestLedger();
      const text = loadFixture();
      const importJobId = buildRogalandImportJobId(text, MAPPING_OPTIONS);
      const result = parseRogalandStatementText(text, {
        ...MAPPING_OPTIONS,
        importJobId,
        idPrefix: importJobId,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const importJob: ImportJob = {
        id: importJobId,
        householdId: SAMPLE_HOUSEHOLD.id,
        sourceType: "pdf",
        sourceName: "statement.txt",
        adapterId: result.adapterId,
        startedAtIso: "2026-05-31T00:00:00Z",
        finishedAtIso: "2026-05-31T00:00:00Z",
      };

      ledger.appendImportJob(importJob);
      ledger.appendTransactions(result.transactions);
      ledger.appendImportJob(importJob);
      ledger.appendTransactions(result.transactions);

      const snapshot = ledger.loadLedgerSnapshotData();
      expect(snapshot.importJobs).toHaveLength(1);
      expect(snapshot.importJobs[0]?.adapterId).toBe(ROGALAND_ADAPTER_ID);
      expect(snapshot.transactions).toHaveLength(result.transactions.length);
      expect(snapshot.transactions.every((tx) => tx.currencyCode === "NOK")).toBe(true);
      expect(snapshot.transactions.every((tx) => tx.sourceType === "pdf")).toBe(true);
      ledger.close();
    });
  });

  describe("AC-3: invalid or unsupported input returns explicit errors with no partial transactions", () => {
    it("persists valid rows and retains the malformed middle row for review", () => {
      const ledger = makeTestLedger(randomUUID());
      const existingTransaction: Transaction = {
        id: "existing-ledger-row",
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
        bookedAtIso: "2026-05-25T00:00:00Z",
        amountMinor: -501,
        merchantRaw: "SYNTHETIC EXISTING PURCHASE",
        sourceType: "csv",
      };
      const text = [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 3",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -97,70 NOK Bokført SYNTHETIC FIRST",
        "27.05.2026 Varekjøp ACCT-001 LOCAL_USER not-an-amount NOK Bokført SYNTHETIC BROKEN",
        "26.05.2026 Varekjøp ACCT-001 LOCAL_USER -20,00 NOK Bokført SYNTHETIC LAST",
      ].join("\n");

      try {
        ledger.appendTransactions([existingTransaction]);
        const beforeImport = structuredClone(ledger.loadLedgerSnapshotData());

        const response = runPdfImportOrchestration(text, ledger, {
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          sourceName: "mixed-validity-statement.pdf",
        });

        expect(response).toMatchObject({
          ok: true,
          transactionCount: 2,
          unresolvedRowCount: 1,
        });
        const snapshot = ledger.loadLedgerSnapshotData();
        expect(snapshot.transactions).toHaveLength(beforeImport.transactions.length + 2);
        expect(snapshot.transactions).toEqual(expect.arrayContaining([
          ...beforeImport.transactions,
          expect.objectContaining({ merchantRaw: "SYNTHETIC FIRST", amountMinor: -9770 }),
          expect.objectContaining({ merchantRaw: "SYNTHETIC LAST", amountMinor: -2000 }),
        ]));
        expect(ledger.listImportReviewItems(SAMPLE_HOUSEHOLD.id)).toEqual([
          expect.objectContaining({
            sourceName: "mixed-validity-statement.pdf",
            sourceType: "pdf",
            sourceRowIndex: 5,
            rawRow: expect.stringContaining("SYNTHETIC BROKEN"),
            parserErrors: [expect.objectContaining({ code: "INVALID_AMOUNT_FORMAT", field: "amount" })],
            status: "unresolved",
          }),
        ]);
      } finally {
        ledger.close();
      }
    });

    it("preserves page-aware source lines for malformed transactions after a page break", () => {
      const ledger = makeTestLedger(randomUUID());
      const existingTransaction: Transaction = {
        id: "existing-paginated-ledger-row",
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
        bookedAtIso: "2026-05-25T00:00:00Z",
        amountMinor: -501,
        merchantRaw: "SYNTHETIC EXISTING PURCHASE",
        sourceType: "csv",
      };
      const tableHeader = "Dato       Type          Fra konto      Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr";
      const continuationColumn = tableHeader.indexOf("Melding/KID/Fakt.nr") - 8;
      const text = [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 3",
        "Kontonummer: ACCT-001",
        tableHeader,
        "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -10,00 NOK Bokført SYNTHETIC FIRST",
        `${" ".repeat(continuationColumn)}CONTINUED MESSAGE`,
        "1/2 Rogaland Sparebank",
        "Transaksjoner Antall: 3",
        "Kontonummer: ACCT-001",
        tableHeader,
        "27.05.2026 Varekjøp ACCT-001 LOCAL_USER not-an-amount NOK Bokført SYNTHETIC BROKEN",
        "26.05.2026 Varekjøp ACCT-001 LOCAL_USER -20,00 NOK Bokført SYNTHETIC LAST",
      ].join("\n");

      try {
        ledger.appendTransactions([existingTransaction]);
        const beforeImport = structuredClone(ledger.loadLedgerSnapshotData());

        const response = runPdfImportOrchestration(text, ledger, {
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          sourceName: "paginated-malformed-statement.pdf",
        });

        expect(response).toMatchObject({
          ok: true,
          transactionCount: 2,
          unresolvedRowCount: 1,
        });
        expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(beforeImport.transactions.length + 2);
        expect(ledger.listImportReviewItems(SAMPLE_HOUSEHOLD.id)).toEqual([
          expect.objectContaining({
            sourceRowIndex: 10,
            rawRow: expect.stringContaining("SYNTHETIC BROKEN"),
            parserErrors: [expect.objectContaining({ code: "INVALID_AMOUNT_FORMAT", field: "amount" })],
            status: "unresolved",
          }),
        ]);
      } finally {
        ledger.close();
      }
    });

    it("rejects unsupported layout with UNSUPPORTED_LAYOUT and no transactions", () => {
      const result = parseRogalandStatementText("Not a supported bank statement.", MAPPING_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
    });

    it("rejects header-only statement without transaction table with MISSING_TRANSACTION_SECTION", () => {
      const text = "ROGALAND SPAREBANK\nKontonummer: 1234\n";
      const result = parseRogalandStatementText(text, MAPPING_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("MISSING_TRANSACTION_SECTION");
    });

    it("rejects empty text with UNSUPPORTED_LAYOUT", () => {
      const result = parseRogalandStatementText("", MAPPING_OPTIONS);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
    });

    it("normalizePdfImportErrors maps parser errors to the stable IPC failure shape", () => {
      const text = "Wrong bank statement";
      const parseResult = parseRogalandStatementText(text, MAPPING_OPTIONS);

      expect(parseResult.ok).toBe(false);
      if (parseResult.ok) return;

      const failure = normalizePdfImportErrors(parseResult.errors);

      expect(failure.ok).toBe(false);
      expect(failure.errors).toHaveLength(parseResult.errors.length);
      expect(failure.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
      expect(typeof failure.errors[0]?.message).toBe("string");
    });
  });

  describe("AC-4: source-aware adapter with Norwegian digital text layout", () => {
    it("adapter ID is set to the canonical Rogaland adapter identifier", () => {
      const text = loadFixture();
      const result = parseRogalandStatementText(text, MAPPING_OPTIONS);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.adapterId).toBe(ROGALAND_ADAPTER_ID);
      expect(result.adapterId).toBe("rogaland-sparebank-text-v1");
    });
  });

  describe("buildPdfImportRequest contract", () => {
    it("builds a valid request from a file path and options", () => {
      const request = buildPdfImportRequest("/path/to/statement.txt", {
        householdId: "hh-1",
        accountId: "acc-1",
      });

      expect(request.filePath).toBe("/path/to/statement.txt");
      expect(request.householdId).toBe("hh-1");
      expect(request.accountId).toBe("acc-1");
    });

    it("throws when filePath is empty", () => {
      expect(() =>
        buildPdfImportRequest("", { householdId: "hh-1", accountId: "acc-1" })
      ).toThrow("filePath must be a non-empty string.");
    });

    it("throws when householdId is blank", () => {
      expect(() =>
        buildPdfImportRequest("/path/to/file.txt", { householdId: "  ", accountId: "acc-1" })
      ).toThrow("householdId must be a non-empty string.");
    });

    it("throws when accountId is blank", () => {
      expect(() =>
        buildPdfImportRequest("/path/to/file.txt", { householdId: "hh-1", accountId: "" })
      ).toThrow("accountId must be a non-empty string.");
    });

    it("trims whitespace from filePath", () => {
      const request = buildPdfImportRequest("  /path/to/file.txt  ", {
        householdId: "hh-1",
        accountId: "acc-1",
      });

      expect(request.filePath).toBe("/path/to/file.txt");
    });
  });

  describe("Scenario 1: SQLite persistence – fixture creates expected transactions and import-job provenance", () => {
    it("persists the paginated bank export through the adapter and import workflow", () => {
      const ledger = makeTestLedger(randomUUID());
      const text = readFileSync(PAGINATED_EXPORT_FIXTURE_PATH, "utf8");

      try {
        const response = runPdfImportOrchestration(text, ledger, {
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          sourceName: "rogaland-paginated-export.txt",
        });

        expect(response).toMatchObject({
          ok: true,
          transactionCount: 2,
          adapterId: ROGALAND_ADAPTER_ID,
        });
        const snapshot = ledger.loadLedgerSnapshotData();
        expect(snapshot.transactions).toMatchObject([
          {
            bookedAtIso: "2026-05-28T00:00:00Z",
            amountMinor: -9770,
            merchantRaw: "27.05 SYNTHETIC MARKET 7 SANDNES",
          },
          {
            bookedAtIso: "2026-05-27T00:00:00Z",
            amountMinor: 5_000_000,
            merchantRaw: "Fra: SYNTHETIC EMPLOYER",
          },
        ]);
        expect(snapshot.importJobs[0]?.adapterId).toBe(ROGALAND_ADAPTER_ID);
      } finally {
        ledger.close();
      }
    });

    it("writes one import_jobs record and expected transaction rows for the synthetic fixture", () => {
      const ledger = makeTestLedger(randomUUID());
      const text = loadFixture();

      const response = runPdfImportOrchestration(text, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;

      expect(response.transactionCount).toBeGreaterThan(0);

      const snapshot = ledger.loadLedgerSnapshotData();

      expect(snapshot.importJobs).toHaveLength(1);
      expect(snapshot.importJobs[0]).toEqual({
        id: response.importJobId,
        householdId: SAMPLE_HOUSEHOLD.id,
        sourceType: "pdf",
        sourceName: "rogaland-statement.txt",
        adapterId: ROGALAND_ADAPTER_ID,
        candidateCount: response.transactionCount,
        validationFailureCount: 0,
        provenance: {
          sourceIdentity: ROGALAND_SOURCE_ID,
          contentDigest: buildRogalandImportJobId(text, MAPPING_OPTIONS),
          adapterId: ROGALAND_ADAPTER_ID,
          accountId: SAMPLE_ACCOUNT.id,
          storyAnchor: {
            enablerIssueId: "32",
            featureIssueId: "15",
          },
        },
        startedAtIso: expect.any(String),
        finishedAtIso: expect.any(String),
      });
      expect(snapshot.transactions).toHaveLength(response.transactionCount);

      for (const tx of snapshot.transactions) {
        expect(tx.householdId).toBe(SAMPLE_HOUSEHOLD.id);
        expect(tx.accountId).toBe(SAMPLE_ACCOUNT.id);
        expect(Number.isInteger(tx.amountMinor)).toBe(true);
        expect(tx.bookedAtIso).toMatch(ISO_DATETIME_PATTERN);
        expect(typeof tx.merchantRaw).toBe("string");
        expect(tx.merchantRaw.length).toBeGreaterThan(0);
      }

      ledger.close();
    });

    it("adapter ID in the import response identifies the Rogaland adapter", () => {
      const ledger = makeTestLedger(randomUUID());
      const text = loadFixture();

      const response = runPdfImportOrchestration(text, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;

      expect(response.adapterId).toBe(ROGALAND_ADAPTER_ID);

      ledger.close();
    });

    it("imported PDF transactions are visible in the dashboard view contract for their month", () => {
      const ledger = makeTestLedger(randomUUID());
      const text = loadFixture();

      const response = runPdfImportOrchestration(text, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;

      const snapshot = ledger.loadLedgerSnapshotData();
      const contract = buildDashboardViewContract({
        transactions: snapshot.transactions,
        selectedYearMonth: "2026-05",
      });

      expect(contract.state).toBe("ready");
      if (contract.state !== "ready") return;

      expect(contract.snapshot.selectedYearMonth).toBe("2026-05");
      expect(contract.snapshot.monthlyTotals.yearMonth).toBe("2026-05");
      expect(contract.snapshot.categoryBreakdown.entries.length).toBeGreaterThan(0);

      ledger.close();
    });
  });

  describe("Scenario 2: duplicate-safe re-import – second import of same fixture leaves ledger row count unchanged", () => {
    it("imports identical statement content once and preserves stored records on re-import", () => {
      const ledger = makeTestLedger(randomUUID());
      const pdfText = [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 2",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -12,50 NOK Bokført SYNTHETIC MARKET",
        "27.05.2026 Refusjon ACCT-001 LOCAL_USER 3,25 NOK Bokført SYNTHETIC REFUND",
      ].join("\n");
      const filePath = "identical-purchases.pdf";
      const dependencies = {
        parserRegistry: defaultParserAdapterRegistry,
        getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
        getExistingTransactionsForAccount: ledger.getTransactionsForAccount,
        appendImportJob: ledger.appendImportJob,
        appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
        appendTransactions: ledger.appendTransactions,
        getTransactionsForImportJob: ledger.getTransactionsForImportJob,
      };

      try {
        const first = runPdfImportWorkflow({
          pdfText,
          filePath,
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          importJobId: "identical-pdf-first-job",
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:00Z",
        }, dependencies);
        expect(first).toMatchObject({ ok: true, transactionCount: 2, duplicateCount: 0 });
        if (!first.ok) throw new Error("Expected the first import to succeed");
        const firstSnapshot = structuredClone(ledger.loadLedgerSnapshotData());
        const storedTransactions = firstSnapshot.transactions;
        expect(storedTransactions).toHaveLength(2);
        expect(storedTransactions.map(({
          householdId,
          accountId,
          bookedAtIso,
          amountMinor,
          merchantRaw,
          sourceType,
          importJobId,
        }) => ({
          householdId,
          accountId,
          bookedAtIso,
          amountMinor,
          merchantRaw,
          sourceType,
          importJobId,
        })).sort((left, right) => left.bookedAtIso.localeCompare(right.bookedAtIso))).toEqual([
          {
            householdId: SAMPLE_HOUSEHOLD.id,
            accountId: SAMPLE_ACCOUNT.id,
            bookedAtIso: "2026-05-27T00:00:00Z",
            amountMinor: 325,
            merchantRaw: "SYNTHETIC REFUND",
            sourceType: "pdf",
            importJobId: "identical-pdf-first-job",
          },
          {
            householdId: SAMPLE_HOUSEHOLD.id,
            accountId: SAMPLE_ACCOUNT.id,
            bookedAtIso: "2026-05-28T00:00:00Z",
            amountMinor: -1250,
            merchantRaw: "SYNTHETIC MARKET",
            sourceType: "pdf",
            importJobId: "identical-pdf-first-job",
          },
        ]);
        const firstImportJob = firstSnapshot.importJobs.find((job) => job.id === first.importJobId);
        expect(firstImportJob).toMatchObject({
          sourceType: "pdf",
          sourceName: filePath,
          adapterId: ROGALAND_ADAPTER_ID,
          provenance: {
            sourceIdentity: ROGALAND_SOURCE_ID,
            adapterId: ROGALAND_ADAPTER_ID,
            accountId: SAMPLE_ACCOUNT.id,
            contentDigest: expect.any(String),
          },
        });

        const retry = runPdfImportWorkflow({
          pdfText,
          filePath,
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          importJobId: "identical-pdf-retry-job",
          startedAtIso: "2026-05-30T00:00:00Z",
          finishedAtIso: "2026-05-30T00:00:00Z",
        }, dependencies);
        expect(retry).toMatchObject({ ok: true, transactionCount: 0, duplicateCount: 2 });
        const afterRetry = ledger.loadLedgerSnapshotData();
        expect(afterRetry.transactions).toEqual(firstSnapshot.transactions);
        expect(afterRetry.importJobs.find((job) => job.id === firstImportJob?.id)).toEqual(firstImportJob);
      } finally {
        ledger.close();
      }
    });

    it("imports into account B without changing unrelated transactions in accounts A or B", () => {
      const accountA: Account = {
        id: "account-a",
        householdId: SAMPLE_HOUSEHOLD.id,
        name: "Account A",
        currencyCode: "NOK",
      };
      const accountB: Account = {
        id: "account-b",
        householdId: SAMPLE_HOUSEHOLD.id,
        name: "Account B",
        currencyCode: "NOK",
      };
      const ledger = makeTestLedger(randomUUID(), [accountA, accountB]);
      const existingAccountATransaction: Transaction = {
        id: "existing-account-a-row",
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: accountA.id,
        bookedAtIso: "2026-05-20T00:00:00Z",
        amountMinor: -7100,
        merchantRaw: "SYNTHETIC ACCOUNT A PURCHASE",
        sourceType: "manual",
      };
      const existingAccountBTransaction: Transaction = {
        id: "existing-account-b-row",
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: accountB.id,
        bookedAtIso: "2026-05-21T00:00:00Z",
        amountMinor: 8200,
        merchantRaw: "SYNTHETIC ACCOUNT B INCOME",
        sourceType: "manual",
      };
      const pdfText = [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 2",
        "Kontonummer: ACCT-002",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "28.05.2026 Varekjøp ACCT-002 LOCAL_USER -12,50 NOK Bokført SYNTHETIC B PURCHASE",
        "27.05.2026 Refusjon ACCT-002 LOCAL_USER 3,25 NOK Bokført SYNTHETIC B REFUND",
      ].join("\n");
      const importJobId = "account-b-import-job";

      try {
        ledger.appendTransactions([existingAccountATransaction, existingAccountBTransaction]);
        const beforeSnapshot = structuredClone(ledger.loadLedgerSnapshotData());
        const response = runPdfImportWorkflow({
          pdfText,
          filePath: "account-b-statement.pdf",
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: accountB.id,
          importJobId,
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:00Z",
        }, {
          parserRegistry: defaultParserAdapterRegistry,
          getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
          getExistingTransactionsForAccount: ledger.getTransactionsForAccount,
          appendImportJob: ledger.appendImportJob,
          appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
          appendTransactions: ledger.appendTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
        });

        expect(response).toMatchObject({ ok: true, transactionCount: 2, duplicateCount: 0 });
        const afterSnapshot = ledger.loadLedgerSnapshotData();
        const existingIds = new Set(beforeSnapshot.transactions.map((transaction) => transaction.id));
        const unchangedTransactions = afterSnapshot.transactions
          .filter((transaction) => existingIds.has(transaction.id))
          .sort((left, right) => left.id.localeCompare(right.id));
        expect(unchangedTransactions).toEqual(
          [...beforeSnapshot.transactions].sort((left, right) => left.id.localeCompare(right.id))
        );

        const importedTransactions = afterSnapshot.transactions.filter(
          (transaction) => !existingIds.has(transaction.id)
        );
        expect(importedTransactions).toHaveLength(2);
        expect(importedTransactions.map(({
          householdId,
          accountId,
          bookedAtIso,
          amountMinor,
          merchantRaw,
          sourceType,
          importJobId: transactionImportJobId,
        }) => ({
          householdId,
          accountId,
          bookedAtIso,
          amountMinor,
          merchantRaw,
          sourceType,
          importJobId: transactionImportJobId,
        })).sort((left, right) => left.bookedAtIso.localeCompare(right.bookedAtIso))).toEqual([
          {
            householdId: SAMPLE_HOUSEHOLD.id,
            accountId: accountB.id,
            bookedAtIso: "2026-05-27T00:00:00Z",
            amountMinor: 325,
            merchantRaw: "SYNTHETIC B REFUND",
            sourceType: "pdf",
            importJobId,
          },
          {
            householdId: SAMPLE_HOUSEHOLD.id,
            accountId: accountB.id,
            bookedAtIso: "2026-05-28T00:00:00Z",
            amountMinor: -1250,
            merchantRaw: "SYNTHETIC B PURCHASE",
            sourceType: "pdf",
            importJobId,
          },
        ]);
        expect(afterSnapshot.transactions.filter((transaction) => transaction.accountId === accountA.id))
          .toEqual([existingAccountATransaction]);
        expect(afterSnapshot.importJobs.find((job) => job.id === importJobId)).toMatchObject({
          householdId: SAMPLE_HOUSEHOLD.id,
          sourceType: "pdf",
          sourceName: "account-b-statement.pdf",
          adapterId: ROGALAND_ADAPTER_ID,
          provenance: {
            sourceIdentity: ROGALAND_SOURCE_ID,
            adapterId: ROGALAND_ADAPTER_ID,
            accountId: accountB.id,
            contentDigest: expect.any(String),
          },
        });
      } finally {
        ledger.close();
      }
    });

    it("reconciles prior rows when the same PDF path is re-exported with added transactions", () => {
      const ledger = makeTestLedger(randomUUID());
      const originalText = loadFixture();
      const filePath = "same-path-statement.pdf";
      const oldJobId = buildRogalandImportJobId(originalText, MAPPING_OPTIONS);
      const oldParse = parseRogalandStatementText(originalText, {
        ...MAPPING_OPTIONS,
        importJobId: oldJobId,
      });
      expect(oldParse.ok).toBe(true);
      if (!oldParse.ok) return;

      try {
        const legacyTransactions = oldParse.transactions.map((transaction) => ({
          ...transaction,
          id: buildTransactionFingerprint(transaction),
        }));
        ledger.appendImportJobAndTransactions({
          id: oldJobId,
          householdId: SAMPLE_HOUSEHOLD.id,
          sourceType: "pdf",
          sourceName: filePath,
          adapterId: oldParse.adapterId,
          startedAtIso: "2026-05-31T00:00:00Z",
        }, legacyTransactions);

        const expandedText = `${originalText}\n14.05.2026   NEW MERCHANT Purchase                      -10,00      32 316,60\n`;
        const newJobId = buildRogalandImportJobId(expandedText, MAPPING_OPTIONS);
        const response = runPdfImportWorkflow({
          pdfText: expandedText,
          filePath,
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          importJobId: newJobId,
          startedAtIso: "2026-06-01T00:00:00Z",
          finishedAtIso: "2026-06-01T00:00:00Z",
        }, {
          parserRegistry: defaultParserAdapterRegistry,
          getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
          appendImportJob: ledger.appendImportJob,
          appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
          appendTransactions: ledger.appendTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
        });

        expect(response).toMatchObject({ ok: true, transactionCount: 1, duplicateCount: oldParse.transactions.length });
        expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(oldParse.transactions.length + 1);
      } finally {
        ledger.close();
      }
    });

    it("reconciles a PDF copied unchanged to a new path before that copy is extended", () => {
      const ledger = makeTestLedger(randomUUID());
      const text = loadFixture();
      const contentIdentity = buildRogalandImportJobId(text, MAPPING_OPTIONS);

      try {
        const originalParse = parseRogalandStatementText(text, {
          ...MAPPING_OPTIONS,
          importJobId: contentIdentity,
        });
        expect(originalParse.ok).toBe(true);
        if (!originalParse.ok) return;
        const legacyRows = originalParse.transactions.map((transaction) => ({
          ...transaction,
          id: buildTransactionFingerprint(transaction),
        }));
        ledger.appendImportJobAndTransactions({
          id: contentIdentity,
          householdId: SAMPLE_HOUSEHOLD.id,
          sourceType: "pdf",
          sourceName: "A.pdf",
          adapterId: originalParse.adapterId,
          startedAtIso: "2026-05-31T00:00:00Z",
        }, legacyRows);
        ledger.appendImportJob({
          id: "copy-b-same-content",
          householdId: SAMPLE_HOUSEHOLD.id,
          sourceType: "pdf",
          sourceName: "B.pdf",
          adapterId: originalParse.adapterId,
          startedAtIso: "2026-05-31T00:00:01Z",
          provenance: { sourceIdentity: ROGALAND_SOURCE_ID, contentDigest: contentIdentity },
        });

        const expandedText = `${text}\n14.05.2026   NEW MERCHANT Purchase                      -10,00      32 316,60\n`;
        expect(ledger.getImportedTransactionsForSource(
          "pdf",
          "B.pdf",
          SAMPLE_ACCOUNT.id,
          buildRogalandImportJobId(expandedText, MAPPING_OPTIONS)
        )).toHaveLength(originalParse.transactions.length);
        const expandedJobId = `job-path-b-${randomUUID()}`;
        const response = runPdfImportWorkflow({
          pdfText: expandedText,
          filePath: "B.pdf",
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          importJobId: expandedJobId,
          startedAtIso: "2026-06-01T00:00:00Z",
          finishedAtIso: "2026-06-01T00:00:00Z",
        }, {
          parserRegistry: defaultParserAdapterRegistry,
          getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
          appendImportJob: ledger.appendImportJob,
          appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
          appendTransactions: ledger.appendTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
        });

        expect(response).toMatchObject({ ok: true, transactionCount: 1, duplicateCount: 10 });
        expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(11);
      } finally {
        ledger.close();
      }
    });

    it("does not duplicate a PDF statement imported with legacy fingerprint IDs", () => {
      const ledger = makeTestLedger(randomUUID());
      const text = loadFixture();
      const importJobId = buildRogalandImportJobId(text, MAPPING_OPTIONS);
      const parsed = parseRogalandStatementText(text, {
        ...MAPPING_OPTIONS,
        importJobId,
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      try {
        const legacyTransactions = parsed.transactions.map((transaction) => ({
          ...transaction,
          id: buildTransactionFingerprint(transaction),
        }));
        const legacyJob: ImportJob = {
          id: importJobId,
          householdId: SAMPLE_HOUSEHOLD.id,
          sourceType: "pdf",
          sourceName: "legacy-statement.pdf",
          startedAtIso: "2026-05-31T00:00:00Z",
        };
        expect(ledger.appendImportJobAndTransactions(legacyJob, legacyTransactions)).toBe(legacyTransactions.length);

        const response = runPdfImportWorkflow({
          pdfText: text,
          filePath: "legacy-statement.pdf",
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          importJobId,
          startedAtIso: "2026-06-01T00:00:00Z",
          finishedAtIso: "2026-06-01T00:00:00Z",
        }, {
          parserRegistry: defaultParserAdapterRegistry,
          hasImportJob: ledger.hasImportJob,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
          appendImportJob: ledger.appendImportJob,
          appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
          appendTransactions: ledger.appendTransactions,
        });

        expect(response).toMatchObject({
          ok: true,
          transactionCount: 0,
          duplicateCount: parsed.transactions.length,
        });
        expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(parsed.transactions.length);
      } finally {
        ledger.close();
      }
    });

    it("re-importing the same fixture does not create duplicate transaction rows", () => {
      const ledger = makeTestLedger(randomUUID());
      const text = loadFixture();

      const first = runPdfImportOrchestration(text, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const snapshotAfterFirst = ledger.loadLedgerSnapshotData();
      const countAfterFirst = snapshotAfterFirst.transactions.length;
      expect(countAfterFirst).toBe(first.transactionCount);

      const second = runPdfImportOrchestration(text, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      expect(second.ok).toBe(true);
      if (!second.ok) return;

      const snapshotAfterSecond = ledger.loadLedgerSnapshotData();
      expect(snapshotAfterSecond.transactions).toHaveLength(countAfterFirst);
      expect(second.transactionCount).toBe(0);
      expect(second.duplicateCount).toBe(first.transactionCount);

      ledger.close();
    });

    it("re-importing preserves original transaction fingerprints", () => {
      const ledger = makeTestLedger(randomUUID());
      const text = loadFixture();

      runPdfImportOrchestration(text, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      const firstIds = ledger.loadLedgerSnapshotData().transactions.map((tx) => tx.id).sort();

      runPdfImportOrchestration(text, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      const secondIds = ledger.loadLedgerSnapshotData().transactions.map((tx) => tx.id).sort();

      expect(secondIds).toEqual(firstIds);

      ledger.close();
    });

    it("two separate import jobs are recorded but the transaction count remains stable", () => {
      const ledger = makeTestLedger(randomUUID());
      const text = loadFixture();

      runPdfImportOrchestration(text, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });
      runPdfImportOrchestration(text, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      const snapshot = ledger.loadLedgerSnapshotData();

      expect(snapshot.importJobs).toHaveLength(2);
      const parseResult = parseRogalandStatementText(text, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });
      expect(parseResult.ok).toBe(true);
      if (!parseResult.ok) return;

      expect(snapshot.transactions).toHaveLength(parseResult.transactions.length);

      ledger.close();
    });

    it("re-importing does not duplicate the visible transaction collection", () => {
      const ledger = makeTestLedger(randomUUID());
      const visibleTransactions: Transaction[] = [];
      const text = loadFixture();
      const appendVisibleTransactions = (transactions: Transaction[]): void => {
        appendUniqueTransactions(visibleTransactions, transactions);
      };

      const first = runPdfImportWorkflow(
        {
          pdfText: text,
          filePath: "rogaland-statement.txt",
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          importJobId: `import-pdf-test-${randomUUID()}`,
          startedAtIso: "2026-05-31T12:00:00Z",
          finishedAtIso: "2026-05-31T12:00:00Z",
        },
        {
          parserRegistry: defaultParserAdapterRegistry,
          appendImportJob: ledger.appendImportJob,
          appendTransactions: ledger.appendTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
          onTransactionsPersisted: appendVisibleTransactions,
        }
      );

      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const second = runPdfImportWorkflow(
        {
          pdfText: text,
          filePath: "rogaland-statement.txt",
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
          importJobId: `import-pdf-test-${randomUUID()}`,
          startedAtIso: "2026-05-31T12:00:01Z",
          finishedAtIso: "2026-05-31T12:00:01Z",
        },
        {
          parserRegistry: defaultParserAdapterRegistry,
          appendImportJob: ledger.appendImportJob,
          appendTransactions: ledger.appendTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
          onTransactionsPersisted: appendVisibleTransactions,
        }
      );

      expect(second.ok).toBe(true);
      expect(visibleTransactions).toHaveLength(first.transactionCount);

      ledger.close();
    });
  });

  describe("Scenario 3: malformed input persists no partial transactions", () => {
    it("an unsupported layout returns ok=false and writes zero transactions to the ledger", () => {
      const ledger = makeTestLedger(randomUUID());

      const response = runPdfImportOrchestration("Not a bank statement at all.", ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      expect(response.ok).toBe(false);

      const snapshot = ledger.loadLedgerSnapshotData();
      expect(snapshot.transactions).toHaveLength(0);
      expect(snapshot.importJobs).toHaveLength(0);

      ledger.close();
    });

    it("a header-only statement without a transaction table persists no transactions", () => {
      const ledger = makeTestLedger(randomUUID());

      const response = runPdfImportOrchestration(
        "ROGALAND SPAREBANK\nKontonummer: 1234\n",
        ledger,
        { householdId: SAMPLE_HOUSEHOLD.id, accountId: SAMPLE_ACCOUNT.id }
      );

      expect(response.ok).toBe(false);

      const snapshot = ledger.loadLedgerSnapshotData();
      expect(snapshot.transactions).toHaveLength(0);
      expect(snapshot.importJobs).toHaveLength(0);

      ledger.close();
    });
  });

  describe("Scenario 4: legacy SQLite schema migration", () => {
    it("adds nullable import provenance columns and preserves existing records after reopen", () => {
      const tempDirectory = mkdtempSync(join(tmpdir(), "budget-pdf-migration-"));
      const dbPath = join(tempDirectory, "legacy.sqlite");
      const legacyDatabase = new DatabaseSync(dbPath);

      legacyDatabase.exec(`
        CREATE TABLE households (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at_iso TEXT NOT NULL
        );
        INSERT INTO households (id, name, created_at_iso)
        VALUES ('hh-legacy', 'Legacy Household', '2026-01-01T00:00:00Z');
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY,
          household_id TEXT NOT NULL,
          name TEXT NOT NULL,
          currency_code TEXT NOT NULL
        );
        INSERT INTO accounts (id, household_id, name, currency_code)
        VALUES ('acc-legacy', 'hh-legacy', 'Brukskonto', 'NOK');
        CREATE TABLE transactions (
          id TEXT PRIMARY KEY,
          household_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          booked_at_iso TEXT NOT NULL,
          amount_minor INTEGER NOT NULL,
          merchant_raw TEXT NOT NULL,
          category_id TEXT,
          import_job_id TEXT
        );
        INSERT INTO transactions (
          id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
          category_id, import_job_id
        ) VALUES (
          'tx-legacy', 'hh-legacy', 'acc-legacy', '2026-05-01T00:00:00Z', -1250,
          'Legacy Merchant', 'groceries', 'job-legacy'
        );
        CREATE TABLE import_jobs (
          id TEXT PRIMARY KEY,
          household_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_name TEXT NOT NULL,
          started_at_iso TEXT NOT NULL,
          finished_at_iso TEXT
        );
        INSERT INTO import_jobs (
          id, household_id, source_type, source_name, started_at_iso, finished_at_iso
        ) VALUES (
          'job-legacy', 'hh-legacy', 'pdf', 'legacy.pdf',
          '2026-05-01T00:00:00Z', '2026-05-01T00:01:00Z'
        );
        CREATE TABLE monthly_category_targets (
          year_month TEXT NOT NULL,
          category_id TEXT NOT NULL,
          target_minor INTEGER NOT NULL,
          PRIMARY KEY (year_month, category_id)
        );
      `);
      legacyDatabase.close();

      const ledger = createLocalLedgerDatabase({
        dbPath,
        seedData: {
          household: SAMPLE_HOUSEHOLD,
          accounts: [],
          transactions: [],
          importJobs: [],
          monthlyCategoryTargets: [],
        },
      });
      let ledgerClosed = false;

      try {
        const before = ledger.loadLedgerSnapshotData();

        expect(before.household).toEqual({
          id: "hh-legacy",
          name: "Legacy Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        });
        expect(before.accounts).toEqual([
          {
            id: "acc-legacy",
            householdId: "hh-legacy",
            name: "Brukskonto",
            currencyCode: "NOK",
          },
        ]);
        expect(before.transactions).toEqual([
          {
            id: "tx-legacy",
            householdId: "hh-legacy",
            accountId: "acc-legacy",
            bookedAtIso: "2026-05-01T00:00:00Z",
            amountMinor: -1250,
            merchantRaw: "Legacy Merchant",
            categoryId: "groceries",
            importJobId: "job-legacy",
          },
        ]);
        expect(before.importJobs).toEqual([
          {
            id: "job-legacy",
            householdId: "hh-legacy",
            sourceType: "pdf",
            sourceName: "legacy.pdf",
            startedAtIso: "2026-05-01T00:00:00Z",
            finishedAtIso: "2026-05-01T00:01:00Z",
          },
        ]);

        ledger.appendImportJob({
          id: "job-migrated",
          householdId: "hh-legacy",
          sourceType: "pdf",
          sourceName: "migrated.pdf",
          adapterId: ROGALAND_ADAPTER_ID,
          candidateCount: 1,
          validationFailureCount: 0,
          startedAtIso: "2026-05-02T00:00:00Z",
          finishedAtIso: "2026-05-02T00:01:00Z",
        });

        const after = ledger.loadLedgerSnapshotData();
        expect(after.household).toEqual(before.household);
        expect(after.accounts).toEqual(before.accounts);
        expect(after.transactions).toEqual(before.transactions);
        expect(after.importJobs[0]).toEqual(before.importJobs[0]);
        expect(after.importJobs[1]).toEqual({
          id: "job-migrated",
          householdId: "hh-legacy",
          sourceType: "pdf",
          sourceName: "migrated.pdf",
          adapterId: ROGALAND_ADAPTER_ID,
          candidateCount: 1,
          validationFailureCount: 0,
          startedAtIso: "2026-05-02T00:00:00Z",
          finishedAtIso: "2026-05-02T00:01:00Z",
        });

        ledger.close();
        ledgerClosed = true;

        const reopenedLedger = createLocalLedgerDatabase({
          dbPath,
          seedData: {
            household: SAMPLE_HOUSEHOLD,
            accounts: [],
            transactions: [],
            importJobs: [],
            monthlyCategoryTargets: [],
          },
        });
        try {
          expect(reopenedLedger.loadLedgerSnapshotData()).toEqual(after);
        } finally {
          reopenedLedger.close();
        }
      } finally {
        if (!ledgerClosed) {
          ledger.close();
        }
        rmSync(tempDirectory, { recursive: true, force: true });
      }
    });
  });
});
