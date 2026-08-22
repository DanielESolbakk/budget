import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { runPdfImportWorkflow } from "../../src/app/import/importPdf.js";
import type { Account, Household } from "../../src/domain/types.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";
const SAMPLE_HOUSEHOLD: Household = {
  id: "hh-import-adapter",
  name: "Import Adapter Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const SAMPLE_ACCOUNT: Account = {
  id: "acc-import-adapter",
  householdId: SAMPLE_HOUSEHOLD.id,
  name: "Brukskonto",
  currencyCode: "NOK",
};

function makeTestLedger(suffix: string) {
  const dir = join(tmpdir(), `budget-parser-adapter-${suffix}`);
  mkdirSync(dir, { recursive: true });

  return createLocalLedgerDatabase({
    dbPath: join(dir, "test.sqlite"),
    seedData: {
      household: SAMPLE_HOUSEHOLD,
      accounts: [SAMPLE_ACCOUNT],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });
}

function runPdfImportOrchestration(pdfText: string, ledger: ReturnType<typeof makeTestLedger>) {
  const importJobId = `import-pdf-test-${Date.now()}`;
  const now = new Date().toISOString();

  return runPdfImportWorkflow(
    {
      pdfText,
      filePath: FIXTURE_PATH,
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
      importJobId,
      startedAtIso: now,
      finishedAtIso: now,
    },
    {
      appendImportJob: ledger.appendImportJob,
      appendTransactions: ledger.appendTransactions,
    }
  );
}

describe("import-job-parser-adapter-contract", () => {
  it("records source + adapter identities in import job provenance", () => {
    const ledger = makeTestLedger(randomUUID());
    const pdfText = readFileSync(FIXTURE_PATH, "utf8");

    const response = runPdfImportOrchestration(pdfText, ledger);

    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const snapshot = ledger.loadLedgerSnapshotData();
    expect(snapshot.importJobs).toHaveLength(1);

    const [storedImportJob] = snapshot.importJobs;
    expect(storedImportJob?.id).toBe(response.importJobId);
    expect(storedImportJob?.adapterId).toBe("rogaland-sparebank-text-v1");
    expect(storedImportJob?.candidateCount).toBe(response.transactionCount);
    expect(storedImportJob?.validationFailureCount).toBe(0);
    expect(storedImportJob?.provenance).toEqual({
      sourceIdentity: "no.rogaland-sparebank.statement-text",
      adapterId: "rogaland-sparebank-text-v1",
      storyAnchor: {
        enablerIssueId: "32",
        featureIssueId: "15",
      },
    });

    ledger.close();
  });

  it("rejects malformed statement rows with explicit errors and no ledger writes", () => {
    const ledger = makeTestLedger(randomUUID());
    const malformedText = [
      "ROGALAND SPAREBANK",
      "Dato         Beskrivelse                              Beløp          Saldo",
      "27.05.2026   SALARY                                  INVALID         75 000,00",
    ].join("\n");

    const response = runPdfImportOrchestration(malformedText, ledger);

    expect(response.ok).toBe(false);
    if (response.ok) return;

    expect(response.errors[0]?.code).toBe("INVALID_AMOUNT_FORMAT");

    const snapshot = ledger.loadLedgerSnapshotData();
    expect(snapshot.importJobs).toHaveLength(0);
    expect(snapshot.transactions).toHaveLength(0);

    ledger.close();
  });

  it("migrates legacy import jobs while preserving new metadata on subsequent writes", () => {
    const dir = join(tmpdir(), `budget-parser-adapter-legacy-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "legacy.sqlite");
    const legacyDb = new DatabaseSync(dbPath);

    legacyDb.exec(`
      CREATE TABLE households (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at_iso TEXT NOT NULL
      );
      CREATE TABLE import_jobs (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_name TEXT NOT NULL,
        started_at_iso TEXT NOT NULL,
        finished_at_iso TEXT
      );
      INSERT INTO households (id, name, created_at_iso)
      VALUES ('legacy-household', 'Legacy Household', '2026-01-01T00:00:00Z');
      INSERT INTO import_jobs (
        id, household_id, source_type, source_name, started_at_iso, finished_at_iso
      ) VALUES (
        'legacy-job', 'legacy-household', 'pdf', 'legacy.txt',
        '2026-05-31T10:00:00Z', '2026-05-31T10:00:01Z'
      );
    `);
    legacyDb.close();

    const ledger = createLocalLedgerDatabase({
      dbPath,
      seedData: {
        household: SAMPLE_HOUSEHOLD,
        accounts: [SAMPLE_ACCOUNT],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    const legacySnapshot = ledger.loadLedgerSnapshotData();
    expect(legacySnapshot.importJobs).toEqual([
      {
        id: "legacy-job",
        householdId: "legacy-household",
        sourceType: "pdf",
        sourceName: "legacy.txt",
        startedAtIso: "2026-05-31T10:00:00Z",
        finishedAtIso: "2026-05-31T10:00:01Z",
      },
    ]);

    ledger.appendImportJob({
      id: "new-job",
      householdId: SAMPLE_HOUSEHOLD.id,
      sourceType: "pdf",
      sourceName: FIXTURE_PATH,
      adapterId: "rogaland-sparebank-text-v1",
      candidateCount: 10,
      validationFailureCount: 0,
      startedAtIso: "2026-05-31T11:00:00Z",
      provenance: { sourceIdentity: "no.rogaland-sparebank.statement-text" },
    });

    const updatedSnapshot = ledger.loadLedgerSnapshotData();
    const newImportJob = updatedSnapshot.importJobs.find((job) => job.id === "new-job");
    expect(newImportJob?.adapterId).toBe("rogaland-sparebank-text-v1");
    expect(newImportJob?.candidateCount).toBe(10);
    expect(newImportJob?.validationFailureCount).toBe(0);

    ledger.close();
  });
});
