import { mkdtempSync, readFileSync, rmSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBackupSnapshot, createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { SNAPSHOT_VERSION } from "../../src/domain/backup/snapshotContract.js";
import type { Account, Household, ImportJob, MonthlyCategoryTarget, Transaction } from "../../src/domain/types.js";

const SAMPLE_HOUSEHOLD: Household = {
  id: "hh-test",
  name: "Test Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const SAMPLE_ACCOUNTS: Account[] = [
  { id: "acc-a", householdId: "hh-test", name: "Brukskonto", currencyCode: "NOK" },
  { id: "acc-b", householdId: "hh-test", name: "Sparekonto", currencyCode: "NOK" },
];

const SAMPLE_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-2",
    householdId: "hh-test",
    accountId: "acc-a",
    bookedAtIso: "2026-05-10T00:00:00Z",
    amountMinor: -2500,
    merchantRaw: "Kiwi Majorstuen",
    categoryId: "groceries",
    importJobId: "job-01",
  },
  {
    id: "tx-1",
    householdId: "hh-test",
    accountId: "acc-a",
    bookedAtIso: "2026-05-01T00:00:00Z",
    amountMinor: 50000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
];

const SAMPLE_IMPORT_JOBS: ImportJob[] = [
  {
    id: "job-01",
    householdId: "hh-test",
    sourceType: "csv",
    sourceName: "may-2026.csv",
    startedAtIso: "2026-05-01T08:00:00Z",
    finishedAtIso: "2026-05-01T08:01:00Z",
  },
];

const SAMPLE_TARGETS: MonthlyCategoryTarget[] = [
  { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 9000 },
];

describe("backup/restore contract", () => {
  describe("AC-1: snapshot creation produces deterministic artifact with expected schema and metadata", () => {
    it("buildBackupSnapshot sets correct metadata version and transaction/account counts", () => {
      const snapshot = buildBackupSnapshot({
        household: SAMPLE_HOUSEHOLD,
        accounts: SAMPLE_ACCOUNTS,
        transactions: SAMPLE_TRANSACTIONS,
        importJobs: SAMPLE_IMPORT_JOBS,
        monthlyCategoryTargets: SAMPLE_TARGETS,
        createdAtIso: "2026-06-01T12:00:00Z",
      });

      expect(snapshot.metadata.version).toBe(SNAPSHOT_VERSION);
      expect(snapshot.metadata.transactionCount).toBe(2);
      expect(snapshot.metadata.accountCount).toBe(2);
      expect(snapshot.metadata.createdAtIso).toBe("2026-06-01T12:00:00Z");
    });

    it("buildBackupSnapshot sorts transactions by id ascending", () => {
      const snapshot = buildBackupSnapshot({
        household: SAMPLE_HOUSEHOLD,
        accounts: SAMPLE_ACCOUNTS,
        transactions: SAMPLE_TRANSACTIONS,
        importJobs: SAMPLE_IMPORT_JOBS,
        monthlyCategoryTargets: SAMPLE_TARGETS,
        createdAtIso: "2026-06-01T12:00:00Z",
      });

      expect(snapshot.transactions[0]!.id).toBe("tx-1");
      expect(snapshot.transactions[1]!.id).toBe("tx-2");
    });

    it("buildBackupSnapshot sorts accounts by id ascending", () => {
      const snapshot = buildBackupSnapshot({
        household: SAMPLE_HOUSEHOLD,
        accounts: [SAMPLE_ACCOUNTS[1]!, SAMPLE_ACCOUNTS[0]!],
        transactions: SAMPLE_TRANSACTIONS,
        importJobs: SAMPLE_IMPORT_JOBS,
        monthlyCategoryTargets: SAMPLE_TARGETS,
        createdAtIso: "2026-06-01T12:00:00Z",
      });

      expect(snapshot.accounts[0]!.id).toBe("acc-a");
      expect(snapshot.accounts[1]!.id).toBe("acc-b");
    });

    it("buildBackupSnapshot produces identical output on repeated calls with same input (determinism)", () => {
      const input = {
        household: SAMPLE_HOUSEHOLD,
        accounts: SAMPLE_ACCOUNTS,
        transactions: SAMPLE_TRANSACTIONS,
        importJobs: SAMPLE_IMPORT_JOBS,
        monthlyCategoryTargets: SAMPLE_TARGETS,
        createdAtIso: "2026-06-01T12:00:00Z",
      };

      const first = buildBackupSnapshot(input);
      const second = buildBackupSnapshot(input);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it("createBackupSnapshot writes a readable JSON file at the specified path", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-backup-"));
      const outputPath = join(tempDir, "snapshot.json");

      try {
        const result = createBackupSnapshot({
          household: SAMPLE_HOUSEHOLD,
          accounts: SAMPLE_ACCOUNTS,
          transactions: SAMPLE_TRANSACTIONS,
          importJobs: SAMPLE_IMPORT_JOBS,
          monthlyCategoryTargets: SAMPLE_TARGETS,
          createdAtIso: "2026-06-01T12:00:00Z",
          outputPath,
        });

        expect(result.outputPath).toBe(outputPath);
        expect(result.transactionCount).toBe(2);
        expect(result.createdAtIso).toBe("2026-06-01T12:00:00Z");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("createBackupSnapshot writes byte-identical JSON for equivalent ledger state with different key order", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-backup-stable-"));
      const pathA = join(tempDir, "snapshot-a.json");
      const pathB = join(tempDir, "snapshot-b.json");

      try {
        createBackupSnapshot({
          household: SAMPLE_HOUSEHOLD,
          accounts: SAMPLE_ACCOUNTS,
          transactions: SAMPLE_TRANSACTIONS,
          importJobs: SAMPLE_IMPORT_JOBS,
          monthlyCategoryTargets: SAMPLE_TARGETS,
          createdAtIso: "2026-06-01T12:00:00Z",
          outputPath: pathA,
        });

        createBackupSnapshot({
          household: {
            createdAtIso: "2026-01-01T00:00:00Z",
            name: "Test Household",
            id: "hh-test",
          },
          accounts: [
            {
              currencyCode: "NOK",
              name: "Sparekonto",
              householdId: "hh-test",
              id: "acc-b",
            },
            {
              currencyCode: "NOK",
              name: "Brukskonto",
              householdId: "hh-test",
              id: "acc-a",
            },
          ],
          transactions: [
            {
              categoryId: "salary",
              merchantRaw: "Lønn AS",
              amountMinor: 50000,
              bookedAtIso: "2026-05-01T00:00:00Z",
              accountId: "acc-a",
              householdId: "hh-test",
              id: "tx-1",
            },
            {
              importJobId: "job-01",
              categoryId: "groceries",
              merchantRaw: "Kiwi Majorstuen",
              amountMinor: -2500,
              bookedAtIso: "2026-05-10T00:00:00Z",
              accountId: "acc-a",
              householdId: "hh-test",
              id: "tx-2",
            },
          ],
          importJobs: [
            {
              finishedAtIso: "2026-05-01T08:01:00Z",
              startedAtIso: "2026-05-01T08:00:00Z",
              sourceName: "may-2026.csv",
              sourceType: "csv",
              householdId: "hh-test",
              id: "job-01",
            },
          ],
          monthlyCategoryTargets: [
            { targetMinor: 9000, categoryId: "groceries", yearMonth: "2026-05" },
          ],
          createdAtIso: "2026-06-01T12:00:00Z",
          outputPath: pathB,
        });

        expect(readFileSync(pathA, "utf8")).toBe(readFileSync(pathB, "utf8"));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("AC-2: restore reproduces equivalent ledger state", () => {
    it("round-trip: restore after create returns equivalent ledger state", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-restore-"));
      const outputPath = join(tempDir, "snapshot.json");

      try {
        createBackupSnapshot({
          household: SAMPLE_HOUSEHOLD,
          accounts: SAMPLE_ACCOUNTS,
          transactions: SAMPLE_TRANSACTIONS,
          importJobs: SAMPLE_IMPORT_JOBS,
          monthlyCategoryTargets: SAMPLE_TARGETS,
          createdAtIso: "2026-06-01T12:00:00Z",
          outputPath,
        });

        const restored = restoreBackupSnapshot({ snapshotPath: outputPath });

        expect(restored.household).toEqual(SAMPLE_HOUSEHOLD);
        expect(restored.accounts).toEqual(
          [...SAMPLE_ACCOUNTS].sort((a, b) => a.id.localeCompare(b.id))
        );
        expect(restored.transactions).toEqual(
          [...SAMPLE_TRANSACTIONS].sort((a, b) => a.id.localeCompare(b.id))
        );
        expect(restored.importJobs).toEqual(SAMPLE_IMPORT_JOBS);
        expect(restored.monthlyCategoryTargets).toEqual(SAMPLE_TARGETS);
        expect(restored.transactionCount).toBe(2);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("round-trip is idempotent: two snapshots from the same input produce identical files", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-idempotent-"));
      const path1 = join(tempDir, "snap1.json");
      const path2 = join(tempDir, "snap2.json");

      try {
        const input = {
          household: SAMPLE_HOUSEHOLD,
          accounts: SAMPLE_ACCOUNTS,
          transactions: SAMPLE_TRANSACTIONS,
          importJobs: SAMPLE_IMPORT_JOBS,
          monthlyCategoryTargets: SAMPLE_TARGETS,
          createdAtIso: "2026-06-01T12:00:00Z",
        };

        createBackupSnapshot({ ...input, outputPath: path1 });
        createBackupSnapshot({ ...input, outputPath: path2 });

        const r1 = restoreBackupSnapshot({ snapshotPath: path1 });
        const r2 = restoreBackupSnapshot({ snapshotPath: path2 });

        expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("restore from the same snapshot path is idempotent across repeated attempts", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-repeat-restore-"));
      const snapshotPath = join(tempDir, "snapshot.json");

      try {
        createBackupSnapshot({
          household: SAMPLE_HOUSEHOLD,
          accounts: SAMPLE_ACCOUNTS,
          transactions: SAMPLE_TRANSACTIONS,
          importJobs: SAMPLE_IMPORT_JOBS,
          monthlyCategoryTargets: SAMPLE_TARGETS,
          createdAtIso: "2026-06-01T12:00:00Z",
          outputPath: snapshotPath,
        });

        const snapshotBeforeRestore = readFileSync(snapshotPath, "utf8");
        const first = restoreBackupSnapshot({ snapshotPath });
        const second = restoreBackupSnapshot({ snapshotPath });
        const snapshotAfterRestore = readFileSync(snapshotPath, "utf8");

        expect(second).toEqual(first);
        expect(snapshotAfterRestore).toBe(snapshotBeforeRestore);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("regression guard: divergence from snapshot source is detectable", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-divergence-"));
      const snapshotPath = join(tempDir, "snapshot.json");

      try {
        createBackupSnapshot({
          household: SAMPLE_HOUSEHOLD,
          accounts: SAMPLE_ACCOUNTS,
          transactions: SAMPLE_TRANSACTIONS,
          importJobs: SAMPLE_IMPORT_JOBS,
          monthlyCategoryTargets: SAMPLE_TARGETS,
          createdAtIso: "2026-06-01T12:00:00Z",
          outputPath: snapshotPath,
        });

        const tamperedSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
          transactions: Array<{ id: string; amountMinor: number }>;
        };
        const tamperedTransactionId = tamperedSnapshot.transactions[0]!.id;
        tamperedSnapshot.transactions[0]!.amountMinor = 123456;
        fsWriteFileSync(snapshotPath, JSON.stringify(tamperedSnapshot), "utf8");

        const restored = restoreBackupSnapshot({ snapshotPath });
        const tamperedRestoredTransaction = restored.transactions.find(
          (transaction) => transaction.id === tamperedTransactionId
        );
        const untouchedRestoredTransactions = restored.transactions
          .filter((transaction) => transaction.id !== tamperedTransactionId)
          .sort((a, b) => a.id.localeCompare(b.id));
        const untouchedSampleTransactions = SAMPLE_TRANSACTIONS
          .filter((transaction) => transaction.id !== tamperedTransactionId)
          .sort((a, b) => a.id.localeCompare(b.id));

        expect(tamperedRestoredTransaction?.amountMinor).toBe(123456);
        expect(untouchedRestoredTransactions).toEqual(untouchedSampleTransactions);
        expect([...restored.transactions].sort((a, b) => a.id.localeCompare(b.id))).not.toEqual(
          [...SAMPLE_TRANSACTIONS].sort((a, b) => a.id.localeCompare(b.id))
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("restoreBackupSnapshot throws on an invalid snapshot version", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-bad-version-"));
      const outputPath = join(tempDir, "bad.json");

      try {
        const badSnapshot = {
          metadata: { version: "0", createdAtIso: "2026-01-01T00:00:00Z", transactionCount: 0, accountCount: 0 },
          household: SAMPLE_HOUSEHOLD,
          accounts: [],
          transactions: [],
          importJobs: [],
          monthlyCategoryTargets: [],
        };
        fsWriteFileSync(outputPath, JSON.stringify(badSnapshot), "utf8");

        expect(() => restoreBackupSnapshot({ snapshotPath: outputPath })).toThrow(
          /Unsupported snapshot version/
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("restoreBackupSnapshot throws on malformed JSON", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-bad-json-"));
      const outputPath = join(tempDir, "corrupt.json");

      try {
        fsWriteFileSync(outputPath, "{ not valid json", "utf8");

        expect(() => restoreBackupSnapshot({ snapshotPath: outputPath })).toThrow(
          /Failed to parse snapshot file/
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("AC-1: empty ledger produces valid snapshot", () => {
    it("buildBackupSnapshot handles empty collections", () => {
      const snapshot = buildBackupSnapshot({
        household: SAMPLE_HOUSEHOLD,
        accounts: [],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
        createdAtIso: "2026-06-01T12:00:00Z",
      });

      expect(snapshot.metadata.transactionCount).toBe(0);
      expect(snapshot.metadata.accountCount).toBe(0);
      expect(snapshot.transactions).toEqual([]);
      expect(snapshot.accounts).toEqual([]);
    });
  });

  describe("AC-3: refactored main-process handler round-trip", () => {
    /**
     * Simulates the `backup:create` IPC handler behaviour after refactoring:
     * the handler receives only `outputPath` from the renderer and loads
     * ledger data from main-process repositories before building the snapshot.
     */
    function simulateMainProcessBackupCreate(
      ledger: {
        household: Household;
        accounts: Account[];
        transactions: Transaction[];
        importJobs: ImportJob[];
        monthlyCategoryTargets: MonthlyCategoryTarget[];
      },
      outputPath: string
    ) {
      return createBackupSnapshot({
        household: ledger.household,
        accounts: ledger.accounts,
        transactions: ledger.transactions,
        importJobs: ledger.importJobs,
        monthlyCategoryTargets: ledger.monthlyCategoryTargets,
        outputPath,
      });
    }

    it("Scenario 1: handler writes snapshot containing all ledger collections when given only outputPath", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-handler-round-trip-"));
      const outputPath = join(tempDir, "snapshot.json");

      try {
        const result = simulateMainProcessBackupCreate(
          {
            household: SAMPLE_HOUSEHOLD,
            accounts: SAMPLE_ACCOUNTS,
            transactions: SAMPLE_TRANSACTIONS,
            importJobs: SAMPLE_IMPORT_JOBS,
            monthlyCategoryTargets: SAMPLE_TARGETS,
          },
          outputPath
        );

        expect(result.outputPath).toBe(outputPath);
        expect(result.transactionCount).toBe(SAMPLE_TRANSACTIONS.length);

        const raw = JSON.parse(readFileSync(outputPath, "utf8")) as {
          household: Household;
          accounts: Account[];
          transactions: Transaction[];
          importJobs: ImportJob[];
          monthlyCategoryTargets: MonthlyCategoryTarget[];
          metadata: { version: string; transactionCount: number; accountCount: number };
        };
        expect(raw.household).toEqual(SAMPLE_HOUSEHOLD);
        expect(raw.accounts).toHaveLength(SAMPLE_ACCOUNTS.length);
        expect(raw.transactions).toHaveLength(SAMPLE_TRANSACTIONS.length);
        expect(raw.importJobs).toHaveLength(SAMPLE_IMPORT_JOBS.length);
        expect(raw.monthlyCategoryTargets).toHaveLength(SAMPLE_TARGETS.length);
        expect(raw.metadata.version).toBe(SNAPSHOT_VERSION);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 2: restoring snapshot from refactored handler reproduces equivalent ledger totals and counts", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-handler-restore-"));
      const outputPath = join(tempDir, "snapshot.json");

      try {
        simulateMainProcessBackupCreate(
          {
            household: SAMPLE_HOUSEHOLD,
            accounts: SAMPLE_ACCOUNTS,
            transactions: SAMPLE_TRANSACTIONS,
            importJobs: SAMPLE_IMPORT_JOBS,
            monthlyCategoryTargets: SAMPLE_TARGETS,
          },
          outputPath
        );

        const restored = restoreBackupSnapshot({ snapshotPath: outputPath });

        expect(restored.household).toEqual(SAMPLE_HOUSEHOLD);
        expect(restored.accounts).toHaveLength(SAMPLE_ACCOUNTS.length);
        expect(restored.transactions).toHaveLength(SAMPLE_TRANSACTIONS.length);
        expect(restored.importJobs).toHaveLength(SAMPLE_IMPORT_JOBS.length);
        expect(restored.monthlyCategoryTargets).toHaveLength(SAMPLE_TARGETS.length);
        expect(restored.transactionCount).toBe(SAMPLE_TRANSACTIONS.length);

        const totalAmount = restored.transactions.reduce((sum, tx) => sum + tx.amountMinor, 0);
        const expectedTotal = SAMPLE_TRANSACTIONS.reduce((sum, tx) => sum + tx.amountMinor, 0);
        expect(totalAmount).toBe(expectedTotal);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 3: repeated restores from the same snapshot preserve equivalent state without drift", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-handler-repeat-"));
      const outputPath = join(tempDir, "snapshot.json");

      try {
        simulateMainProcessBackupCreate(
          {
            household: SAMPLE_HOUSEHOLD,
            accounts: SAMPLE_ACCOUNTS,
            transactions: SAMPLE_TRANSACTIONS,
            importJobs: SAMPLE_IMPORT_JOBS,
            monthlyCategoryTargets: SAMPLE_TARGETS,
          },
          outputPath
        );

        const first = restoreBackupSnapshot({ snapshotPath: outputPath });
        const second = restoreBackupSnapshot({ snapshotPath: outputPath });
        const third = restoreBackupSnapshot({ snapshotPath: outputPath });

        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
        expect(JSON.stringify(third)).toBe(JSON.stringify(first));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
