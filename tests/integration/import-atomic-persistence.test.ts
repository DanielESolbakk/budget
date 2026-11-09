import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { runCsvImportWorkflow } from "../../src/app/import/importCsv.js";
import { runPdfImportWorkflow } from "../../src/app/import/importPdf.js";
import { parseCsvText } from "../../src/domain/import/parseCsvText.js";
import { defaultParserAdapterRegistry } from "../../src/domain/import/parserAdapterRegistry.js";
import { withIsolatedLedger } from "../helpers/isolatedLedger.js";

const csvText = [
  "Utført dato;Beskrivelse;Beløp ut;Valuta;Status",
  "28.05.2026;SYNTHETIC BOOKED;-12.50;NOK;Bokført",
  "27.05.2026;SYNTHETIC BROKEN;not-a-number;NOK;Bokført",
  "26.05.2026;SYNTHETIC PENDING;-20.00;NOK;Reservert",
].join("\n");
const pdfText = [
  "ROGALAND SPAREBANK",
  "Transaksjoner Antall: 3",
  "Kontonummer: ACCT-001",
  "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
  "28.05.2026 Varekjøp ACCT-001 SYNTHETIC -12,50 NOK Bokført SYNTHETIC BOOKED",
  "27.05.2026 Varekjøp ACCT-001 SYNTHETIC not-an-amount NOK Bokført SYNTHETIC BROKEN",
  "26.05.2026 Varekjøp ACCT-001 SYNTHETIC -20,00 NOK Reservert SYNTHETIC PENDING",
].join("\n");

describe("production import atomic persistence", () => {
  it.each(["csv", "pdf"] as const)("%s commits booked, review and pending records together", async (source) => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      const input = {
        filePath: `synthetic.${source}`, householdId: "hh-isolated", accountId: "acc-isolated",
        importJobId: "atomic-job", startedAtIso: "2026-06-01T12:00:00Z", finishedAtIso: "2026-06-01T12:00:01Z",
      };
      const result = source === "csv"
        ? runCsvImportWorkflow({ ...input, rows: parseCsvText(csvText), sourceIdentity: "atomic-csv", sourceScope: "synthetic.csv" }, {
          categoryRules: new Map(), ...ledger,
        })
        : runPdfImportWorkflow({ ...input, pdfText, acknowledgeExcludedRows: true }, {
          parserRegistry: defaultParserAdapterRegistry, ...ledger,
        });
      expect(result).toMatchObject({ ok: true, transactionCount: 1, pendingCount: 1 });
      expect(ledger.loadLedgerSnapshotData().importJobs).toHaveLength(1);
      expect(ledger.getTransactionsForImportJob("atomic-job")).toMatchObject([{ amountMinor: -1250 }]);
      expect(ledger.listImportReviewItems("hh-isolated")).toHaveLength(1);
      expect(ledger.listPendingTransactionObservations("hh-isolated")).toMatchObject([{ amountMinor: -2000, status: "reserved" }]);
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.loadLedgerSnapshotData()).toEqual(ledger.loadLedgerSnapshotData());
        expect(reopened.listImportReviewItems("hh-isolated")).toHaveLength(1);
        expect(reopened.listPendingTransactionObservations("hh-isolated")).toMatchObject([
          { amountMinor: -2000, status: "reserved" },
        ]);
        expect(reopened.listImportJobHistory("hh-isolated")).toMatchObject([
          { id: "atomic-job", importedCount: 2, undoAvailable: true },
        ]);
      } finally {
        reopened.close();
      }
    });
  });
  it.each([
    { source: "csv", table: "import_review_items" },
    { source: "csv", table: "pending_transaction_observations" },
    { source: "pdf", table: "import_review_items" },
    { source: "pdf", table: "pending_transaction_observations" },
  ] as const)("$source preserves rollback after reopen when $table insertion fails", async ({ source, table }) => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      const database = new DatabaseSync(dbPath);
      try {
        database.exec(`CREATE TRIGGER synthetic_import_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic persistence fault'); END;`);
      } finally {
        database.close();
      }
      const before = ledger.loadLedgerSnapshotData();
      const input = {
        filePath: `synthetic.${source}`, householdId: "hh-isolated", accountId: "acc-isolated",
        importJobId: "atomic-job", startedAtIso: "2026-06-01T12:00:00Z", finishedAtIso: "2026-06-01T12:00:01Z",
      };
      expect(() => source === "csv"
        ? runCsvImportWorkflow({ ...input, rows: parseCsvText(csvText), sourceIdentity: "atomic-csv", sourceScope: "synthetic.csv" }, {
          categoryRules: new Map(), ...ledger,
        })
        : runPdfImportWorkflow({ ...input, pdfText, acknowledgeExcludedRows: true }, {
          parserRegistry: defaultParserAdapterRegistry, ...ledger,
        })).toThrow("synthetic persistence fault");
      expect(ledger.loadLedgerSnapshotData()).toEqual(before);
      expect(ledger.listImportReviewItems("hh-isolated")).toEqual([]);
      expect(ledger.listPendingTransactionObservations("hh-isolated")).toEqual([]);
      expect(ledger.listImportJobHistory("hh-isolated")).toEqual([]);
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.loadLedgerSnapshotData()).toEqual(before);
        expect(reopened.listImportReviewItems("hh-isolated")).toEqual([]);
        expect(reopened.listPendingTransactionObservations("hh-isolated")).toEqual([]);
        expect(reopened.listImportJobHistory("hh-isolated")).toEqual([]);
      } finally {
        reopened.close();
      }
    });
  });
  it("rolls back a booked-only PDF job after a later transaction fails and permits a clean retry", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      const bookedText = [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 2",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "28.05.2026 Varekjøp ACCT-001 SYNTHETIC -12,50 NOK Bokført SYNTHETIC FIRST",
        "29.05.2026 Varekjøp ACCT-001 SYNTHETIC -20,00 NOK Bokført SYNTHETIC SECOND",
      ].join("\n");
      const input = {
        pdfText: bookedText,
        filePath: "synthetic.pdf", householdId: "hh-isolated", accountId: "acc-isolated",
        importJobId: "booked-job", startedAtIso: "2026-06-01T12:00:00Z", finishedAtIso: "2026-06-01T12:00:01Z",
      };
      const database = new DatabaseSync(dbPath);
      try {
        database.exec(`
          CREATE TRIGGER synthetic_booked_failure BEFORE INSERT ON transactions
          WHEN NEW.amount_minor = -2000
          BEGIN SELECT RAISE(ABORT, 'synthetic booked persistence fault'); END;
        `);
      } finally {
        database.close();
      }
      const before = ledger.loadLedgerSnapshotData();
      expect(() => runPdfImportWorkflow(input, {
        parserRegistry: defaultParserAdapterRegistry, ...ledger,
      })).toThrow("synthetic booked persistence fault");
      expect(ledger.loadLedgerSnapshotData()).toEqual(before);
      expect(ledger.listImportJobHistory("hh-isolated")).toEqual([]);
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.loadLedgerSnapshotData()).toEqual(before);
        expect(reopened.listImportJobHistory("hh-isolated")).toEqual([]);
        const retryDatabase = new DatabaseSync(dbPath);
        try {
          retryDatabase.exec("DROP TRIGGER synthetic_booked_failure");
        } finally {
          retryDatabase.close();
        }
        expect(runPdfImportWorkflow(input, {
          parserRegistry: defaultParserAdapterRegistry, ...reopened,
        })).toMatchObject({ ok: true, transactionCount: 2, duplicateCount: 0 });
        expect(reopened.getTransactionsForImportJob("booked-job")
          .map(({ amountMinor }) => amountMinor).sort((left, right) => left - right))
          .toEqual([-2000, -1250]);
        expect(reopened.loadLedgerSnapshotData().importJobs).toHaveLength(1);
        expect(reopened.listImportJobHistory("hh-isolated")).toMatchObject([
          { id: "booked-job", importedCount: 2, undoAvailable: true },
        ]);
      } finally {
        reopened.close();
      }
    });
  });
  it("imports booked-only PDFs with only the atomic writer dependency", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      const input = {
        filePath: "synthetic.pdf", householdId: "hh-isolated", accountId: "acc-isolated",
        importJobId: "atomic-job", startedAtIso: "2026-06-01T12:00:00Z", finishedAtIso: "2026-06-01T12:00:01Z",
      };
      const dependencies = {
        parserRegistry: defaultParserAdapterRegistry,
        appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
        getTransactionsForImportJob: ledger.getTransactionsForImportJob,
      };
      expect(runPdfImportWorkflow({ ...input, pdfText: pdfText.split("\n").slice(0, 5).join("\n") }, dependencies))
        .toMatchObject({ ok: true, transactionCount: 1 });
      expect(ledger.getTransactionsForImportJob("atomic-job")).toMatchObject([{ amountMinor: -1250 }]);
    });
  });
});
