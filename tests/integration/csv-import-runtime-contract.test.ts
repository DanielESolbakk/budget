import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import {
  buildCsvImportRequest,
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

  return createLocalLedgerDatabase({
    dbPath,
    seedData: {
      household: SAMPLE_HOUSEHOLD,
      accounts: [SAMPLE_ACCOUNT],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });
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
    it("returns ok=false with explicit errors and writes zero transactions for missing headers", () => {
      const ledger = makeTestLedger(randomUUID());
      // CSV with wrong column names (no matching Norwegian bank headers).
      const invalidCsv = "Dato;Tekst;Beløp\n01.01.2026;Test;-100.00\n";

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
