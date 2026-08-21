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

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseRogalandStatementText, ROGALAND_ADAPTER_ID } from "../../src/domain/import/pdfTextParser.js";
import { buildDashboardViewContract } from "../../src/app/dashboardApi.js";
import {
  buildPdfImportRequest,
  normalizePdfImportErrors,
} from "../../src/app/import/importPdf.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { buildTransactionFingerprint } from "../../src/domain/import/buildTransactionFingerprint.js";
import type { Household, Account, ImportJob } from "../../src/domain/types.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";

const MAPPING_OPTIONS = {
  householdId: "hh-test",
  accountId: "acc-test",
};

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const SAMPLE_HOUSEHOLD: Household = {
  id: "hh-pdf-integration",
  name: "PDF Integration Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const SAMPLE_ACCOUNT: Account = {
  id: "acc-pdf-integration",
  householdId: "hh-pdf-integration",
  name: "Brukskonto",
  currencyCode: "NOK",
};

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

function makeTestLedger(suffix: string) {
  const dir = join(tmpdir(), `budget-pdf-integration-${suffix}`);
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
 * Simulates the IPC handler orchestration for PDF imports:
 * parse → create import job → persist to SQLite.
 * Uses buildTransactionFingerprint as transaction ID to ensure deterministic IDs
 * across repeated imports of the same fixture (duplicate-safe contract).
 */
function runPdfImportOrchestration(
  text: string,
  ledger: ReturnType<typeof makeTestLedger>,
  options: { householdId: string; accountId: string; sourceName?: string }
) {
  const importJobId = `import-pdf-${Date.now()}`;
  const now = new Date().toISOString();

  const parseResult = parseRogalandStatementText(text, {
    householdId: options.householdId,
    accountId: options.accountId,
    importJobId,
  });

  if (!parseResult.ok) {
    return normalizePdfImportErrors(parseResult.errors);
  }

  const transactionsWithFingerprintIds = parseResult.transactions.map((tx) => ({
    ...tx,
    id: buildTransactionFingerprint({
      accountId: tx.accountId,
      bookedAtIso: tx.bookedAtIso,
      amountMinor: tx.amountMinor,
      merchantRaw: tx.merchantRaw,
    }),
  }));

  const importJob: ImportJob = {
    id: importJobId,
    householdId: options.householdId,
    sourceType: "pdf",
    sourceName: options.sourceName ?? "rogaland-statement.txt",
    startedAtIso: now,
    finishedAtIso: now,
  };

  ledger.appendImportJob(importJob);
  ledger.appendTransactions(transactionsWithFingerprintIds);

  return {
    ok: true as const,
    importJobId,
    transactionCount: transactionsWithFingerprintIds.length,
    adapterId: parseResult.adapterId,
  };
}

describe("pdf import contract", () => {
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
  });

  describe("AC-3: invalid or unsupported input returns explicit errors with no partial transactions", () => {
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
      expect(snapshot.importJobs[0]!.sourceType).toBe("pdf");
      expect(snapshot.importJobs[0]!.id).toBe(response.importJobId);
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
});
