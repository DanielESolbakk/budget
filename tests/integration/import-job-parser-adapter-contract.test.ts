/**
 * Integration tests for the import job / parser adapter contract (AC-1, AC-2, AC-3 from issue #32).
 *
 * These tests exercise the full chain: fixture text -> registry -> AdapterParseResult ->
 * ImportJob construction, verifying that provenance propagates end-to-end and
 * that failure paths produce explicit errors with no partial candidates.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ImportJob } from "../../src/domain/types.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { runPdfImportWorkflow } from "../../src/app/import/importPdf.js";
import {
  defaultParserAdapterRegistry,
  ParserAdapterRegistry,
} from "../../src/domain/import/parserAdapterRegistry.js";
import { ROGALAND_ADAPTER_ID } from "../../src/domain/import/pdfTextParser.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";

const BASE_OPTIONS = {
  householdId: "hh-integration",
  accountId: "acc-integration",
};

const MALFORMED_STATEMENT = [
  "ROGALAND SPAREBANK",
  "Dato  Beskrivelse  Beløp",
  "31.05.2026  Valid merchant  -10,00 ",
  "31.05.2026  Broken merchant  not-a-number ",
].join("\n");

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

function createTestLedger() {
  const tempDirectory = mkdtempSync(join(tmpdir(), "budget-import-contract-"));
  const ledger = createLocalLedgerDatabase({
    dbPath: join(tempDirectory, "ledger.sqlite"),
    seedData: {
      household: {
        id: BASE_OPTIONS.householdId,
        name: "Integration Household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });

  return {
    ledger,
    close: () => {
      ledger.close();
      rmSync(tempDirectory, { recursive: true, force: true });
    },
  };
}

function runWorkflow(
  pdfText: string,
  ledger: ReturnType<typeof createTestLedger>["ledger"],
  importJobId: string
) {
  const timestamp = "2026-05-31T12:00:00Z";
  return runPdfImportWorkflow(
    {
      pdfText,
      filePath: FIXTURE_PATH,
      householdId: BASE_OPTIONS.householdId,
      accountId: BASE_OPTIONS.accountId,
      importJobId,
      startedAtIso: timestamp,
      finishedAtIso: timestamp,
    },
    {
      parserRegistry: defaultParserAdapterRegistry,
      appendImportJob: ledger.appendImportJob,
      appendTransactions: ledger.appendTransactions,
    }
  );
}

function stableImportJobFields(importJob: ImportJob): Omit<ImportJob, "id"> {
  const { id: ignoredImportJobId, ...stableFields } = importJob;
  void ignoredImportJobId;
  return stableFields;
}

describe("import job / parser adapter contract", () => {
  describe("AC-1: import job carries full provenance", () => {
    it("persists import provenance and candidates through the application workflow", () => {
      const testLedger = createTestLedger();
      const importJobId = "job-provenance-check";

      try {
        const result = runWorkflow(loadFixture(), testLedger.ledger, importJobId);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const snapshot = testLedger.ledger.loadLedgerSnapshotData();
        expect(snapshot.importJobs).toEqual([
          expect.objectContaining({
            id: importJobId,
            householdId: BASE_OPTIONS.householdId,
            sourceType: "pdf",
            sourceName: FIXTURE_PATH,
            adapterId: ROGALAND_ADAPTER_ID,
            candidateCount: result.transactionCount,
            validationFailureCount: 0,
            provenance: {
              sourceIdentity: "no.rogaland-sparebank.statement-text",
              adapterId: ROGALAND_ADAPTER_ID,
              storyAnchor: {
                enablerIssueId: "32",
                featureIssueId: "15",
              },
            },
          }),
        ]);
        expect(snapshot.transactions).toHaveLength(result.transactionCount);
        expect(
          snapshot.transactions.every((candidate) => candidate.importJobId === importJobId)
        ).toBe(true);
      } finally {
        testLedger.close();
      }
    });

    it("migrates a legacy import job table and preserves new provenance fields", () => {
      const tempDirectory = mkdtempSync(join(tmpdir(), "budget-import-migration-"));
      const dbPath = join(tempDirectory, "legacy.sqlite");
      const legacyDatabase = new DatabaseSync(dbPath);

      legacyDatabase.exec(`
        CREATE TABLE households (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at_iso TEXT NOT NULL);
        INSERT INTO households (id, name, created_at_iso) VALUES ('hh-legacy', 'Legacy Household', '2026-01-01T00:00:00Z');
        CREATE TABLE import_jobs (
          id TEXT PRIMARY KEY,
          household_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_name TEXT NOT NULL,
          started_at_iso TEXT NOT NULL,
          finished_at_iso TEXT
        );
      `);
      legacyDatabase.close();

      const ledger = createLocalLedgerDatabase({
        dbPath,
        seedData: {
          household: {
            id: "hh-legacy",
            name: "Legacy Household",
            createdAtIso: "2026-01-01T00:00:00Z",
          },
          accounts: [],
          transactions: [],
          importJobs: [],
          monthlyCategoryTargets: [],
        },
      });

      try {
        ledger.appendImportJob({
          id: "job-legacy-migration",
          householdId: "hh-legacy",
          sourceType: "pdf",
          sourceName: FIXTURE_PATH,
          adapterId: ROGALAND_ADAPTER_ID,
          candidateCount: 2,
          validationFailureCount: 0,
          startedAtIso: "2026-05-31T12:00:00Z",
          finishedAtIso: "2026-05-31T12:00:00Z",
        });

        expect(ledger.loadLedgerSnapshotData().importJobs[0]).toEqual(
          expect.objectContaining({
            adapterId: ROGALAND_ADAPTER_ID,
            candidateCount: 2,
            validationFailureCount: 0,
          })
        );
      } finally {
        ledger.close();
        rmSync(tempDirectory, { recursive: true, force: true });
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

    it("repeated workflow runs persist identical provenance fields", () => {
      const firstLedger = createTestLedger();
      const secondLedger = createTestLedger();

      try {
        const firstResult = runWorkflow(loadFixture(), firstLedger.ledger, "job-repeat-1");
        const secondResult = runWorkflow(loadFixture(), secondLedger.ledger, "job-repeat-2");

        expect(firstResult.ok).toBe(true);
        expect(secondResult.ok).toBe(true);
        if (!firstResult.ok || !secondResult.ok) return;

        const firstSnapshot = firstLedger.ledger.loadLedgerSnapshotData();
        const secondSnapshot = secondLedger.ledger.loadLedgerSnapshotData();
        expect(firstSnapshot.importJobs).toHaveLength(1);
        expect(secondSnapshot.importJobs).toHaveLength(1);

        const firstJob = firstSnapshot.importJobs[0];
        const secondJob = secondSnapshot.importJobs[0];
        expect(firstJob).toBeDefined();
        expect(secondJob).toBeDefined();
        if (!firstJob || !secondJob) return;

        expect(stableImportJobFields(firstJob)).toEqual(stableImportJobFields(secondJob));
      } finally {
        firstLedger.close();
        secondLedger.close();
      }
    });
  });

  describe("AC-3: malformed and unsupported sources produce explicit failures", () => {
    it("malformed transaction rows fail before persisting jobs or candidates", () => {
      const testLedger = createTestLedger();

      try {
        const result = runWorkflow(MALFORMED_STATEMENT, testLedger.ledger, "job-malformed");

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.some((error) => error.code === "INVALID_AMOUNT_FORMAT")).toBe(true);

        const snapshot = testLedger.ledger.loadLedgerSnapshotData();
        expect(snapshot.importJobs).toHaveLength(0);
        expect(snapshot.transactions).toHaveLength(0);
      } finally {
        testLedger.close();
      }
    });

    it("unsupported source returns failure with no candidates and UNSUPPORTED_LAYOUT code", () => {
      const registry = new ParserAdapterRegistry();
      const result = registry.parse("irrelevant content", BASE_OPTIONS);

      expect(result.ok).toBe(false);
      expect(result.adapterId).toBeNull();
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
      expect((result as { candidates?: unknown }).candidates).toBeUndefined();
    });

    it("unsupported workflow input is rejected without persisting jobs or candidates", () => {
      const testLedger = createTestLedger();

      try {
        const result = runWorkflow("irrelevant content", testLedger.ledger, "job-unsupported");

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");

        const snapshot = testLedger.ledger.loadLedgerSnapshotData();
        expect(snapshot.importJobs).toHaveLength(0);
        expect(snapshot.transactions).toHaveLength(0);
      } finally {
        testLedger.close();
      }
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
