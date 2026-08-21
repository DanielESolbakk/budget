import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { parsePdfStatementWithRegisteredAdapter } from "../../src/domain/import/parserAdapterRegistry.js";
import type { Account, Household, ImportJob } from "../../src/domain/types.js";

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

const STORY_ANCHOR = {
  enablerIssueId: "32",
  featureIssueId: "15",
} as const;

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

  const parseResult = parsePdfStatementWithRegisteredAdapter(pdfText, {
    householdId: SAMPLE_HOUSEHOLD.id,
    accountId: SAMPLE_ACCOUNT.id,
    importJobId,
    idPrefix: importJobId,
  });

  if (!parseResult.ok) {
    return parseResult;
  }

  const importJob: ImportJob = {
    id: importJobId,
    householdId: SAMPLE_HOUSEHOLD.id,
    sourceType: "pdf",
    sourceName: FIXTURE_PATH,
    startedAtIso: now,
    finishedAtIso: now,
    provenance: {
      sourceIdentity: parseResult.sourceIdentity,
      adapterId: parseResult.adapterId,
      storyAnchor: STORY_ANCHOR,
    },
  };

  ledger.appendImportJob(importJob);
  ledger.appendTransactions(parseResult.transactions);

  return {
    ok: true as const,
    importJobId,
    transactionCount: parseResult.transactions.length,
  };
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
});
