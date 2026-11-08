import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
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
    await withIsolatedLedger({}, ({ ledger }) => {
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
    });
  });
  it.each([
    { source: "csv", table: "import_review_items" },
    { source: "csv", table: "pending_transaction_observations" },
    { source: "pdf", table: "import_review_items" },
    { source: "pdf", table: "pending_transaction_observations" },
  ] as const)("$source rolls back the job and all collections when $table insertion fails", async ({ source, table }) => {
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
    });
  });
  it("keeps the legacy PDF fallback contract explicit for booked and review/pending inputs", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      const input = {
        filePath: "synthetic.pdf", householdId: "hh-isolated", accountId: "acc-isolated",
        importJobId: "fallback-job", startedAtIso: "2026-06-01T12:00:00Z", finishedAtIso: "2026-06-01T12:00:01Z",
      };
      const dependencies = {
        parserRegistry: defaultParserAdapterRegistry,
        appendImportJob: ledger.appendImportJob,
        appendTransactions: ledger.appendTransactions,
        getTransactionsForImportJob: ledger.getTransactionsForImportJob,
      };
      expect(() => runPdfImportWorkflow({ ...input, pdfText, acknowledgeExcludedRows: true }, dependencies))
        .toThrow("require atomic");
      expect(ledger.loadLedgerSnapshotData().importJobs).toEqual([]);
      expect(runPdfImportWorkflow({ ...input, pdfText: pdfText.split("\n").slice(0, 5).join("\n") }, dependencies))
        .toMatchObject({ ok: true, transactionCount: 1 });
      expect(ledger.getTransactionsForImportJob("fallback-job")).toMatchObject([{ amountMinor: -1250 }]);
    });
  });
});
