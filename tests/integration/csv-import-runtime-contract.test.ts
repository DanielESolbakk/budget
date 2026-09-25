import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import {
  buildCsvImportRequest,
  filterPreviouslyImportedCsvTransactions,
  normalizeCsvImportErrors,
} from "../../src/app/import/importCsv.js";
import { parseCsvText } from "../../src/domain/import/parseCsvText.js";
import { mapCsvRows } from "../../src/domain/import/csvRowMapper.js";
import { buildDashboardViewContract } from "../../src/app/dashboardApi.js";
import type { Household, Account, ImportJob, Transaction } from "../../src/domain/types.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";

const SAMPLE_HOUSEHOLD: Household = {
  id: "hh-integration",
  name: "Integration Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const SAMPLE_ACCOUNT: Account = {
  id: "acc-integration",
  householdId: "hh-integration",
  name: "Brukskonto",
  currencyCode: "NOK",
};

function makeTestLedger(suffix: string) {
  const dir = join(tmpdir(), `budget-integration-${suffix}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "test.sqlite");

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

/**
 * Simulates the IPC handler logic: reads CSV from path, maps rows, persists to ledger.
 * Returns the CsvImportResponse shape used by the IPC channel.
 */
function runImportOrchestration(
  csvText: string,
  ledger: ReturnType<typeof makeTestLedger>,
  options: { householdId: string; accountId: string }
) {
  const rows = parseCsvText(csvText);
  const importJobId = `import-csv-test-${Date.now()}`;
  const now = new Date().toISOString();

  const result = mapCsvRows(rows, {
    householdId: options.householdId,
    accountId: options.accountId,
    importJobId,
    idPrefix: importJobId,
  });

  if (result.skipped.length > 0) {
    return normalizeCsvImportErrors(result.skipped);
  }

  const importJob: ImportJob = {
    id: importJobId,
    householdId: options.householdId,
    sourceType: "csv",
    sourceName: "test.csv",
    startedAtIso: now,
    finishedAtIso: now,
  };

  ledger.appendImportJob(importJob);
  ledger.appendTransactions(result.transactions);

  return {
    ok: true as const,
    importJobId,
    transactionCount: result.transactions.length,
  };
}

describe("csv-import-runtime-contract", () => {
  it("removes temporary ledger files after closing the test database", () => {
    const suffix = randomUUID();
    const tempDir = join(tmpdir(), `budget-integration-${suffix}`);
    const ledger = makeTestLedger(suffix);

    expect(existsSync(tempDir)).toBe(true);
    try {
      ledger.close();
      expect(existsSync(tempDir)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not duplicate a legacy CSV import from the same source path", () => {
    const ledger = makeTestLedger(randomUUID());
    const sourceName = "legacy-export.csv";
    const csvText = readFileSync(FIXTURE_PATH, "utf8");
    const rows = parseCsvText(csvText);
    const options = {
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
      sourceIdentity: "file-digest",
    };
    const oldImportJob: ImportJob = {
      id: "import-csv-old",
      householdId: SAMPLE_HOUSEHOLD.id,
      sourceType: "csv",
      sourceName,
      startedAtIso: "2026-05-31T00:00:00Z",
    };

    try {
      const legacy = mapCsvRows(rows, { ...options, importJobId: oldImportJob.id });
      expect(legacy.skipped).toEqual([]);
      const oldTransactions = legacy.transactions.map((transaction, index) => {
        const { sourceReference: _legacyReference, ...legacyTransaction } = transaction;
        return { ...legacyTransaction, id: `${oldImportJob.id}-${index + 1}` };
      });
      expect(ledger.appendImportJobAndTransactions(oldImportJob, oldTransactions)).toBe(rows.length);

      const candidates = mapCsvRows(rows, options).transactions;
      const pending = filterPreviouslyImportedCsvTransactions(
        candidates,
        ledger.loadLedgerSnapshotData(),
        { filePath: sourceName, accountId: SAMPLE_ACCOUNT.id, sourceIdentity: "file-digest" }
      );
      expect(pending).toEqual([]);
      expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(rows.length);
    } finally {
      ledger.close();
    }
  });

  it("does not drop a new purchase when the same CSV path gets another bank reference", () => {
    const ledger = makeTestLedger(randomUUID());
    const sourceName = "changing-export.csv";
    const options = { householdId: SAMPLE_HOUSEHOLD.id, accountId: SAMPLE_ACCOUNT.id };
    const header = "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta;Melding/KID/Fakt.nr";
    const firstRows = parseCsvText(`${header}\n23.05.2026;;KIWI;;-12.50;NOK;KID-100`);
    const secondRows = parseCsvText(`${header}\n23.05.2026;;KIWI;;-12.50;NOK;KID-100\n23.05.2026;;KIWI;;-12.50;NOK;KID-200`);

    try {
      const first = mapCsvRows(firstRows, { ...options, sourceIdentity: "first-digest", importJobId: "first-job" });
      expect(ledger.appendImportJobAndTransactions({
        id: "first-job", householdId: options.householdId, sourceType: "csv", sourceName,
        startedAtIso: "2026-05-23T00:00:00Z", provenance: { sourceIdentity: "first-digest" },
      }, first.transactions)).toBe(1);

      const second = mapCsvRows(secondRows, { ...options, sourceIdentity: "second-digest" });
      const pending = filterPreviouslyImportedCsvTransactions(second.transactions, ledger.loadLedgerSnapshotData(), {
        filePath: sourceName, accountId: options.accountId, sourceIdentity: "second-digest",
      });
      expect(pending).toHaveLength(1);
      expect(ledger.appendTransactions(pending)).toBe(1);
      expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(2);
    } finally {
      ledger.close();
    }
  });

  it("tracks unchanged CSV content copied to another path before that copy is extended", () => {
    const ledger = makeTestLedger(randomUUID());
    const header = "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta;Melding/KID/Fakt.nr";
    const oneRow = parseCsvText(`${header}\n23.05.2026;;KIWI;;-12.50;NOK;KID-100`);
    const twoRows = parseCsvText(`${header}\n23.05.2026;;KIWI;;-12.50;NOK;KID-100\n23.05.2026;;KIWI;;-12.50;NOK;KID-200`);
    const options = { householdId: SAMPLE_HOUSEHOLD.id, accountId: SAMPLE_ACCOUNT.id };

    try {
      const original = mapCsvRows(oneRow, {
        ...options,
        sourceIdentity: "digest-one",
        sourceScope: "A.csv",
        importJobId: "path-a-job",
      });
      expect(ledger.appendImportJobAndTransactions({
        id: "path-a-job", householdId: options.householdId, sourceType: "csv", sourceName: "A.csv",
        startedAtIso: "2026-05-23T00:00:00Z", provenance: { sourceIdentity: "digest-one" },
      }, original.transactions)).toBe(1);

      const copied = mapCsvRows(oneRow, {
        ...options,
        sourceIdentity: "digest-one",
        sourceScope: "B.csv",
        importJobId: "path-b-copy-job",
      });
      const copiedPending = filterPreviouslyImportedCsvTransactions(
        copied.transactions,
        ledger.loadLedgerSnapshotData(),
        { filePath: "B.csv", accountId: options.accountId, sourceIdentity: "digest-one" }
      );
      expect(ledger.appendImportJobAndTransactions({
        id: "path-b-copy-job", householdId: options.householdId, sourceType: "csv", sourceName: "B.csv",
        startedAtIso: "2026-05-23T00:00:01Z", provenance: { sourceIdentity: "digest-one" },
      }, copiedPending)).toBe(0);
      expect(copied.transactions[0]?.id).not.toBe(original.transactions[0]?.id);

      const expanded = mapCsvRows(twoRows, {
        ...options,
        sourceIdentity: "digest-two",
        sourceScope: "B.csv",
      });
      expect(expanded.transactions.find((transaction) => transaction.sourceReference === "KID-100")?.id)
        .toBe(copied.transactions[0]?.id);
      const pending = filterPreviouslyImportedCsvTransactions(expanded.transactions, ledger.loadLedgerSnapshotData(), {
        filePath: "B.csv", accountId: options.accountId, sourceIdentity: "digest-two",
      });
      expect(pending).toHaveLength(1);
      expect(pending[0]?.sourceReference).toBe("KID-200");
    } finally {
      ledger.close();
    }
  });

  it("matches a prior CSV source when only Windows path casing differs", () => {
    const ledger = makeTestLedger(randomUUID());
    const upperPath = join(tmpdir(), "Budget-Imports", "Bank.csv");
    const lowerPath = join(tmpdir(), "budget-imports", "bank.csv");
    const csvText = "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta;Melding/KID/Fakt.nr\n23.05.2026;;KIWI;;-12.50;NOK;KID-CASE";
    const rows = parseCsvText(csvText);

    try {
      const transactions = mapCsvRows(rows, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
        importJobId: "case-job",
        sourceIdentity: "same-digest",
      }).transactions;
      ledger.appendImportJobAndTransactions({
        id: "case-job",
        householdId: SAMPLE_HOUSEHOLD.id,
        sourceType: "csv",
        sourceName: upperPath,
        startedAtIso: "2026-05-23T00:00:00Z",
        provenance: { sourceIdentity: "same-digest" },
      }, transactions);

      const candidates = mapCsvRows(rows, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
        sourceIdentity: "same-digest",
      }).transactions;
      const pending = filterPreviouslyImportedCsvTransactions(candidates, ledger.loadLedgerSnapshotData(), {
        filePath: lowerPath,
        accountId: SAMPLE_ACCOUNT.id,
        sourceIdentity: "same-digest",
      });
      expect(pending).toEqual([]);
    } finally {
      ledger.close();
    }
  });

  it("keeps separate purchases with the same merchant, date and amount when references differ", () => {
    const ledger = makeTestLedger(randomUUID());
    const header = "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta;Melding/KID/Fakt.nr";
    const first = mapCsvRows(parseCsvText(`${header}\n23.05.2026;;KIWI;;-12.50;NOK;KID-100`), {
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
      sourceIdentity: "source-one",
    });
    const second = mapCsvRows(parseCsvText(`${header}\n23.05.2026;;KIWI;;-12.50;NOK;KID-200`), {
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
      sourceIdentity: "source-two",
    });

    try {
      expect(first.skipped).toEqual([]);
      expect(second.skipped).toEqual([]);
      expect(ledger.appendTransactions(first.transactions)).toBe(1);
      expect(ledger.appendTransactions(second.transactions)).toBe(1);
      expect(ledger.appendTransactions(first.transactions)).toBe(0);
      expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(2);
    } finally {
      ledger.close();
    }
  });

  it("persists identical rows in one CSV batch and skips them on unchanged re-import", () => {
    const ledger = makeTestLedger(randomUUID());
    const sourceName = "identical-purchases.csv";
    const sourceIdentity = "identical-purchases-digest";
    const header = "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta;Melding/KID/Fakt.nr";
    const row = "23.05.2026;;KIWI;;-12.50;NOK;";
    const rows = parseCsvText(`${header}\n${row}\n${row}`);
    const options = {
      householdId: SAMPLE_HOUSEHOLD.id,
      accountId: SAMPLE_ACCOUNT.id,
      sourceIdentity,
    };

    try {
      const firstBatch = mapCsvRows(rows, { ...options, importJobId: "identical-csv-job" });
      expect(firstBatch.skipped).toEqual([]);
      expect(firstBatch.transactions).toHaveLength(2);
      expect(firstBatch.transactions[0]).toMatchObject({
        accountId: SAMPLE_ACCOUNT.id,
        bookedAtIso: firstBatch.transactions[1]?.bookedAtIso,
        amountMinor: firstBatch.transactions[1]?.amountMinor,
        merchantRaw: firstBatch.transactions[1]?.merchantRaw,
      });
      expect(firstBatch.transactions[0]?.id).not.toBe(firstBatch.transactions[1]?.id);

      expect(ledger.appendImportJobAndTransactions({
        id: "identical-csv-job",
        householdId: SAMPLE_HOUSEHOLD.id,
        sourceType: "csv",
        sourceName,
        startedAtIso: "2026-05-23T00:00:00Z",
        provenance: { sourceIdentity },
      }, firstBatch.transactions)).toBe(2);

      const retryBatch = mapCsvRows(rows, { ...options, importJobId: "identical-csv-retry" });
      const pending = filterPreviouslyImportedCsvTransactions(
        retryBatch.transactions,
        ledger.loadLedgerSnapshotData(),
        { filePath: sourceName, accountId: SAMPLE_ACCOUNT.id, sourceIdentity }
      );
      expect(ledger.appendImportJobAndTransactions({
        id: "identical-csv-retry",
        householdId: SAMPLE_HOUSEHOLD.id,
        sourceType: "csv",
        sourceName,
        startedAtIso: "2026-05-23T00:00:01Z",
        provenance: { sourceIdentity },
      }, pending)).toBe(0);
      expect(ledger.loadLedgerSnapshotData().transactions).toHaveLength(2);
    } finally {
      ledger.close();
    }
  });

  describe("AC-2: Successful CSV import writes expected import job and transaction records", () => {
    it("writes one import_jobs record and expected transaction rows for the synthetic fixture", () => {
      const ledger = makeTestLedger(randomUUID());
      const csvText = readFileSync(FIXTURE_PATH, "utf8");

      const response = runImportOrchestration(csvText, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;

      expect(response.transactionCount).toBeGreaterThan(0);

      const snapshot = ledger.loadLedgerSnapshotData();

      expect(snapshot.importJobs).toHaveLength(1);
      expect(snapshot.importJobs[0]!.sourceType).toBe("csv");
      expect(snapshot.importJobs[0]!.id).toBe(response.importJobId);
      expect(snapshot.transactions).toHaveLength(response.transactionCount);

      for (const tx of snapshot.transactions) {
        expect(tx.importJobId).toBe(response.importJobId);
        expect(tx.householdId).toBe(SAMPLE_HOUSEHOLD.id);
        expect(tx.accountId).toBe(SAMPLE_ACCOUNT.id);
      }

      ledger.close();
    });

    it("all imported transactions have integer amountMinor and ISO bookedAtIso", () => {
      const ledger = makeTestLedger(randomUUID());
      const csvText = readFileSync(FIXTURE_PATH, "utf8");

      runImportOrchestration(csvText, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      const snapshot = ledger.loadLedgerSnapshotData();

      for (const tx of snapshot.transactions) {
        expect(Number.isInteger(tx.amountMinor)).toBe(true);
        expect(tx.bookedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(typeof tx.merchantRaw).toBe("string");
        expect(tx.merchantRaw.length).toBeGreaterThan(0);
      }

      ledger.close();
    });
  });

  describe("AC-3: Invalid CSV import returns explicit validation failures and zero transaction writes", () => {
    it("rejects empty and header-only CSV input without creating an import job", () => {
      for (const csvText of ["", "Utført dato;Beskrivelse;Beløp ut;Valuta\n"]) {
        const ledger = makeTestLedger(randomUUID());

        const response = runImportOrchestration(csvText, ledger, {
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
        });

        expect(response).toEqual({
          ok: false,
          errors: [
            {
              rowIndex: -1,
              fields: ["file"],
              codes: ["EMPTY_CSV"],
              messages: ["CSV must contain at least one data row."],
            },
          ],
        });

        const snapshot = ledger.loadLedgerSnapshotData();
        expect(snapshot.transactions).toHaveLength(0);
        expect(snapshot.importJobs).toHaveLength(0);
        ledger.close();
      }
    });

    it("returns ok=false with explicit errors and writes zero transactions for missing headers", () => {
      const ledger = makeTestLedger(randomUUID());
      // CSV with headers that do not match any supported canonical or alias names.
      const invalidCsv = "OtherDate;OtherText;OtherAmount\n01.01.2026;Test;-100.00\n";

      const response = runImportOrchestration(invalidCsv, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      expect(response.ok).toBe(false);
      if (response.ok) return;

      expect(response.errors.length).toBeGreaterThan(0);

      const snapshot = ledger.loadLedgerSnapshotData();
      expect(snapshot.transactions).toHaveLength(0);
      expect(snapshot.importJobs).toHaveLength(0);

      ledger.close();
    });

    it("returns validation errors with codes and messages for invalid row values", () => {
      const ledger = makeTestLedger(randomUUID());
      // Valid headers but invalid date value.
      const invalidCsv =
        "Utført dato;Bokført dato;Rentedato;Beskrivelse;Type;Undertype;Fra konto;Avsender;Til konto;Mottakernavn;Beløp inn;Beløp ut;Valuta;Status;Melding/KID/Fakt.nr\n" +
        "NOT_A_DATE;;29.05.2026;MERCHANT_001;Varekjøp;Debetkort;ACCT-001;;;USER_1;;-45.00;NOK;Reservert;TXN-001\n";

      const response = runImportOrchestration(invalidCsv, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      expect(response.ok).toBe(false);
      if (response.ok) return;

      const allCodes = response.errors.flatMap((e) => e.codes);
      expect(allCodes).toContain("INVALID_DATE_FORMAT");

      const snapshot = ledger.loadLedgerSnapshotData();
      expect(snapshot.transactions).toHaveLength(0);

      ledger.close();
    });

    it("buildCsvImportRequest throws for empty filePath and leaves ledger unmodified", () => {
      const ledger = makeTestLedger(randomUUID());

      expect(() =>
        buildCsvImportRequest("  ", {
          householdId: SAMPLE_HOUSEHOLD.id,
          accountId: SAMPLE_ACCOUNT.id,
        })
      ).toThrow("filePath must be a non-empty string");

      const snapshot = ledger.loadLedgerSnapshotData();
      expect(snapshot.transactions).toHaveLength(0);

      ledger.close();
    });
  });

  describe("AC-4: Post-import dashboard contract reflects imported transactions", () => {
    it("imported transactions appear in dashboard view for their month", () => {
      const ledger = makeTestLedger(randomUUID());
      const csvText = readFileSync(FIXTURE_PATH, "utf8");

      const response = runImportOrchestration(csvText, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;

      const snapshot = ledger.loadLedgerSnapshotData();
      const allTransactions: Transaction[] = snapshot.transactions;

      const contract = buildDashboardViewContract({
        transactions: allTransactions,
        selectedYearMonth: "2026-05",
      });

      expect(contract.state).toBe("ready");
      if (contract.state !== "ready") return;

      expect(contract.snapshot.selectedYearMonth).toBe("2026-05");
      expect(contract.snapshot.categoryBreakdown.entries.length).toBeGreaterThan(0);
      // Monthly totals should reflect imported transaction amounts for 2026-05.
      expect(contract.snapshot.monthlyTotals.yearMonth).toBe("2026-05");
    });

    it("category breakdown entries come from imported transactions", () => {
      const ledger = makeTestLedger(randomUUID());
      const csvText = readFileSync(FIXTURE_PATH, "utf8");

      runImportOrchestration(csvText, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });

      const snapshot = ledger.loadLedgerSnapshotData();

      const contract = buildDashboardViewContract({
        transactions: snapshot.transactions,
        selectedYearMonth: "2026-05",
      });

      expect(contract.state).toBe("ready");
      if (contract.state !== "ready") {
        return;
      }

      const totalMinorFromEntries = contract.snapshot.categoryBreakdown.entries.reduce(
        (sum, entry) => sum + entry.totalMinor,
        0
      );
      expect(Math.abs(totalMinorFromEntries)).toBeGreaterThan(0);

      ledger.close();
    });

    it("appending a second import accumulates transactions from both runs", () => {
      const ledger = makeTestLedger(randomUUID());
      const csvText = readFileSync(FIXTURE_PATH, "utf8");

      const response1 = runImportOrchestration(csvText, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });
      expect(response1.ok).toBe(true);

      // Write a second minimal valid CSV to simulate a second import run.
      const secondCsv =
        "Utført dato;Bokført dato;Rentedato;Beskrivelse;Type;Undertype;Fra konto;Avsender;Til konto;Mottakernavn;Beløp inn;Beløp ut;Valuta;Status;Melding/KID/Fakt.nr\n" +
        "01.06.2026;01.06.2026;01.06.2026;EXTRA_MERCHANT;Varekjøp;Debetkort;ACCT-001;;;USER_1;;-999.00;NOK;Bokført;REF-EXTRA\n";

      const response2 = runImportOrchestration(secondCsv, ledger, {
        householdId: SAMPLE_HOUSEHOLD.id,
        accountId: SAMPLE_ACCOUNT.id,
      });
      expect(response2.ok).toBe(true);
      if (!response1.ok || !response2.ok) return;

      const snapshot = ledger.loadLedgerSnapshotData();
      expect(snapshot.importJobs).toHaveLength(2);
      expect(snapshot.transactions).toHaveLength(
        response1.transactionCount + response2.transactionCount
      );

      ledger.close();
    });
  });
});
